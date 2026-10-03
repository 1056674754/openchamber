import fs from 'fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'os';
import path from 'path';
import { readOpenCodeCredentials } from '../opencode/auth.js';
import { readConfigLayers } from '../opencode/shared.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from '../opencode/protocol-mode.js';
import { getModelCatalog } from './catalog.js';
import { resolveSmallModel, resolveSmallModelChain, parseModelRef, isUsableAuthEntry, getAuthEntryForProvider } from './resolve.js';
import { DEDICATED_WIRE_FORMAT_PROVIDERS, callSmallModel, resolveProviderLogin } from './call.js';
import { readMergedSettingsSync } from '../opencode/settings-files.js';
import { getRuntimeProviderSnapshot } from './runtime-providers.js';
import {
  findModelInfo,
  getDefaultModelInfo,
  getSmallModelClient,
  listModelInfos,
  listProviderInfos,
} from './client.js';

const CLAUDE_CODE_PROVIDER = 'claude-code';

// OC2 spine S4 [spine 654705f7d]: small-model dual track. The v1 track keeps
// the fork's direct-provider resolution and calls (call.js/resolve.js/
// catalog.js/runtime-providers.js, session-assist semantics included); the v2
// track ports upstream's resolution over the running OpenCode's generation
// endpoint (client.js). Dispatch is by the recorded protocol mode of the
// managed instance (`default`); callers keep calling the exported entry
// points unchanged. The v2 track answers "no small model available" until
// `configureOpenCodeRuntimeProviders` (client.js) is wired (S8).
const v2TrackActive = () => resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2';

const OPENCHAMBER_SETTINGS_FILE = path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'settings.json',
);

// OpenChamber's own settings: when the user unchecks "use default small model"
// their explicit override outranks every other resolution step.
const readSmallModelSettingsOverride = () => {
  const settings = readMergedSettingsSync({ fs, path, settingsFilePath: OPENCHAMBER_SETTINGS_FILE });
  if (settings.smallModelUseDefault !== false) return null;
  const override = typeof settings.smallModelOverride === 'string' ? settings.smallModelOverride.trim() : '';
  return override || null;
};

const DEFAULT_CONTEXT_TOKENS = 64_000;
const OUTPUT_RESERVE_TOKENS = 4_000;

export const getModelInputCharBudget = ({ catalog, providerID, modelID, outputReserveTokens }) => {
  const limit = catalog?.[providerID]?.models?.[modelID]?.limit;
  const known = Number(limit?.context) > 0;
  const contextTokens = known ? Number(limit.context) : DEFAULT_CONTEXT_TOKENS;
  const reserve = Number(outputReserveTokens) > 0 ? Number(outputReserveTokens) : OUTPUT_RESERVE_TOKENS;
  const inputBudgetTokens = Math.max(1_000, contextTokens - reserve);
  return { maxChars: inputBudgetTokens * 4, contextTokens, contextKnown: known };
};

const resolveOutputTokens = ({ catalog, providerID, modelID, maxOutputTokens }) => {
  const requested = Number(maxOutputTokens) > 0 ? Number(maxOutputTokens) : 0;
  if (!requested) return undefined;
  const limit = Number(catalog?.[providerID]?.models?.[modelID]?.limit?.output);
  return limit > 0 ? Math.min(requested, limit) : requested;
};

const clampPromptToModelLimit = ({ prompt, catalog, providerID, modelID, onOverflow, outputReserveTokens }) => {
  const { maxChars } = getModelInputCharBudget({ catalog, providerID, modelID, outputReserveTokens });
  if (prompt.length <= maxChars) {
    return { prompt, truncated: false };
  }
  if (onOverflow === 'error') {
    throw Object.assign(
      new Error(`Input is too large for ${providerID}/${modelID}: ${prompt.length} characters exceeds the ${maxChars} the model's context allows`),
      { statusCode: 413, code: 'context-too-small', providerID, modelID, requiredChars: prompt.length, availableChars: maxChars },
    );
  }
  return { prompt: `${prompt.slice(0, maxChars)}…`, truncated: true };
};

const readConfiguredSmallModel = (workingDirectory) => {
  try {
    const { mergedConfig } = readConfigLayers(workingDirectory);
    const value = mergedConfig?.small_model;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
};

const readConfiguredSmallModelFallback = (workingDirectory) => {
  try {
    const { mergedConfig } = readConfigLayers(workingDirectory);
    const value = mergedConfig?.small_model_fallback;
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()) : null;
  } catch {
    return null;
  }
};

async function generateSmallModelTextV1({ prompt, system, maxOutputTokens, model, directory, preferredProviderID, preferredModelID, restrictToPreferredProvider = false, responseSchema, timeoutMs, signal, onOverflow = 'truncate' }) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
  }

  const auth = await readOpenCodeCredentials();
  const catalog = await getModelCatalog().catch(() => ({}));

  const explicit = parseModelRef(model);
  if (explicit) {
    const candidates = [{ ...explicit, source: 'request' }];
    return await tryCandidates(candidates, { auth, catalog, directory, prompt, system, maxOutputTokens, restrictToPreferredProvider, preferredProviderID, responseSchema, timeoutMs, signal, onOverflow });
  }

  const candidates = resolveSmallModelChain({
    auth,
    catalog,
    settingsSmallModel: readSmallModelSettingsOverride(),
    configSmallModel: readConfiguredSmallModel(directory),
    configSmallModelFallback: readConfiguredSmallModelFallback(directory),
    preferredProviderID,
    preferredModelID,
  });

  if (candidates.length === 0) {
    throw Object.assign(
      new Error('No small model available — no authenticated provider has a suitable model'),
      { statusCode: 404 },
    );
  }

  return await tryCandidates(candidates, { auth, catalog, directory, prompt, system, maxOutputTokens, restrictToPreferredProvider, preferredProviderID, responseSchema, timeoutMs, signal, onOverflow });
}

async function tryCandidates(candidates, { auth, catalog, directory, prompt, system, maxOutputTokens, restrictToPreferredProvider, preferredProviderID, responseSchema, timeoutMs, signal, onOverflow }) {
  const EXPLICIT_SOURCES = new Set(['settings', 'config', 'request', 'config-fallback']);
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    if (candidate.providerID === CLAUDE_CODE_PROVIDER) {
      lastError = Object.assign(
        new Error('Claude Code cannot be used for background small-model actions. Choose another Small Model in Settings → Sessions.'),
        { statusCode: 422, code: 'small-model-provider-unsupported' },
      );
      continue;
    }

    if (restrictToPreferredProvider
      && !EXPLICIT_SOURCES.has(candidate.source)
      && candidate.providerID !== preferredProviderID) {
      continue;
    }

    const outputTokens = resolveOutputTokens({
      catalog,
      providerID: candidate.providerID,
      modelID: candidate.modelID,
      maxOutputTokens,
    });

    const clamped = clampPromptToModelLimit({
      prompt: prompt.trim(),
      catalog,
      providerID: candidate.providerID,
      modelID: candidate.modelID,
      onOverflow,
      outputReserveTokens: outputTokens,
    });

    try {
      const text = await callSmallModel({
        auth,
        catalog,
        workingDirectory: directory,
        providerID: candidate.providerID,
        modelID: candidate.modelID,
        prompt: clamped.prompt,
        system: typeof system === 'string' && system.trim() ? system.trim() : undefined,
        maxOutputTokens: outputTokens,
        responseSchema,
        timeoutMs,
        signal,
      });

      return {
        text: text.trim(),
        providerID: candidate.providerID,
        modelID: candidate.modelID,
        source: candidate.source,
        ...(clamped.truncated ? { inputTruncated: true } : {}),
      };
    } catch (err) {
      lastError = err;
      if (i < candidates.length - 1) {
        console.warn(`[small-model] ${candidate.providerID}/${candidate.modelID} failed, trying fallback`, err.message);
      }
    }
  }

  if (lastError) throw lastError;
  throw Object.assign(new Error('No small model candidate passed the provider restriction'), { statusCode: 404 });
}

async function listAuthenticatedProvidersV1() {
  try {
    const auth = await readOpenCodeCredentials();
    const ids = new Set(
      Object.keys(auth || {}).filter((providerID) => isUsableAuthEntry(auth[providerID])),
    );
    if (isUsableAuthEntry(getAuthEntryForProvider(auth, 'github-copilot'))) {
      ids.add('github-copilot');
    }
    try {
      for (const providerID of await listRuntimeCallableProviders()) ids.add(providerID);
    } catch {
      // File-backed authentication remains available if OpenCode is unreachable.
    }
    ids.delete(CLAUDE_CODE_PROVIDER);
    return Array.from(ids);
  } catch {
    return [];
  }
}

async function listRuntimeCallableProviders() {
  const current = await getRuntimeProviderSnapshot();
  if (!current) return [];
  const ids = [];
  for (const id of current.connected) {
    const provider = current.providers.get(id);
    if (!provider?.apiKey || !provider.baseURL) continue;
    if (DEDICATED_WIRE_FORMAT_PROVIDERS.has(id)) continue;
    ids.push(id);
  }
  return ids;
}

async function describeSmallModelV1({ directory, preferredProviderID, preferredModelID, outputReserveTokens, overrideModel } = {}) {
  const auth = await readOpenCodeCredentials();
  const catalog = await getModelCatalog().catch(() => ({}));
  const explicit = parseModelRef(overrideModel);
  const resolved = explicit
    ? { ...explicit, source: 'request' }
    : resolveSmallModel({
      auth,
      catalog,
      settingsSmallModel: readSmallModelSettingsOverride(),
      configSmallModel: readConfiguredSmallModel(directory),
      preferredProviderID,
      preferredModelID,
    });
  if (!resolved) return resolved;

  const entry = catalog?.[resolved.providerID]?.models?.[resolved.modelID];
  const { maxChars, contextTokens, contextKnown } = getModelInputCharBudget({
    catalog,
    providerID: resolved.providerID,
    modelID: resolved.modelID,
    outputReserveTokens,
  });

  // Settings/config/request overrides can name a provider with no usable login.
  // Report that here so readiness can refuse before the user pays for a 401.
  const hasLogin = Boolean(await resolveProviderLogin({
    auth,
    workingDirectory: directory,
    providerID: resolved.providerID,
  }));

  return {
    ...resolved,
    hasLogin,
    inputCharBudget: maxChars,
    contextTokens,
    contextKnown,
    structuredOutput: typeof entry?.structured_output === 'boolean' ? entry.structured_output : null,
    outputTokenLimit: Number(entry?.limit?.output) > 0 ? Number(entry.limit.output) : null,
  };
}

// ---------------------------------------------------------------------------
// v2 track [spine 654705f7d]: resolution and generation through the running
// OpenCode's own endpoints. Credentials stay inside OpenCode; this server only
// sends a prompt.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000;

const noClientError = () => Object.assign(
  new Error('No small model available — OpenCode is not reachable'),
  { statusCode: 404 },
);

/**
 * The model families that count as "small", most preferred first. The same
 * list OpenCode uses for its own session titles (`Catalog.model.small` in
 * `packages/core/src/catalog.ts`); OpenCode does not expose that lookup over
 * HTTP, so the scan is repeated here on `GET /api/model`.
 */
export const SMALL_MODEL_FAMILY_PRIORITY = ['gpt-luna', 'gemini-flash-lite', 'gemini-flash', 'claude-haiku', 'gpt-nano', 'gpt-mini'];
// The last two are not on OpenCode's list; v1 counted them as small and a
// provider with nothing else cheap (Copilot's utility models, for one)
// would otherwise fall through to the session's big model.

/**
 * A model's family: the catalog's `family` (models.dev) when it has one,
 * else read from the id. A custom provider or a subscription outside the
 * catalog has no `family`, yet its `gemini-3.6-flash` is still a flash.
 */
export const familyOf = (model) => {
  if (model?.family) return String(model.family);
  const id = String(model?.id ?? '').toLowerCase();
  if (id.includes('luna')) return 'gpt-luna';
  if (id.includes('flash-lite') || id.includes('flash_lite')) return 'gemini-flash-lite';
  if (id.includes('flash')) return 'gemini-flash';
  if (id.includes('haiku')) return 'claude-haiku';
  if (id.includes('nano')) return 'gpt-nano';
  if (id.includes('mini') && !id.includes('minimax')) return 'gpt-mini';
  return null;
};

/**
 * The small model within one provider: the newest enabled, active, text-in
 * text-out model of the first family in `SMALL_MODEL_FAMILY_PRIORITY` that the
 * provider has. Null when the provider has none of those families.
 */
export const pickSmallModelInProvider = (models, providerID) => pickSmallModel(models, (model) => model.providerID === providerID);

/**
 * The small model across every provider OpenCode can call: same family
 * order, newest release first within a family. What v1 did after the
 * session provider came up empty; for callers without a session (commit
 * messages, spoken summaries) it is the first place to look.
 */
export const pickSmallModelAnywhere = (models) => pickSmallModel(models, () => true);

const pickSmallModel = (models, accept) => {
  const candidates = models
    .filter((model) => model && accept(model)
      && model.providerID !== CLAUDE_CODE_PROVIDER
      && model.enabled !== false
      && (model.status === undefined || model.status === 'active')
      && (model.capabilities?.input ?? ['text']).some((item) => String(item).startsWith('text'))
      && (model.capabilities?.output ?? ['text']).some((item) => String(item).startsWith('text')))
    .sort((a, b) => (Number(b.time?.released) || 0) - (Number(a.time?.released) || 0));
  for (const family of SMALL_MODEL_FAMILY_PRIORITY) {
    const found = candidates.find((model) => familyOf(model) === family);
    if (found) return { providerID: found.providerID, modelID: found.id };
  }
  return null;
};

/**
 * Which model a v2 call runs on, in order:
 *
 * 1. An explicit request model.
 * 2. OpenChamber's settings override (Settings → Sessions → Small Model).
 * 3. The small model of the session's provider (family scan above) —
 *    `session-provider-small`. A caller that must not leave that provider
 *    then falls back to the session's own model (`session-model`): costlier
 *    than a small model elsewhere, but never someone else's subscription.
 * 4. The small model of any provider OpenCode can call, newest first —
 *    `small`.
 * 5. `GET /api/model/default`: OpenCode's default model — `default`. This is
 *    the chat default, not a small model; OpenCode's own small-model chain is
 *    not reachable over HTTP, which is why steps 3 and 4 live here.
 */
const resolveSmallModelV2 = async ({ client, directory, model, preferredProviderID, preferredModelID, restrictToPreferredProvider }) => {
  const explicit = parseModelRef(model);
  if (explicit) return { ...explicit, source: 'request' };

  const fromSettings = parseModelRef(readSmallModelSettingsOverride());
  if (fromSettings) return { ...fromSettings, source: 'settings' };

  const models = await listModelInfos(client, directory);
  if (preferredProviderID) {
    const small = pickSmallModelInProvider(models, preferredProviderID);
    if (small) return { ...small, source: 'session-provider-small' };
  }
  if (restrictToPreferredProvider && preferredProviderID && preferredModelID) {
    return { providerID: preferredProviderID, modelID: preferredModelID, source: 'session-model' };
  }

  const anywhere = pickSmallModelAnywhere(models);
  if (anywhere) return { ...anywhere, source: 'small' };

  const fallback = await getDefaultModelInfo(client);
  if (!fallback) return null;
  return { providerID: fallback.providerID, modelID: fallback.id, source: 'default' };
};

const JSON_FENCE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

/**
 * `/api/experimental/generate` has no structured-output mode, so the schema travels in the
 * prompt and the reply is parsed here.
 */
const buildSchemaInstruction = (responseSchema) =>
  `Reply with JSON matching this schema and nothing else: ${JSON.stringify(responseSchema)}`;

const extractJsonText = (raw) => {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  const fenced = JSON_FENCE.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
};

const requestOptions = ({ timeoutMs, signal }) => {
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  const signals = [AbortSignal.timeout(timeout)];
  if (signal) signals.push(signal);
  return { signal: AbortSignal.any(signals) };
};

/**
 * The v2 output budget to actually request: what the caller asked for, capped
 * by what the model admits it can emit.
 *
 * `/api/experimental/generate` takes no output budget of its own, so this
 * number only shapes the input reserve — but it has to stay the same number on
 * both sides or a caller that asks for a large answer overruns the context.
 */
const resolveOutputTokensV2 = ({ modelInfo, maxOutputTokens }) => {
  const requested = Number(maxOutputTokens) > 0 ? Number(maxOutputTokens) : 0;
  if (!requested) return undefined;
  const limit = Number(modelInfo?.limit?.output);
  return limit > 0 ? Math.min(requested, limit) : requested;
};

// Rough safety clamp so a huge input never blows the model's context window.
// Token estimate is ~4 chars/token; when OpenCode reports no limit for the
// model a conservative default applies.
const getModelInputCharBudgetV2 = ({ modelInfo, outputReserveTokens }) => {
  const context = Number(modelInfo?.limit?.context);
  const known = context > 0;
  const contextTokens = known ? context : DEFAULT_CONTEXT_TOKENS;
  const reserve = Number(outputReserveTokens) > 0 ? Number(outputReserveTokens) : OUTPUT_RESERVE_TOKENS;
  const inputBudgetTokens = Math.max(1_000, contextTokens - reserve);
  return { maxChars: inputBudgetTokens * 4, contextTokens, contextKnown: known };
};

// `truncate` keeps the historical behavior for callers whose prompt losing its
// tail is survivable (summaries, commit messages). `error` is for callers whose
// output would be quietly wrong on a clipped input — they need the failure.
const clampPromptToModelLimitV2 = ({ prompt, modelInfo, providerID, modelID, onOverflow, outputReserveTokens }) => {
  const { maxChars } = getModelInputCharBudgetV2({ modelInfo, outputReserveTokens });
  if (prompt.length <= maxChars) {
    return { prompt, truncated: false };
  }
  if (onOverflow === 'error') {
    throw Object.assign(
      new Error(`Input is too large for ${providerID}/${modelID}: ${prompt.length} characters exceeds the ${maxChars} the model's context allows`),
      { statusCode: 413, code: 'context-too-small', providerID, modelID, requiredChars: prompt.length, availableChars: maxChars },
    );
  }
  return { prompt: `${prompt.slice(0, maxChars)}…`, truncated: true };
};

/**
 * Generates text with the user's small model through the running OpenCode.
 * Credentials stay inside OpenCode; this server only sends a prompt.
 */
async function generateSmallModelTextV2({ prompt, system, maxOutputTokens, model, directory, preferredProviderID, preferredModelID, restrictToPreferredProvider = false, responseSchema, timeoutMs, signal, onOverflow = 'truncate' }) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
  }

  const client = getSmallModelClient(directory);
  if (!client) throw noClientError();

  const resolved = await resolveSmallModelV2({
    client,
    directory,
    model,
    preferredProviderID,
    preferredModelID,
    restrictToPreferredProvider,
  });

  if (!resolved) {
    throw Object.assign(
      new Error('No small model available — OpenCode reports no default model'),
      { statusCode: 404 },
    );
  }

  if (resolved.providerID === CLAUDE_CODE_PROVIDER) {
    throw Object.assign(
      new Error('Claude Code cannot be used for background small-model actions. Choose another Small Model in Settings → Sessions.'),
      { statusCode: 422, code: 'small-model-provider-unsupported' },
    );
  }

  // A caller that must stay on its session's provider is only overruled by an
  // explicit user choice (the settings override or a request model).
  if (restrictToPreferredProvider
    && !['settings', 'request'].includes(resolved.source)
    && preferredProviderID
    && resolved.providerID !== preferredProviderID) {
    throw Object.assign(
      new Error('No small model available within the session provider'),
      { statusCode: 404 },
    );
  }

  const models = await listModelInfos(client, directory);
  const modelInfo = findModelInfo(models, resolved.providerID, resolved.modelID);

  const outputTokens = resolveOutputTokensV2({ modelInfo, maxOutputTokens });

  const clamped = clampPromptToModelLimitV2({
    prompt: prompt.trim(),
    modelInfo,
    providerID: resolved.providerID,
    modelID: resolved.modelID,
    onOverflow,
    outputReserveTokens: outputTokens,
  });

  // `/api/experimental/generate` takes a single prompt, so the system instructions lead it.
  const sections = [];
  if (typeof system === 'string' && system.trim()) sections.push(system.trim());
  sections.push(clamped.prompt);
  if (responseSchema) sections.push(buildSchemaInstruction(responseSchema));
  const fullPrompt = sections.join('\n\n');

  const generationOptions = requestOptions({ timeoutMs, signal });
  const unavailableMessage = `Model unavailable: ${resolved.providerID}/${resolved.modelID}`;
  let retriedUnavailable = false;
  const send = async () => {
    const result = await client.generate.text(
      { prompt: fullPrompt, model: { id: resolved.modelID, providerID: resolved.providerID } },
      generationOptions,
    );
    return typeof result?.text === 'string' ? result.text : '';
  };

  const sendWithCatalogRetry = async () => {
    try {
      return await send();
    } catch (error) {
      if (error?._tag !== 'InvalidRequestError' || error.message !== unavailableMessage) throw error;
      // OpenCode 2 can resolve a cold catalog before its models arrive.
      // This rejection precedes provider dispatch; other failures must not retry.
      if (!retriedUnavailable) {
        retriedUnavailable = true;
        await delay(500, undefined, { signal: generationOptions.signal });
        return sendWithCatalogRetry();
      }
      throw Object.assign(new Error(unavailableMessage), {
        statusCode: 503,
        code: 'small-model-unavailable',
      });
    }
  };

  let text = await sendWithCatalogRetry();

  if (responseSchema) {
    // One retry: a model that ignored the shape once often honours it on a
    // second pass, and the alternative is failing a walkthrough over a stray
    // sentence of preamble.
    let json = extractJsonText(text);
    if (json === null) {
      text = await sendWithCatalogRetry();
      json = extractJsonText(text);
    }
    if (json === null) {
      throw Object.assign(
        new Error(`${resolved.providerID}/${resolved.modelID} did not return JSON matching the requested schema`),
        { statusCode: 422, code: 'structured-output-unsupported', providerID: resolved.providerID, modelID: resolved.modelID },
      );
    }
    text = json;
  }

  return {
    text: text.trim(),
    providerID: resolved.providerID,
    modelID: resolved.modelID,
    source: resolved.source,
    ...(clamped.truncated ? { inputTruncated: true } : {}),
  };
}

/**
 * Provider ids the small model can actually call (v2 track). A provider counts
 * when OpenCode has at least one enabled model for it — that is the same test
 * OpenCode applies before letting a chat turn use it.
 *
 * The provider list alone is not enough: it comes back empty on setups where
 * models are perfectly usable, so the model list is the authority and the
 * provider list only contributes names.
 */
async function listAuthenticatedProvidersV2() {
  const client = getSmallModelClient();
  if (!client) return [];
  try {
    const [providers, models] = await Promise.all([
      listProviderInfos(client),
      listModelInfos(client),
    ]);
    const enabled = new Set();
    for (const model of models) {
      if (model?.enabled === false) continue;
      if (typeof model?.providerID === 'string' && model.providerID) enabled.add(model.providerID);
    }
    const ids = new Set();
    for (const provider of providers) {
      if (typeof provider?.id === 'string' && enabled.has(provider.id)) ids.add(provider.id);
    }
    for (const id of enabled) ids.add(id);
    ids.delete(CLAUDE_CODE_PROVIDER);
    return Array.from(ids);
  } catch {
    return [];
  }
}

const resolveReserveTokens = (outputReserveTokens, limits) => (
  typeof outputReserveTokens === 'function' ? outputReserveTokens(limits) : outputReserveTokens
);

async function describeSmallModelV2({ directory, preferredProviderID, preferredModelID, outputReserveTokens, overrideModel } = {}) {
  const client = getSmallModelClient(directory);
  if (!client) return null;

  // A caller with its own model setting (the diff walkthrough) outranks the
  // small-model chain entirely — it asked for this model on purpose.
  const resolved = await resolveSmallModelV2({
    client,
    directory,
    model: overrideModel,
    preferredProviderID,
    preferredModelID,
    restrictToPreferredProvider: false,
  });
  if (!resolved) return null;

  const models = await listModelInfos(client, directory);
  const modelInfo = findModelInfo(models, resolved.providerID, resolved.modelID);
  const outputTokenLimit = Number(modelInfo?.limit?.output) > 0 ? Number(modelInfo.limit.output) : null;

  // Two passes: the first only to learn the context, which a caller-supplied
  // reserve function needs before it can answer.
  const { contextTokens, contextKnown } = getModelInputCharBudgetV2({ modelInfo });
  const reserveTokens = resolveReserveTokens(outputReserveTokens, { contextTokens, outputTokenLimit });
  const { maxChars } = getModelInputCharBudgetV2({ modelInfo, outputReserveTokens: reserveTokens });

  // An override can name a model OpenCode has no credential for. It reports
  // that as a disabled model, and readiness refuses before the user pays for
  // a failed request. A model we cannot find at all is not evidence either
  // way, so it counts as usable.
  const hasLogin = modelInfo ? modelInfo.enabled !== false : true;

  return {
    ...resolved,
    hasLogin,
    inputCharBudget: maxChars,
    contextTokens,
    contextKnown,
    // What the caller should ask for, so the request and the reserve above
    // cannot drift apart.
    outputTokens: Number(reserveTokens) > 0 ? Number(reserveTokens) : null,
    /**
     * `structuredOutput` stays `null`: `/api/experimental/generate` has no structured-output
     * mode for any model, and this module emulates it through the prompt. Callers
     * must read `null` as "try it", which is exactly right here — the verdict
     * comes from the reply, not from a capability flag.
     */
    structuredOutput: null,
    outputTokenLimit,
  };
}

// ---------------------------------------------------------------------------
// Mode-dispatching entry points. Consumers (assist, goal, notifications,
// agent-tool, walkthrough, routes) call these and never see the track.
// ---------------------------------------------------------------------------

export async function generateSmallModelText(options) {
  if (v2TrackActive()) return generateSmallModelTextV2(options);
  return generateSmallModelTextV1(options);
}

export async function listAuthenticatedProviders() {
  if (v2TrackActive()) return listAuthenticatedProvidersV2();
  return listAuthenticatedProvidersV1();
}

export async function describeSmallModel(options = {}) {
  if (v2TrackActive()) return describeSmallModelV2(options);
  return describeSmallModelV1(options);
}

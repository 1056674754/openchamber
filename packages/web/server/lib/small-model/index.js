import fs from 'fs';
import os from 'os';
import path from 'path';
import { readAuthFile } from '../opencode/auth.js';
import { readConfigLayers } from '../opencode/shared.js';
import { getModelCatalog } from './catalog.js';
import { resolveSmallModel, resolveSmallModelChain, parseModelRef, isUsableAuthEntry, getAuthEntryForProvider } from './resolve.js';
import { callSmallModel } from './call.js';

const OPENCHAMBER_SETTINGS_FILE = path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'settings.json',
);

// OpenChamber's own settings: when the user unchecks "use default small model"
// their explicit override outranks every other resolution step.
const readSmallModelSettingsOverride = () => {
  try {
    const raw = fs.readFileSync(OPENCHAMBER_SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(raw);
    if (!settings || typeof settings !== 'object') return null;
    if (settings.smallModelUseDefault !== false) return null;
    const override = typeof settings.smallModelOverride === 'string' ? settings.smallModelOverride.trim() : '';
    return override || null;
  } catch {
    return null;
  }
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

export async function generateSmallModelText({ prompt, system, maxOutputTokens, model, directory, preferredProviderID, preferredModelID, restrictToPreferredProvider = false, responseSchema, timeoutMs, signal, onOverflow = 'truncate' }) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
  }

  const auth = readAuthFile();
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

export function listAuthenticatedProviders() {
  try {
    const auth = readAuthFile();
    const ids = new Set(
      Object.keys(auth || {}).filter((providerID) => isUsableAuthEntry(auth[providerID])),
    );
    if (isUsableAuthEntry(getAuthEntryForProvider(auth, 'github-copilot'))) {
      ids.add('github-copilot');
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

export async function describeSmallModel({ directory, preferredProviderID, preferredModelID, outputReserveTokens, overrideModel } = {}) {
  const auth = readAuthFile();
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

  return {
    ...resolved,
    inputCharBudget: maxChars,
    contextTokens,
    contextKnown,
    structuredOutput: typeof entry?.structured_output === 'boolean' ? entry.structured_output : null,
    outputTokenLimit: Number(entry?.limit?.output) > 0 ? Number(entry.limit.output) : null,
  };
}

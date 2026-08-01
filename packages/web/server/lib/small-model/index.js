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

// Rough safety clamp so a huge input never blows the model's context window.
// Token estimate is ~4 chars/token; when the catalog has no limit for the
// model (Copilot/codex utility models are not listed) a conservative default
// applies.
const DEFAULT_CONTEXT_TOKENS = 64_000;
const OUTPUT_RESERVE_TOKENS = 4_000;

const clampPromptToModelLimit = ({ prompt, catalog, providerID, modelID }) => {
  const limit = catalog?.[providerID]?.models?.[modelID]?.limit;
  const contextTokens = Number(limit?.context) > 0 ? Number(limit.context) : DEFAULT_CONTEXT_TOKENS;
  const inputBudgetTokens = Math.max(1_000, contextTokens - OUTPUT_RESERVE_TOKENS);
  const maxChars = inputBudgetTokens * 4;
  if (prompt.length <= maxChars) {
    return { prompt, truncated: false };
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

/**
 * Generates text with the user's small model, resolved and authenticated
 * entirely server-side from the OpenCode config and auth store.
 */
export async function generateSmallModelText({ prompt, system, maxOutputTokens, model, directory, preferredProviderID, preferredModelID, restrictToPreferredProvider = false }) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
  }

  const auth = readAuthFile();
  const catalog = await getModelCatalog().catch(() => ({}));

  const explicit = parseModelRef(model);
  if (explicit) {
    const candidates = [{ ...explicit, source: 'request' }];
    return await tryCandidates(candidates, { auth, catalog, directory, prompt, system, maxOutputTokens, restrictToPreferredProvider, preferredProviderID });
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

  return await tryCandidates(candidates, { auth, catalog, directory, prompt, system, maxOutputTokens, restrictToPreferredProvider, preferredProviderID });
}

async function tryCandidates(candidates, { auth, catalog, directory, prompt, system, maxOutputTokens, restrictToPreferredProvider, preferredProviderID }) {
  const EXPLICIT_SOURCES = new Set(['settings', 'config', 'request', 'config-fallback']);
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    if (restrictToPreferredProvider
      && !EXPLICIT_SOURCES.has(candidate.source)
      && candidate.providerID !== preferredProviderID) {
      continue;
    }

    const clamped = clampPromptToModelLimit({
      prompt: prompt.trim(),
      catalog,
      providerID: candidate.providerID,
      modelID: candidate.modelID,
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
        maxOutputTokens,
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

/**
 * Provider ids with a usable OpenCode login — the set the small model can
 * actually call. Used by the settings override picker to hide providers that
 * would only ever fail (e.g. opencode free models without a token).
 */
export function listAuthenticatedProviders() {
  try {
    const auth = readAuthFile();
    const ids = new Set(
      Object.keys(auth || {}).filter((providerID) => isUsableAuthEntry(auth[providerID])),
    );
    // The catalog id is github-copilot while legacy auth entries may sit
    // under the copilot alias.
    if (isUsableAuthEntry(getAuthEntryForProvider(auth, 'github-copilot'))) {
      ids.add('github-copilot');
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

/**
 * Reports which model would be used, without calling it.
 */
export async function describeSmallModel({ directory, preferredProviderID, preferredModelID } = {}) {
  const auth = readAuthFile();
  const catalog = await getModelCatalog().catch(() => ({}));
  const resolved = resolveSmallModel({
    auth,
    catalog,
    settingsSmallModel: readSmallModelSettingsOverride(),
    configSmallModel: readConfiguredSmallModel(directory),
    preferredProviderID,
    preferredModelID,
  });
  return resolved;
}

import {
  CONFIG_FILE,
  readConfigLayers,
  isPlainObject,
  getConfigForPath,
  writeConfig,
} from './shared.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';
import {
  readSectionEntry,
  writeSectionEntry,
  deleteSectionEntry,
  toProviderEntity,
  toProviderPackage,
  toNpmPackage,
} from './config-v2.js';

// The v2 track (spine OC2-S8 leftover of S3, upstream `654705f7d`): OpenCode 2
// keeps providers under `providers` with `package: "aisdk:<npm>"`,
// `settings.baseURL`, and `models.<id>.modelID`. The v1 `provider` map with
// `npm`/`api`/`options` is still decoded, so reads accept it; every write is
// native v2. The fork diverged heavily here, so both shapes live side by side
// behind the mode gate and the v1 track below each gate is untouched.

const v2TrackActive = () => resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2';

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;
const BASE_URL_PATTERN = /^https?:\/\//;
const OPENAI_COMPATIBLE_NPM = '@ai-sdk/openai-compatible';
const CUSTOM_PROVIDER_NPM_PACKAGES = new Set([
  OPENAI_COMPATIBLE_NPM,
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
]);

function providerExistsIn(config, providerId) {
  return readSectionEntry(config, 'providers', providerId).value !== undefined;
}

/**
 * v2-track validation: accepts the v2 spelling (`package`, `settings.baseURL`)
 * and the v1 spelling (`npm`, `options.baseURL`); the normalized value is
 * always v2.
 */
function validateCustomProviderConfigV2(providerId, config, options = {}) {
  if (!providerId || typeof providerId !== 'string' || !PROVIDER_ID_PATTERN.test(providerId)) {
    return { ok: false, error: 'Provider ID must match /^[a-z0-9][a-z0-9-_]*$/' };
  }

  if (!isPlainObject(config)) {
    return { ok: false, error: 'Provider config must be an object' };
  }

  const name = typeof config.name === 'string' ? config.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'Provider name is required' };
  }

  const npm = toNpmPackage(config.package ?? config.npm) || OPENAI_COMPATIBLE_NPM;
  if (!CUSTOM_PROVIDER_NPM_PACKAGES.has(npm)) {
    return { ok: false, error: 'Custom providers must use @ai-sdk/openai-compatible, @ai-sdk/openai, or @ai-sdk/anthropic' };
  }

  const settingsBlock = isPlainObject(config.settings)
    ? config.settings
    : (isPlainObject(config.options) ? config.options : null);
  if (!settingsBlock) {
    return { ok: false, error: 'Provider settings are required' };
  }

  const baseURL = typeof settingsBlock.baseURL === 'string' ? settingsBlock.baseURL.trim() : '';
  if (!baseURL) {
    return { ok: false, error: 'Base URL is required' };
  }
  if (!BASE_URL_PATTERN.test(baseURL)) {
    return { ok: false, error: 'Base URL must start with http:// or https://' };
  }

  const models = isPlainObject(config.models) ? config.models : null;
  if (!models || Object.keys(models).length === 0) {
    return { ok: false, error: 'At least one model is required' };
  }

  const normalizedModels = {};
  for (const [modelId, modelValue] of Object.entries(models)) {
    const trimmedId = typeof modelId === 'string' ? modelId.trim() : '';
    if (!trimmedId) {
      return { ok: false, error: 'Model id is required' };
    }
    if (!isPlainObject(modelValue)) {
      return { ok: false, error: `Model "${trimmedId}" must be an object` };
    }
    const modelName = typeof modelValue.name === 'string' ? modelValue.name.trim() : '';
    if (!modelName) {
      return { ok: false, error: `Model "${trimmedId}" requires a name` };
    }
    normalizedModels[trimmedId] = { modelID: trimmedId, name: modelName };
  }

  const normalized = {
    package: toProviderPackage(npm),
    name,
    settings: { baseURL },
    models: normalizedModels,
  };

  let env = [];
  if (Array.isArray(config.env)) {
    env = config.env
      .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim());
    if (env.length > 0) {
      normalized.env = env;
    }
  }

  const hasStoredAuth = Boolean(options.hasStoredAuth);
  if (env.length === 0 && !hasStoredAuth) {
    return {
      ok: false,
      error: 'API key or {env:VAR} credentials are required',
    };
  }

  const headerSource = isPlainObject(config.headers) ? config.headers : settingsBlock.headers;
  if (isPlainObject(headerSource)) {
    const headers = {};
    for (const [headerKey, headerValue] of Object.entries(headerSource)) {
      if (typeof headerKey !== 'string' || !headerKey.trim()) {
        continue;
      }
      if (typeof headerValue !== 'string' || !headerValue.trim()) {
        return { ok: false, error: `Header "${headerKey}" requires a non-empty value` };
      }
      headers[headerKey.trim()] = headerValue.trim();
    }
    if (Object.keys(headers).length > 0) {
      normalized.headers = headers;
    }
  }

  return { ok: true, value: { providerId, config: normalized } };
}

function mergeCustomProviderConfig(existingValue, normalizedConfig) {
  // Read the existing entry through the v2 projection so a legacy
  // `npm`/`api`/`options` block is carried forward in native shape.
  const existing = toProviderEntity(existingValue);
  const mergedSettings = { ...(existing.settings ?? {}), ...(normalizedConfig.settings ?? {}) };

  const existingModels = isPlainObject(existing.models) ? existing.models : {};
  const normalizedModels = isPlainObject(normalizedConfig.models) ? normalizedConfig.models : {};
  const mergedModels = Object.fromEntries(
    Object.entries(normalizedModels).map(([modelId, normalizedModel]) => {
      const existingModel = isPlainObject(existingModels[modelId]) ? existingModels[modelId] : {};
      return [modelId, { ...existingModel, ...normalizedModel }];
    }),
  );

  const merged = {
    ...existing,
    ...normalizedConfig,
    settings: mergedSettings,
    models: mergedModels,
  };
  // Headers and env are explicit removals when the form omits them.
  if (!Object.prototype.hasOwnProperty.call(normalizedConfig, 'headers')) {
    delete merged.headers;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedConfig, 'env')) {
    delete merged.env;
  }
  return toProviderEntity(merged);
}

function getProviderSources(providerId, workingDirectory) {
  const layers = readConfigLayers(workingDirectory);
  const { userConfig, projectConfig, customConfig, paths } = layers;

  if (v2TrackActive()) {
    // v2 reads both section spellings through the v2 projection.
    return {
      sources: {
        auth: { exists: false },
        user: { exists: providerExistsIn(userConfig, providerId), path: paths.userPath },
        project: { exists: providerExistsIn(projectConfig, providerId), path: paths.projectPath || null },
        custom: { exists: providerExistsIn(customConfig, providerId), path: paths.customPath },
      },
    };
  }


  const customProviders = isPlainObject(customConfig?.provider) ? customConfig.provider : {};
  const customProvidersAlias = isPlainObject(customConfig?.providers) ? customConfig.providers : {};
  const projectProviders = isPlainObject(projectConfig?.provider) ? projectConfig.provider : {};
  const projectProvidersAlias = isPlainObject(projectConfig?.providers) ? projectConfig.providers : {};
  const userProviders = isPlainObject(userConfig?.provider) ? userConfig.provider : {};
  const userProvidersAlias = isPlainObject(userConfig?.providers) ? userConfig.providers : {};

  const customExists =
    Object.prototype.hasOwnProperty.call(customProviders, providerId) ||
    Object.prototype.hasOwnProperty.call(customProvidersAlias, providerId);
  const projectExists =
    Object.prototype.hasOwnProperty.call(projectProviders, providerId) ||
    Object.prototype.hasOwnProperty.call(projectProvidersAlias, providerId);
  const userExists =
    Object.prototype.hasOwnProperty.call(userProviders, providerId) ||
    Object.prototype.hasOwnProperty.call(userProvidersAlias, providerId);

  return {
    sources: {
      auth: { exists: false },
      user: { exists: userExists, path: paths.userPath },
      project: { exists: projectExists, path: paths.projectPath || null },
      custom: { exists: customExists, path: paths.customPath }
    }
  };
}

/**
 * Validate a custom OpenAI-compatible provider config payload before persistence.
 * Returns { ok: true, value } or { ok: false, error }.
 *
 * Credentials: either config.env contains a variable name, or hasStoredAuth is true
 * (auth.json already has a key — typically after auth.set, or when editing).
 */
function validateCustomProviderConfig(providerId, config, options = {}) {
  if (v2TrackActive()) {
    return validateCustomProviderConfigV2(providerId, config, options);
  }

  if (!providerId || typeof providerId !== 'string' || !PROVIDER_ID_PATTERN.test(providerId)) {
    return { ok: false, error: 'Provider ID must match /^[a-z0-9][a-z0-9-_]*$/' };
  }

  if (!isPlainObject(config)) {
    return { ok: false, error: 'Provider config must be an object' };
  }

  const name = typeof config.name === 'string' ? config.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'Provider name is required' };
  }

  const npm = typeof config.npm === 'string' ? config.npm.trim() : OPENAI_COMPATIBLE_NPM;
  if (npm !== OPENAI_COMPATIBLE_NPM) {
    return { ok: false, error: `Custom providers must use npm package ${OPENAI_COMPATIBLE_NPM}` };
  }

  const optionsBlock = isPlainObject(config.options) ? config.options : null;
  if (!optionsBlock) {
    return { ok: false, error: 'Provider options are required' };
  }

  const baseURL = typeof optionsBlock.baseURL === 'string' ? optionsBlock.baseURL.trim() : '';
  if (!baseURL) {
    return { ok: false, error: 'Base URL is required' };
  }
  if (!BASE_URL_PATTERN.test(baseURL)) {
    return { ok: false, error: 'Base URL must start with http:// or https://' };
  }

  const models = isPlainObject(config.models) ? config.models : null;
  if (!models || Object.keys(models).length === 0) {
    return { ok: false, error: 'At least one model is required' };
  }

  const normalizedModels = {};
  for (const [modelId, modelValue] of Object.entries(models)) {
    const trimmedId = typeof modelId === 'string' ? modelId.trim() : '';
    if (!trimmedId) {
      return { ok: false, error: 'Model id is required' };
    }
    if (!isPlainObject(modelValue)) {
      return { ok: false, error: `Model "${trimmedId}" must be an object` };
    }
    const modelName = typeof modelValue.name === 'string' ? modelValue.name.trim() : '';
    if (!modelName) {
      return { ok: false, error: `Model "${trimmedId}" requires a name` };
    }
    normalizedModels[trimmedId] = { name: modelName };
  }

  const normalized = {
    npm: OPENAI_COMPATIBLE_NPM,
    name,
    options: {
      baseURL,
    },
    models: normalizedModels,
  };

  let env = [];
  if (Array.isArray(config.env)) {
    env = config.env
      .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim());
    if (env.length > 0) {
      normalized.env = env;
    }
  }

  const hasStoredAuth = Boolean(options.hasStoredAuth);
  if (env.length === 0 && !hasStoredAuth) {
    return {
      ok: false,
      error: 'API key or {env:VAR} credentials are required',
    };
  }

  if (isPlainObject(optionsBlock.headers)) {
    const headers = {};
    for (const [headerKey, headerValue] of Object.entries(optionsBlock.headers)) {
      if (typeof headerKey !== 'string' || !headerKey.trim()) {
        continue;
      }
      if (typeof headerValue !== 'string' || !headerValue.trim()) {
        return { ok: false, error: `Header "${headerKey}" requires a non-empty value` };
      }
      headers[headerKey.trim()] = headerValue.trim();
    }
    if (Object.keys(headers).length > 0) {
      normalized.options.headers = headers;
    }
  }

  return { ok: true, value: { providerId, config: normalized } };
}

/**
 * Persist (create or update) a custom provider block in OpenCode
 * user/project/custom config scoped to the active runtime's working directory.
 * Does not write secrets — API keys remain in auth.json via the OpenCode auth API.
 */
function upsertProviderConfig(providerId, config, workingDirectory, scope = 'user', options = {}) {
  const validated = validateCustomProviderConfig(providerId, config, options);
  if (!validated.ok) {
    const error = new Error(validated.error);
    error.statusCode = 400;
    throw error;
  }

  const layers = readConfigLayers(workingDirectory);
  let targetPath = layers.paths.userPath;

  if (scope === 'project') {
    if (!workingDirectory) {
      throw new Error('Working directory is required for project scope');
    }
    targetPath = layers.paths.projectPath || targetPath;
  } else if (scope === 'custom') {
    if (!layers.paths.customPath) {
      throw new Error('Custom config path (OPENCODE_CONFIG) is not set');
    }
    targetPath = layers.paths.customPath;
  } else if (scope !== 'user') {
    throw new Error('Invalid scope');
  }

  const targetConfig = getConfigForPath(layers, targetPath);

  if (v2TrackActive()) {
    // Writes `providers`; a legacy `provider.<id>` in the same file is dropped
    // so the two spellings cannot disagree.
    const existing = readSectionEntry(targetConfig, 'providers', validated.value.providerId).value;
    const mergedConfig = mergeCustomProviderConfig(existing, validated.value.config);
    writeSectionEntry(targetConfig, 'providers', validated.value.providerId, mergedConfig);

    if (Array.isArray(targetConfig.disabled_providers)) {
      targetConfig.disabled_providers = targetConfig.disabled_providers.filter(
        (entry) => entry !== validated.value.providerId,
      );
    }

    const v2WritePath = targetPath || CONFIG_FILE;
    writeConfig(targetConfig, v2WritePath);

    return {
      providerId: validated.value.providerId,
      path: v2WritePath,
      config: mergedConfig,
    };
  }

  const providerConfig = isPlainObject(targetConfig.provider) ? { ...targetConfig.provider } : {};
  providerConfig[validated.value.providerId] = validated.value.config;
  targetConfig.provider = providerConfig;

  if (Array.isArray(targetConfig.disabled_providers)) {
    targetConfig.disabled_providers = targetConfig.disabled_providers.filter(
      (entry) => entry !== validated.value.providerId,
    );
  }

  const writePath = targetPath || CONFIG_FILE;
  writeConfig(targetConfig, writePath);

  return {
    providerId: validated.value.providerId,
    path: writePath,
    config: validated.value.config,
  };
}

function removeProviderConfig(providerId, workingDirectory, scope = 'user') {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID is required');
  }

  const layers = readConfigLayers(workingDirectory);
  let targetPath = layers.paths.userPath;

  if (scope === 'project') {
    if (!workingDirectory) {
      throw new Error('Working directory is required for project scope');
    }
    targetPath = layers.paths.projectPath || targetPath;
  } else if (scope === 'custom') {
    if (!layers.paths.customPath) {
      return false;
    }
    targetPath = layers.paths.customPath;
  }

  const targetConfig = getConfigForPath(layers, targetPath);

  if (v2TrackActive()) {
    if (!deleteSectionEntry(targetConfig, 'providers', providerId)) {
      return false;
    }

    writeConfig(targetConfig, targetPath || CONFIG_FILE);
    console.log(`Removed provider ${providerId} from config: ${targetPath}`);
    return true;
  }

  const providerConfig = isPlainObject(targetConfig.provider) ? targetConfig.provider : {};
  const providersConfig = isPlainObject(targetConfig.providers) ? targetConfig.providers : {};
  const removedProvider = Object.prototype.hasOwnProperty.call(providerConfig, providerId);
  const removedProviders = Object.prototype.hasOwnProperty.call(providersConfig, providerId);

  if (!removedProvider && !removedProviders) {
    return false;
  }

  if (removedProvider) {
    delete providerConfig[providerId];
    if (Object.keys(providerConfig).length === 0) {
      delete targetConfig.provider;
    } else {
      targetConfig.provider = providerConfig;
    }
  }

  if (removedProviders) {
    delete providersConfig[providerId];
    if (Object.keys(providersConfig).length === 0) {
      delete targetConfig.providers;
    } else {
      targetConfig.providers = providersConfig;
    }
  }

  writeConfig(targetConfig, targetPath || CONFIG_FILE);
  console.log(`Removed provider ${providerId} from config: ${targetPath}`);
  return true;
}

export {
  getProviderSources,
  removeProviderConfig,
  upsertProviderConfig,
  validateCustomProviderConfig,
};

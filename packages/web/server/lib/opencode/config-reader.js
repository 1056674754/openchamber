/**
 * Config reader for reading OpenCode configuration with layer attribution.
 * Uses the readConfigLayers utilities from shared.js to expose which config
 * file each section/value comes from.
 */
import {
  readConfigLayers,
  getConfigPaths,
  readConfigFile,
  mergeConfigs,
  getJsonEntrySource,
} from './shared.js';

/**
 * Returns the fully merged config along with layer metadata.
 *
 * @param {string} [workingDirectory] - Optional project directory for project-level config
 * @returns {{
 *   merged: object,
 *   layers: { user: object, project: object|null, custom: object|null },
 *   paths: { userPath: string|null, projectPath: string|null, customPath: string|null },
 *   sources: Record<string, { file: string, layer: 'user'|'project'|'custom' }>
 * }}
 */
export function readFullConfig(workingDirectory) {
  const layers = readConfigLayers(workingDirectory);

  // Build a sources map: keyPath -> { file, layer }
  const sources = {};
  const recordSources = (obj, prefix, layer, path) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      sources[fullKey] = { file: path, layer };
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        recordSources(value, fullKey, layer, path);
      }
    }
  };

  if (layers.paths.userPath) {
    recordSources(layers.userConfig, '', 'user', layers.paths.userPath);
  }
  if (layers.paths.projectPath) {
    recordSources(layers.projectConfig, '', 'project', layers.paths.projectPath);
  }
  if (layers.paths.customPath) {
    recordSources(layers.customConfig, '', 'custom', layers.paths.customPath);
  }

  return {
    merged: layers.mergedConfig,
    layers: {
      user: layers.userConfig,
      project: layers.projectConfig,
      custom: layers.customConfig,
    },
    paths: {
      userPath: layers.paths.userPath,
      projectPath: layers.paths.projectPath,
      customPath: layers.paths.customPath,
    },
    sources,
  };
}

/**
 * Read a specific config section from the merged config, annotated with source info.
 */
export function readConfigSection(workingDirectory, sectionKey) {
  const { merged, sources } = readFullConfig(workingDirectory);
  const section = merged[sectionKey] ?? {};
  const sectionSources = {};

  for (const [key] of Object.entries(section)) {
    const fullKey = `${sectionKey}.${key}`;
    sectionSources[key] = sources[fullKey] ?? null;
  }

  return { section, sources: sectionSources };
}

/**
 * Read the permission config specifically. Returns tool→rule map with source info.
 * Also normalizes between top-level permission and agent-level permission.
 */
export function readPermissionConfig(workingDirectory) {
  const layers = readConfigLayers(workingDirectory);
  const merged = layers.mergedConfig;

  // Top-level permissions
  const globalPermission = merged.permission ?? {};
  const perTool = typeof globalPermission === 'object' && !Array.isArray(globalPermission)
    ? globalPermission
    : {};

  // Per-agent permissions
  const agentPermissions = {};
  const agents = merged.agent ?? {};
  for (const [agentName, agentConfig] of Object.entries(agents)) {
    if (agentConfig && typeof agentConfig === 'object' && agentConfig.permission) {
      agentPermissions[agentName] = agentConfig.permission;
    }
  }

  return {
    global: perTool,
    agents: agentPermissions,
    merged,
    paths: layers.paths,
  };
}

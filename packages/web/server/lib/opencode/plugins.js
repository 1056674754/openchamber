import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AGENT_SCOPE,
  readConfigFile,
  readConfigLayer,
  writeConfig,
} from './shared.js';
import { isPathSpec } from './plugin-spec.js';

const PLUGIN_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-_.]*\.(js|ts|mjs|cjs)$/;
const DEFAULT_PLUGIN_CONTEXT = Object.freeze({
  configDir: null,
  customConfigPath: null,
});

/**
 * @typedef {'user' | 'project'} PluginScope
 * @typedef {'npm' | 'path'} PluginParsedKind
 * @typedef {Object} PluginEntry
 * @property {string} id base64url encoded "config:scope:spec"
 * @property {string} spec
 * @property {Record<string, unknown>} [options]
 * @property {PluginScope} scope
 * @property {'config'} kind
 * @property {PluginParsedKind} parsedKind
 * @property {string} sourcePath absolute path to the config file
 * @typedef {Object} PluginFile
 * @property {string} id base64url encoded "file:scope:fileName"
 * @property {string} fileName
 * @property {PluginScope} scope
 * @property {'file'} kind
 * @property {string} absolutePath
 */

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateScope(scope) {
  if (scope !== AGENT_SCOPE.USER && scope !== AGENT_SCOPE.PROJECT) {
    throw codedError('Plugin scope must be user or project', 'INVALID_SCOPE');
  }
}

function validatePluginSpec(spec) {
  if (typeof spec !== 'string' || !spec.trim()) {
    throw codedError('Plugin spec must be a non-empty string', 'INVALID_SPEC');
  }
  if (spec.includes('\0')) {
    throw codedError('Plugin spec cannot contain null bytes', 'INVALID_SPEC');
  }
  return spec.trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOptions(options) {
  return isRecord(options) && Object.keys(options).length > 0;
}

function parsedKindForSpec(spec) {
  // Path indicators must include Windows paths; scoped npm packages also contain '/'.
  // Do NOT use `includes(path.sep)` — scoped npm packages legitimately contain '/' (e.g. `@gitlab/opencode-gitlab-auth`).
  return isPathSpec(spec) ? 'path' : 'npm';
}

function getActiveOpencodeConfigDir(context = DEFAULT_PLUGIN_CONTEXT) {
  if (context.configDir) {
    return context.configDir;
  }
  const customConfigPath = context.customConfigPath || process.env.OPENCODE_CONFIG;
  if (customConfigPath) {
    return path.dirname(path.resolve(customConfigPath));
  }
  return path.join(os.homedir(), '.config', 'opencode');
}

function getActiveUserConfigPaths(context = DEFAULT_PLUGIN_CONTEXT) {
  const configDir = getActiveOpencodeConfigDir(context);
  return [
    path.join(configDir, 'config.json'),
    path.join(configDir, 'opencode.json'),
    path.join(configDir, 'opencode.jsonc'),
  ];
}

function getActiveCustomConfigPath(context = DEFAULT_PLUGIN_CONTEXT) {
  const customConfigPath = context.customConfigPath || process.env.OPENCODE_CONFIG;
  return customConfigPath ? path.resolve(customConfigPath) : null;
}

function getPrimaryUserConfigPath(context = DEFAULT_PLUGIN_CONTEXT) {
  const [defaultPath, ...fallbackPaths] = getActiveUserConfigPaths(context);
  for (const userPath of [defaultPath, ...fallbackPaths]) {
    if (fs.existsSync(userPath)) {
      return userPath;
    }
  }
  return defaultPath;
}

function getProjectConfigPath(workingDirectory) {
  if (!workingDirectory) return null;
  const candidates = [
    path.join(workingDirectory, 'opencode.json'),
    path.join(workingDirectory, 'opencode.jsonc'),
    path.join(workingDirectory, '.opencode', 'opencode.json'),
    path.join(workingDirectory, '.opencode', 'opencode.jsonc'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function readPluginConfigLayers(workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const customPath = getActiveCustomConfigPath(context);
  const userPath = getPrimaryUserConfigPath(context);
  const projectPath = getProjectConfigPath(workingDirectory);
  const userLayer = readConfigLayer(userPath);
  const projectLayer = readConfigLayer(projectPath);
  const customLayer = readConfigLayer(customPath);
  return {
    userConfig: userLayer.config,
    projectConfig: projectLayer.config,
    customConfig: customLayer.config,
    paths: {
      userPath,
      projectPath,
      customPath,
    },
    layerErrors: [
      userLayer.error && { path: userPath, code: userLayer.error.code, message: userLayer.error.message },
      projectLayer.error && projectPath && { path: projectPath, code: projectLayer.error.code, message: projectLayer.error.message },
      customLayer.error && customPath && { path: customPath, code: customLayer.error.code, message: customLayer.error.message },
    ].filter(Boolean),
  };
}

function validateFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName) {
    throw codedError('Plugin file name is required', 'INVALID_FILENAME');
  }
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..') || !PLUGIN_FILE_NAME_PATTERN.test(fileName)) {
    throw codedError('Plugin file name must match /^[a-z0-9][a-z0-9-_.]*\\.(js|ts|mjs|cjs)$/ and cannot contain path traversal', 'INVALID_FILENAME');
  }
  return fileName;
}

function ensureProjectConfigPath(workingDirectory) {
  if (!workingDirectory) {
    throw codedError('Project scope requires working directory', 'INVALID_SCOPE');
  }
  const configDir = path.join(workingDirectory, '.opencode');
  fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, 'opencode.json');
}

function configSources(layers) {
  const sources = [];
  if (layers.paths.customPath) {
    sources.push({ config: layers.customConfig, filePath: layers.paths.customPath, scope: AGENT_SCOPE.USER });
  } else {
    sources.push({ config: layers.userConfig, filePath: layers.paths.userPath, scope: AGENT_SCOPE.USER });
  }
  if (layers.paths.projectPath) {
    sources.push({ config: layers.projectConfig, filePath: layers.paths.projectPath, scope: AGENT_SCOPE.PROJECT });
  }
  return sources;
}

function splitScopedValue(value) {
  const separator = value.indexOf(':');
  if (separator === -1) {
    throw codedError('Plugin id value must include scope', 'INVALID_SPEC');
  }
  return {
    scope: value.slice(0, separator),
    value: value.slice(separator + 1),
  };
}

function getPluginTarget(id, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const decoded = decodePluginId(id);
  if (decoded.prefix !== 'config') {
    throw codedError('Plugin entry id must use config prefix', 'INVALID_SPEC');
  }
  const { scope, value: spec } = splitScopedValue(decoded.value);
  validateScope(scope);
  const layers = readPluginConfigLayers(workingDirectory, context);
  const source = configSources(layers).find((candidate) => candidate.scope === scope);
  const plugin = Array.isArray(source?.config?.plugin) ? source.config.plugin : [];
  const index = plugin.findIndex((raw) => parsePluginRaw(raw).spec === spec);
  if (!source || index === -1) {
    return null;
  }
  return { source, plugin, index };
}

function pluginDirForScope(scope, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  validateScope(scope);
  if (scope === AGENT_SCOPE.PROJECT) {
    if (!workingDirectory) {
      throw codedError('Project scope requires working directory', 'INVALID_SCOPE');
    }
    return path.join(workingDirectory, '.opencode', 'plugins');
  }
  return path.join(getActiveOpencodeConfigDir(context), 'plugins');
}

function fileTargetFromId(id, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const decoded = decodePluginId(id);
  if (decoded.prefix !== 'file') {
    throw codedError('Plugin file id must use file prefix', 'INVALID_FILENAME');
  }
  const { scope, value: fileName } = splitScopedValue(decoded.value);
  validateScope(scope);
  validateFileName(fileName);
  return {
    fileName,
    scope,
    absolutePath: path.join(pluginDirForScope(scope, workingDirectory, context), fileName),
  };
}

function encodePluginId(prefix, value) {
  return Buffer.from(`${prefix}:${value}`).toString('base64url');
}

function decodePluginId(id) {
  const decoded = Buffer.from(id, 'base64url').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) {
    throw codedError('Invalid plugin id', 'INVALID_SPEC');
  }
  return { prefix: decoded.slice(0, separator), value: decoded.slice(separator + 1) };
}

function parsePluginRaw(raw) {
  if (typeof raw === 'string') {
    return { spec: validatePluginSpec(raw) };
  }
  if (Array.isArray(raw) && raw.length === 2 && isRecord(raw[1])) {
    return { spec: validatePluginSpec(raw[0]), options: { ...raw[1] } };
  }
  throw codedError('Plugin spec must be a string or [string, object]', 'INVALID_SPEC');
}

function serializePluginEntry(entry) {
  const spec = validatePluginSpec(entry?.spec);
  if (hasOptions(entry?.options)) {
    return [spec, { ...entry.options }];
  }
  return spec;
}

function listPluginEntries(workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const layers = readPluginConfigLayers(workingDirectory, context);
  return configSources(layers).flatMap((source) => {
    if (!Array.isArray(source.config?.plugin)) {
      return [];
    }
    return source.config.plugin.map((raw) => {
      const parsed = parsePluginRaw(raw);
      return {
        id: encodePluginId('config', `${source.scope}:${parsed.spec}`),
        spec: parsed.spec,
        ...(parsed.options !== undefined ? { options: parsed.options } : {}),
        scope: source.scope,
        kind: 'config',
        parsedKind: parsedKindForSpec(parsed.spec),
        sourcePath: source.filePath,
      };
    });
  });
}

function getPluginEntry(id, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  return listPluginEntries(workingDirectory, context).find((entry) => entry.id === id) || null;
}

function createPluginEntry(entry, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const spec = validatePluginSpec(entry?.spec);
  const scope = entry?.scope || AGENT_SCOPE.USER;
  validateScope(scope);

  const layers = readPluginConfigLayers(workingDirectory, context);
  const existing = configSources(layers).find((source) => (
    source.scope === scope
    && Array.isArray(source.config?.plugin)
    && source.config.plugin.some((raw) => parsePluginRaw(raw).spec === spec)
  ));
  if (existing) {
    throw codedError(`Plugin "${spec}" already exists`, 'ENTRY_EXISTS');
  }

  let targetPath = getPrimaryUserConfigPath(context);
  let config = {};
  if (scope === AGENT_SCOPE.PROJECT) {
    targetPath = ensureProjectConfigPath(workingDirectory);
    config = fs.existsSync(targetPath) ? readConfigFile(targetPath) : {};
  } else {
    targetPath = layers.paths.customPath || layers.paths.userPath;
    config = layers.paths.customPath ? layers.customConfig : layers.userConfig;
  }

  if (!Array.isArray(config.plugin)) {
    config.plugin = [];
  }
  config.plugin.push(serializePluginEntry({ spec, options: entry.options }));
  writeConfig(config, targetPath);
}

function updatePluginEntry(id, updates, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const target = getPluginTarget(id, workingDirectory, context);
  if (!target) {
    throw codedError('Plugin entry not found', 'NOT_FOUND');
  }
  const existing = parsePluginRaw(target.plugin[target.index]);
  const nextSpec = updates?.spec === undefined ? existing.spec : validatePluginSpec(updates.spec);
  const nextOptions = updates?.options === undefined ? existing.options : updates.options;
  target.plugin[target.index] = serializePluginEntry({ spec: nextSpec, options: nextOptions });
  writeConfig(target.source.config, target.source.filePath);
}

function deletePluginEntry(id, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const target = getPluginTarget(id, workingDirectory, context);
  if (!target) {
    throw codedError('Plugin entry not found', 'NOT_FOUND');
  }
  target.plugin.splice(target.index, 1);
  if (target.plugin.length === 0) {
    delete target.source.config.plugin;
  }
  writeConfig(target.source.config, target.source.filePath);
}

function listPluginDirFiles(workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const scopes = [AGENT_SCOPE.USER];
  if (workingDirectory) {
    scopes.push(AGENT_SCOPE.PROJECT);
  }
  return scopes.flatMap((scope) => {
    const dir = pluginDirForScope(scope, workingDirectory, context);
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && PLUGIN_FILE_NAME_PATTERN.test(entry.name) && !entry.name.includes('..'))
      .map((entry) => ({
        id: encodePluginId('file', `${scope}:${entry.name}`),
        fileName: entry.name,
        scope,
        kind: 'file',
        absolutePath: path.join(dir, entry.name),
      }));
  });
}

function readPluginDirFile(id, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const target = fileTargetFromId(id, workingDirectory, context);
  if (!fs.existsSync(target.absolutePath)) {
    return null;
  }
  return {
    fileName: target.fileName,
    scope: target.scope,
    content: fs.readFileSync(target.absolutePath, 'utf8'),
  };
}

function writePluginDirFile(file, workingDirectory, opts = {}, context = DEFAULT_PLUGIN_CONTEXT) {
  const fileName = validateFileName(file?.fileName);
  const scope = file?.scope || AGENT_SCOPE.USER;
  validateScope(scope);
  const dir = pluginDirForScope(scope, workingDirectory, context);
  const absolutePath = path.join(dir, fileName);
  if (!opts.overwrite && fs.existsSync(absolutePath)) {
    throw codedError(`Plugin file "${fileName}" already exists`, 'FILE_EXISTS');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, file?.content ?? '', 'utf8');
}

function deletePluginDirFile(id, workingDirectory, context = DEFAULT_PLUGIN_CONTEXT) {
  const target = fileTargetFromId(id, workingDirectory, context);
  if (!fs.existsSync(target.absolutePath)) {
    throw codedError(`Plugin file "${target.fileName}" not found`, 'NOT_FOUND');
  }
  fs.unlinkSync(target.absolutePath);
}

function createPluginDataLayer(options = {}) {
  const context = Object.freeze({
    configDir: options.configDir ? path.resolve(options.configDir) : null,
    customConfigPath: options.customConfigPath ? path.resolve(options.customConfigPath) : null,
  });

  return Object.freeze({
    listPluginEntries: (workingDirectory) => listPluginEntries(workingDirectory, context),
    getPluginEntry: (id, workingDirectory) => getPluginEntry(id, workingDirectory, context),
    createPluginEntry: (entry, workingDirectory) => createPluginEntry(entry, workingDirectory, context),
    updatePluginEntry: (id, updates, workingDirectory) => updatePluginEntry(id, updates, workingDirectory, context),
    deletePluginEntry: (id, workingDirectory) => deletePluginEntry(id, workingDirectory, context),
    listPluginDirFiles: (workingDirectory) => listPluginDirFiles(workingDirectory, context),
    readPluginDirFile: (id, workingDirectory) => readPluginDirFile(id, workingDirectory, context),
    writePluginDirFile: (file, workingDirectory, opts) => writePluginDirFile(file, workingDirectory, opts, context),
    deletePluginDirFile: (id, workingDirectory) => deletePluginDirFile(id, workingDirectory, context),
    encodePluginId,
    decodePluginId,
    parsePluginRaw,
    serializePluginEntry,
  });
}

export {
  createPluginDataLayer,
  listPluginEntries,
  getPluginEntry,
  createPluginEntry,
  updatePluginEntry,
  deletePluginEntry,
  listPluginDirFiles,
  readPluginDirFile,
  writePluginDirFile,
  deletePluginDirFile,
  encodePluginId,
  decodePluginId,
  parsePluginRaw,
  serializePluginEntry,
};

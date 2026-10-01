import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import { readMcpEntry, readSectionEntry } from './config-v2.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';

// ============== PATH CONSTANTS ==============

const OPENCODE_CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config'),
  'opencode',
);

/**
 * v2-track config discovery (spine OC2-S3, upstream `654705f7d`): OpenCode 2
 * resolves its global config directory as `OPENCODE_CONFIG_DIR` when set, else
 * `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`. OpenCode 1.x never
 * reads `OPENCODE_CONFIG_DIR`, so the env is honored only on the v2 track to
 * keep the fork and the managed binary looking at the same files.
 */
const v2TrackActive = () => resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2';

const resolveOpencodeConfigDir = () => {
  if (v2TrackActive()) {
    const configured = process.env.OPENCODE_CONFIG_DIR?.trim();
    if (configured) return path.resolve(configured);
  }
  return OPENCODE_CONFIG_DIR;
};
const AGENT_DIR = path.join(OPENCODE_CONFIG_DIR, 'agents');
const COMMAND_DIR = path.join(OPENCODE_CONFIG_DIR, 'commands');
const SKILL_DIR = path.join(OPENCODE_CONFIG_DIR, 'skills');
const CONFIG_FILE = path.join(OPENCODE_CONFIG_DIR, 'config.json');
const CUSTOM_CONFIG_FILE = process.env.OPENCODE_CONFIG
  ? path.resolve(process.env.OPENCODE_CONFIG)
  : null;
const PROMPT_FILE_PATTERN = /^\{file:(.+)\}$/i;

// ============== SCOPE TYPE CONSTANTS ==============

const AGENT_SCOPE = {
  USER: 'user',
  PROJECT: 'project'
};

const COMMAND_SCOPE = {
  USER: 'user',
  PROJECT: 'project'
};

const SKILL_SCOPE = {
  USER: 'user',
  PROJECT: 'project'
};

// ============== DIRECTORY OPERATIONS ==============

function ensureDirs() {
  if (!fs.existsSync(OPENCODE_CONFIG_DIR)) {
    fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(AGENT_DIR)) {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
  }
  if (!fs.existsSync(COMMAND_DIR)) {
    fs.mkdirSync(COMMAND_DIR, { recursive: true });
  }
  if (!fs.existsSync(SKILL_DIR)) {
    fs.mkdirSync(SKILL_DIR, { recursive: true });
  }
}

// ============== MARKDOWN FILE OPERATIONS ==============

function parseMdFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  let frontmatter = {};
  try {
    frontmatter = yaml.parse(match[1]) || {};
  } catch (error) {
    console.warn(`Failed to parse markdown frontmatter ${filePath}, treating as empty:`, error);
    frontmatter = {};
  }

  const body = match[2].trim();
  return { frontmatter, body };
}

function writeMdFile(filePath, frontmatter, body) {
  try {
    const cleanedFrontmatter = Object.fromEntries(
      Object.entries(frontmatter).filter(([, value]) => value != null)
    );
    const yamlStr = yaml.stringify(cleanedFrontmatter);
    const content = `---\n${yamlStr}---\n\n${body}`;
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Successfully wrote markdown file: ${filePath}`);
  } catch (error) {
    console.error(`Failed to write markdown file ${filePath}:`, error);
    throw new Error('Failed to write agent markdown file');
  }
}

// ============== CONFIG FILE OPERATIONS ==============

function getProjectConfigCandidates(workingDirectory) {
  if (!workingDirectory) return [];
  if (v2TrackActive()) {
    // OpenCode 2 lets a file under `.opencode/` override the one beside it at
    // the project root (upstream `654705f7d`), so the highest-priority file is
    // the one OpenChamber reads and writes for the project scope.
    return [
      path.join(workingDirectory, '.opencode', 'opencode.json'),
      path.join(workingDirectory, '.opencode', 'opencode.jsonc'),
      path.join(workingDirectory, 'opencode.json'),
      path.join(workingDirectory, 'opencode.jsonc'),
    ];
  }
  return [
    path.join(workingDirectory, 'opencode.json'),
    path.join(workingDirectory, 'opencode.jsonc'),
    path.join(workingDirectory, '.opencode', 'opencode.json'),
    path.join(workingDirectory, '.opencode', 'opencode.jsonc'),
  ];
}

function getProjectConfigPath(workingDirectory) {
  if (!workingDirectory) return null;

  const candidates = getProjectConfigCandidates(workingDirectory);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function getConfigPaths(workingDirectory) {
  const configDir = resolveOpencodeConfigDir();
  return {
    // OpenCode 2 no longer discovers the v1-era `config.json`, so the v2 track
    // stops reading and writing it (upstream `654705f7d`).
    userPaths: v2TrackActive()
      ? [
        path.join(configDir, 'opencode.json'),
        path.join(configDir, 'opencode.jsonc'),
      ]
      : [
        path.join(OPENCODE_CONFIG_DIR, 'config.json'),
        path.join(OPENCODE_CONFIG_DIR, 'opencode.json'),
        path.join(OPENCODE_CONFIG_DIR, 'opencode.jsonc'),
      ],
    projectPath: getProjectConfigPath(workingDirectory),
    // Resolve at call time so OPENCODE_CONFIG changes (and tests) take effect.
    // CUSTOM_CONFIG_FILE (still exported) is a load-time snapshot only.
    customPath: process.env.OPENCODE_CONFIG
      ? path.resolve(process.env.OPENCODE_CONFIG)
      : null,
  };
}

function getPrimaryUserConfigPath(userPaths) {
  for (const userPath of userPaths) {
    if (fs.existsSync(userPath)) {
      return userPath;
    }
  }

  if (v2TrackActive()) {
    return path.join(resolveOpencodeConfigDir(), 'opencode.json');
  }
  return CONFIG_FILE;
}

const INVALID_JSONC = 'INVALID_JSONC';

function isInvalidJsoncError(error) {
  return Boolean(error && typeof error === 'object' && error.code === INVALID_JSONC);
}

function formatJsoncParseError(filePath, errors) {
  const first = Array.isArray(errors) && errors.length > 0 ? errors[0] : null;
  const location = first && Number.isFinite(first.offset)
    ? ` (${printParseErrorCode(first.error)} at offset ${first.offset})`
    : '';
  return `OpenCode configuration at ${filePath} contains invalid JSONC and cannot be loaded safely${location}`;
}

function isCommentOnlyParse(parsed, errors) {
  return parsed === undefined
    && errors.every((entry) => printParseErrorCode(entry.error) === 'ValueExpected');
}

function parseConfigObject(content, filePath) {
  const errors = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true });
  if (isCommentOnlyParse(parsed, errors)) {
    return {};
  }
  if (errors.length > 0 || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error(formatJsoncParseError(filePath, errors));
    error.code = INVALID_JSONC;
    throw error;
  }
  return parsed;
}

function readConfigFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const normalized = content.trim();
    if (!normalized) {
      return {};
    }
    return parseConfigObject(normalized, filePath);
  } catch (error) {
    if (isInvalidJsoncError(error)) {
      throw error;
    }
    console.error(`Failed to read config file: ${filePath}`, error);
    throw new Error('Failed to read OpenCode configuration');
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfigs(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key in result) {
      const baseValue = result[key];
      if (isPlainObject(baseValue) && isPlainObject(value)) {
        result[key] = mergeConfigs(baseValue, value);
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function readConfigLayer(filePath) {
  try {
    return { config: readConfigFile(filePath), error: null };
  } catch (error) {
    if (isInvalidJsoncError(error)) {
      console.error(error.message);
      return { config: {}, error };
    }
    throw error;
  }
}

function readConfigLayers(workingDirectory) {
  const { userPaths, projectPath, customPath } = getConfigPaths(workingDirectory);
  const userPath = getPrimaryUserConfigPath(userPaths);
  // OpenCode loads every global config file in order, so an `opencode.jsonc`
  // next to `opencode.json` overrides it. New entries still go to the primary
  // file; entries found in the override are edited where they live.
  const userOverridePath = userPaths.find((candidate) => candidate !== userPath && fs.existsSync(candidate)) ?? null;
  const userLayer = readConfigLayer(userPath);
  const userOverrideLayer = readConfigLayer(userOverridePath);
  const projectLayer = readConfigLayer(projectPath);
  const customLayer = readConfigLayer(customPath);
  const mergedConfig = mergeConfigs(
    mergeConfigs(mergeConfigs(userLayer.config, userOverrideLayer.config), projectLayer.config),
    customLayer.config,
  );

  const layerErrors = [];
  if (userLayer.error) {
    layerErrors.push({ path: userPath, code: userLayer.error.code, message: userLayer.error.message });
  }
  if (userOverrideLayer.error && userOverridePath) {
    layerErrors.push({ path: userOverridePath, code: userOverrideLayer.error.code, message: userOverrideLayer.error.message });
  }
  if (projectLayer.error && projectPath) {
    layerErrors.push({ path: projectPath, code: projectLayer.error.code, message: projectLayer.error.message });
  }
  if (customLayer.error && customPath) {
    layerErrors.push({ path: customPath, code: customLayer.error.code, message: customLayer.error.message });
  }

  return {
    userConfig: userLayer.config,
    userOverrideConfig: userOverrideLayer.config,
    projectConfig: projectLayer.config,
    customConfig: customLayer.config,
    mergedConfig,
    paths: { userPath, userOverridePath, projectPath, customPath },
    layerErrors,
  };
}

function readConfig(workingDirectory) {
  return readConfigLayers(workingDirectory).mergedConfig;
}

function getConfigForPath(layers, targetPath) {
  if (!targetPath) {
    return layers.userConfig;
  }
  if (layers.paths.customPath && targetPath === layers.paths.customPath) {
    return layers.customConfig;
  }
  if (layers.paths.projectPath && targetPath === layers.paths.projectPath) {
    return layers.projectConfig;
  }
  return layers.userConfig;
}

function writeConfig(config, filePath = CONFIG_FILE) {
  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf8').trim();
      if (existing) {
        parseConfigObject(existing, filePath);
      }
      const backupFile = `${filePath}.openchamber.backup`;
      fs.copyFileSync(filePath, backupFile);
      console.log(`Created config backup: ${backupFile}`);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`Successfully wrote config file: ${filePath}`);
  } catch (error) {
    if (isInvalidJsoncError(error)) {
      throw error;
    }
    console.error(`Failed to write config file: ${filePath}`, error);
    throw new Error('Failed to write OpenCode configuration');
  }
}

function getLayerError(layers, filePath) {
  if (!filePath || !Array.isArray(layers?.layerErrors)) {
    return null;
  }
  return layers.layerErrors.find((entry) => entry.path === filePath) || null;
}

function throwIfLayerError(layers, filePath) {
  const failed = getLayerError(layers, filePath);
  if (!failed) return;
  const error = new Error(failed.message);
  error.code = failed.code;
  throw error;
}

/**
 * Look one entry up in a config object, accepting both OpenCode 2 section keys
 * (`agents`/`commands`/`providers`, `mcp.servers`) and the v1 keys v2 still
 * decodes (`agent`/`command`/`provider`, flat `mcp`). `sectionKind` is
 * `agents`, `commands`, `providers`, or `mcp`. Returns the section key the
 * entry was found under so writers can rewrite the same file in place.
 */
function lookupSectionEntry(config, sectionKind, entryName) {
  if (sectionKind === 'mcp') {
    return readMcpEntry(config, entryName);
  }
  return readSectionEntry(config, sectionKind, entryName);
}

function getJsonEntrySource(layers, sectionKey, entryName) {
  const { userConfig, userOverrideConfig, projectConfig, customConfig, paths } = layers;
  // On the v2 track an entry may live under either spelling; look both up and
  // report where it was found so the v2 writer can rewrite it in place.
  const findEntry = v2TrackActive()
    ? (config, filePath) => {
      const entry = lookupSectionEntry(config, sectionKey, entryName);
      if (entry.value === undefined) return null;
      return {
        section: entry.value,
        config,
        path: filePath,
        exists: true,
        sectionKey: entry.key,
        legacy: entry.legacy,
      };
    }
    : (config, filePath) => {
      const section = config?.[sectionKey]?.[entryName];
      return section !== undefined
        ? { section, config, path: filePath, exists: true }
        : null;
    };

  if (paths.customPath) {
    throwIfLayerError(layers, paths.customPath);
    const custom = findEntry(customConfig, paths.customPath);
    if (custom) return custom;
  }

  if (paths.projectPath && !getLayerError(layers, paths.projectPath)) {
    const project = findEntry(projectConfig, paths.projectPath);
    if (project) return project;
  }

  if (paths.userOverridePath) {
    throwIfLayerError(layers, paths.userOverridePath);
    const userOverride = findEntry(userOverrideConfig, paths.userOverridePath);
    if (userOverride) return userOverride;
  }

  throwIfLayerError(layers, paths.userPath);
  const user = findEntry(userConfig, paths.userPath);
  if (user) return user;

  return { section: null, config: null, path: null, exists: false };
}

function getJsonWriteTarget(layers, preferredScope) {
  const { userConfig, projectConfig, customConfig, paths } = layers;
  if (paths.customPath) {
    throwIfLayerError(layers, paths.customPath);
    return { config: customConfig, path: paths.customPath };
  }
  if (preferredScope === AGENT_SCOPE.PROJECT && paths.projectPath) {
    throwIfLayerError(layers, paths.projectPath);
    return { config: projectConfig, path: paths.projectPath };
  }
  throwIfLayerError(layers, paths.userPath);
  return { config: userConfig, path: paths.userPath };
}

// ============== GIT/WORKTREE HELPERS ==============

function getAncestors(startDir, stopDir) {
  if (!startDir) return [];
  const result = [];
  let current = path.resolve(startDir);
  const resolvedStop = stopDir ? path.resolve(stopDir) : null;

  while (true) {
    result.push(current);
    if (resolvedStop && current === resolvedStop) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return result;
}

function findWorktreeRoot(startDir) {
  if (!startDir) return null;
  let current = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

// ============== PROMPT FILE HELPERS ==============

function isPromptFileReference(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return PROMPT_FILE_PATTERN.test(value.trim());
}

function resolvePromptFilePath(reference) {
  const match = typeof reference === 'string' ? reference.trim().match(PROMPT_FILE_PATTERN) : null;
  if (!match) {
    return null;
  }
  let target = match[1].trim();
  if (!target) {
    return null;
  }

  if (target.startsWith('./')) {
    target = target.slice(2);
    target = path.join(OPENCODE_CONFIG_DIR, target);
  } else if (!path.isAbsolute(target)) {
    target = path.join(OPENCODE_CONFIG_DIR, target);
  }

  return target;
}

function writePromptFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content ?? '', 'utf8');
  console.log(`Updated prompt file: ${filePath}`);
}

// ============== SKILL FILE OPERATIONS ==============

function walkSkillMdFiles(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return [];

  const results = [];
  // Real paths of the directories on the current walk path. Links (symlinks and
  // Windows junctions) are followed at any depth; a link back to one of its own
  // ancestors is skipped instead of recursing forever. Two links to the same
  // target elsewhere in the tree are both walked, as the top level always did.
  const ancestors = new Set();
  const walk = (dir) => {
    let realDir;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (ancestors.has(realDir)) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    ancestors.add(realDir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // Junctions report as links, not directories. A link whose target cannot be
      // stat'ed is skipped, the way an unreadable directory is, instead of failing
      // the whole scan.
      let isDirectoryEntry = entry.isDirectory();
      let isFileEntry = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const target = fs.statSync(fullPath);
          isDirectoryEntry = target.isDirectory();
          isFileEntry = target.isFile();
        } catch {
          continue;
        }
      }
      if (isDirectoryEntry) {
        walk(fullPath);
        continue;
      }
      if (isFileEntry && entry.name === 'SKILL.md') {
        results.push(fullPath);
      }
    }
    ancestors.delete(realDir);
  };

  walk(rootDir);
  return results;
}

function addSkillFromMdFile(skillsMap, skillMdPath, scope, source) {
  let parsed;
  try {
    parsed = parseMdFile(skillMdPath);
  } catch {
    return;
  }

  const name = typeof parsed.frontmatter?.name === 'string'
    ? parsed.frontmatter.name.trim()
    : '';
  const description = typeof parsed.frontmatter?.description === 'string'
    ? parsed.frontmatter.description
    : '';

  if (!name) {
    return;
  }

  skillsMap.set(name, {
    name,
    path: skillMdPath,
    scope,
    source,
    description,
  });
}

function resolveSkillSearchDirectories(workingDirectory) {
  const directories = [];
  const pushDir = (dir) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!directories.includes(resolved)) {
      directories.push(resolved);
    }
  };

  pushDir(OPENCODE_CONFIG_DIR);

  if (workingDirectory) {
    const worktreeRoot = findWorktreeRoot(workingDirectory) || path.resolve(workingDirectory);
    const projectDirs = getAncestors(workingDirectory, worktreeRoot)
      .map((dir) => path.join(dir, '.opencode'));
    projectDirs.forEach(pushDir);
  }

  pushDir(path.join(os.homedir(), '.opencode'));

  const customConfigDir = process.env.OPENCODE_CONFIG_DIR
    ? path.resolve(process.env.OPENCODE_CONFIG_DIR)
    : null;
  pushDir(customConfigDir);

  return directories;
}

function listSkillSupportingFiles(skillDir) {
  if (!fs.existsSync(skillDir)) {
    return [];
  }

  const files = [];

  function walkDir(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        walkDir(fullPath, relPath);
      } else if (entry.name !== 'SKILL.md') {
        files.push({
          name: entry.name,
          path: relPath,
          fullPath: fullPath
        });
      }
    }
  }

  walkDir(skillDir);
  return files;
}

function assertPathWithinSkillDir(skillDir, relativePath) {
  const root = fs.realpathSync(skillDir);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  const isWithin = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

  if (!isWithin) {
    const error = new Error('Access to file denied');
    error.code = 'EACCES';
    throw error;
  }

  return target;
}

function readSkillSupportingFile(skillDir, relativePath) {
  const fullPath = assertPathWithinSkillDir(skillDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function writeSkillSupportingFile(skillDir, relativePath, content) {
  const fullPath = assertPathWithinSkillDir(skillDir, relativePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function deleteSkillSupportingFile(skillDir, relativePath) {
  const root = fs.realpathSync(skillDir);
  const fullPath = assertPathWithinSkillDir(skillDir, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    let parentDir = path.dirname(fullPath);
    while (parentDir !== root) {
      try {
        const entries = fs.readdirSync(parentDir);
        if (entries.length === 0) {
          fs.rmdirSync(parentDir);
          parentDir = path.dirname(parentDir);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }
}

export {
  OPENCODE_CONFIG_DIR,
  AGENT_DIR,
  COMMAND_DIR,
  SKILL_DIR,
  CONFIG_FILE,
  CUSTOM_CONFIG_FILE,
  PROMPT_FILE_PATTERN,
  AGENT_SCOPE,
  COMMAND_SCOPE,
  SKILL_SCOPE,
  ensureDirs,
  parseMdFile,
  writeMdFile,
  getProjectConfigCandidates,
  getProjectConfigPath,
  getConfigPaths,
  readConfigFile,
  readConfigLayer,
  isPlainObject,
  mergeConfigs,
  readConfigLayers,
  readConfig,
  getConfigForPath,
  writeConfig,
  lookupSectionEntry,
  getJsonEntrySource,
  getJsonWriteTarget,
  getAncestors,
  findWorktreeRoot,
  isPromptFileReference,
  resolvePromptFilePath,
  writePromptFile,
  walkSkillMdFiles,
  addSkillFromMdFile,
  resolveSkillSearchDirectories,
  listSkillSupportingFiles,
  readSkillSupportingFile,
  writeSkillSupportingFile,
  deleteSkillSupportingFile,
};

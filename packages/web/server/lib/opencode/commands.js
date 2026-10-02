import fs from 'fs';
import path from 'path';
import {
  CONFIG_FILE,
  OPENCODE_CONFIG_DIR,
  COMMAND_DIR,
  COMMAND_SCOPE,
  ensureDirs,
  parseMdFile,
  writeMdFile,
  readConfigLayers,
  writeConfig,
  getAncestors,
  findWorktreeRoot,
  getJsonEntrySource,
  getJsonWriteTarget,
  isPromptFileReference,
  resolvePromptFilePath,
  writePromptFile,
} from './shared.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';
import {
  toCommandEntity,
  fromCommandEntity,
  isLegacyCommandFrontmatter,
  writeSectionEntry,
  deleteSectionEntry,
  parseModelSelection,
  formatModelSelection,
  isRecord,
} from './config-v2.js';

// ============== COMMAND SCOPE HELPERS ==============

/**
 * Ensure project-level command directory exists
 */
function ensureProjectCommandDir(workingDirectory) {
  const projectCommandDir = path.join(workingDirectory, '.opencode', 'commands');
  if (!fs.existsSync(projectCommandDir)) {
    fs.mkdirSync(projectCommandDir, { recursive: true });
  }
  const legacyProjectCommandDir = path.join(workingDirectory, '.opencode', 'command');
  if (!fs.existsSync(legacyProjectCommandDir)) {
    fs.mkdirSync(legacyProjectCommandDir, { recursive: true });
  }
  return projectCommandDir;
}

/**
 * Get project-level command path
 */
function getProjectCommandPath(workingDirectory, commandName) {
  const pluralPath = path.join(workingDirectory, '.opencode', 'commands', `${commandName}.md`);
  const legacyPath = path.join(workingDirectory, '.opencode', 'command', `${commandName}.md`);
  if (fs.existsSync(legacyPath) && !fs.existsSync(pluralPath)) return legacyPath;
  return pluralPath;
}

/**
 * Get user-level command path
 */
function getUserCommandPath(commandName) {
  const pluralPath = path.join(COMMAND_DIR, `${commandName}.md`);
  const legacyPath = path.join(OPENCODE_CONFIG_DIR, 'command', `${commandName}.md`);
  if (fs.existsSync(legacyPath) && !fs.existsSync(pluralPath)) return legacyPath;
  return pluralPath;
}

/**
 * Determine command scope based on where the .md file exists
 * Priority: project level > user level > null (built-in only)
 */
function getCommandScope(commandName, workingDirectory) {
  if (v2TrackActive()) {
    if (workingDirectory) {
      const projectPath = v2ProjectCommandPath(workingDirectory, commandName);
      if (fs.existsSync(projectPath)) {
        return { scope: COMMAND_SCOPE.PROJECT, path: projectPath };
      }
    }
    const v2UserPath = v2UserCommandPath(commandName);
    if (fs.existsSync(v2UserPath)) {
      return { scope: COMMAND_SCOPE.USER, path: v2UserPath };
    }
    return { scope: null, path: null };
  }

  if (workingDirectory) {
    const projectPath = getProjectCommandPath(workingDirectory, commandName);
    if (fs.existsSync(projectPath)) {
      return { scope: COMMAND_SCOPE.PROJECT, path: projectPath };
    }
  }
  
  const userPath = getUserCommandPath(commandName);
  if (fs.existsSync(userPath)) {
    return { scope: COMMAND_SCOPE.USER, path: userPath };
  }
  
  return { scope: null, path: null };
}

/**
 * Get the path where a command should be written based on scope
 */
function getCommandWritePath(commandName, workingDirectory, requestedScope) {
  // For updates: check existing location first (project takes precedence)
  const existing = getCommandScope(commandName, workingDirectory);
  if (existing.path) {
    return existing;
  }
  
  // For new commands or built-in overrides: use requested scope or default to user
  const scope = requestedScope || COMMAND_SCOPE.USER;
  if (scope === COMMAND_SCOPE.PROJECT && workingDirectory) {
    if (v2TrackActive()) {
      return {
        scope: COMMAND_SCOPE.PROJECT,
        path: v2ProjectCommandPath(workingDirectory, commandName)
      };
    }
    return {
      scope: COMMAND_SCOPE.PROJECT,
      path: getProjectCommandPath(workingDirectory, commandName)
    };
  }

  if (v2TrackActive()) {
    return {
      scope: COMMAND_SCOPE.USER,
      path: v2UserCommandPath(commandName)
    };
  }

  return {
    scope: COMMAND_SCOPE.USER,
    path: getUserCommandPath(commandName)
  };
}

// ============== V2 TRACK (spine OC2-S8 leftover of S3, upstream `654705f7d`) ==============
//
// OpenCode 2 discovers commands from `command/` and `commands/`. OpenChamber
// reads both and writes only `commands/`; a command already living in the v1
// directory is rewritten at its own path in v2 shape. Every v2 code path below
// is gated on the recorded protocol mode; the v1 track above never enters it.

const v2TrackActive = () => resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2';

const V2_USER_COMMAND_DIRS = [COMMAND_DIR, path.join(OPENCODE_CONFIG_DIR, 'command')];
const V2_PROJECT_COMMAND_DIR_NAMES = ['commands', 'command'];

function v2ProjectCommandPath(workingDirectory, commandName) {
  const preferred = path.join(workingDirectory, '.opencode', 'commands', `${commandName}.md`);
  // Same walk as agents: every `.opencode` from the working directory up to
  // the project root is a source; nested names (`team/review`) map onto paths.
  const worktreeRoot = findWorktreeRoot(workingDirectory) || path.resolve(workingDirectory);
  for (const base of getAncestors(workingDirectory, worktreeRoot)) {
    for (const dirName of V2_PROJECT_COMMAND_DIR_NAMES) {
      const candidate = path.join(base, '.opencode', dirName, `${commandName}.md`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return preferred;
}

function v2UserCommandPath(commandName) {
  const preferred = path.join(COMMAND_DIR, `${commandName}.md`);
  for (const dir of V2_USER_COMMAND_DIRS) {
    const candidate = path.join(dir, `${commandName}.md`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return preferred;
}

function getCommandSourcesV2(commandName, workingDirectory) {
  const projectPath = workingDirectory ? v2ProjectCommandPath(workingDirectory, commandName) : null;
  const projectExists = Boolean(projectPath) && fs.existsSync(projectPath);

  const userPath = v2UserCommandPath(commandName);
  const userExists = fs.existsSync(userPath);

  const mdPath = projectExists ? projectPath : (userExists ? userPath : null);
  const mdExists = Boolean(mdPath);
  const mdScope = projectExists ? COMMAND_SCOPE.PROJECT : (userExists ? COMMAND_SCOPE.USER : null);

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'commands', commandName);
  const jsonPath = jsonSource.path || layers.paths.customPath || layers.paths.projectPath || layers.paths.userPath;
  const jsonScope = jsonSource.path === layers.paths.projectPath ? COMMAND_SCOPE.PROJECT : COMMAND_SCOPE.USER;

  const sources = {
    md: {
      exists: mdExists,
      path: mdPath,
      scope: mdScope,
      legacy: false,
      fields: [],
    },
    json: {
      exists: jsonSource.exists,
      path: jsonPath,
      scope: jsonSource.exists ? jsonScope : null,
      sectionKey: jsonSource.sectionKey,
      legacy: Boolean(jsonSource.legacy),
      fields: [],
    },
    projectMd: {
      exists: projectExists,
      path: projectPath,
    },
    userMd: {
      exists: userExists,
      path: userPath,
    },
  };

  if (mdExists) {
    const { frontmatter, body } = parseMdFile(mdPath);
    sources.md.legacy = isLegacyCommandFrontmatter(frontmatter);
    sources.md.fields = Object.keys(toCommandEntity(frontmatter, body));
  }

  if (jsonSource.exists) {
    sources.json.fields = Object.keys(toCommandEntity(jsonSource.section));
  }

  return sources;
}

/** Canonical v2 command entity plus where it came from. */
function getCommandConfig(commandName, workingDirectory) {
  const mdPath = workingDirectory ? v2ProjectCommandPath(workingDirectory, commandName) : null;
  const projectExists = Boolean(mdPath) && fs.existsSync(mdPath);
  const userPath = v2UserCommandPath(commandName);
  const userExists = fs.existsSync(userPath);

  if (projectExists || userExists) {
    const targetPath = projectExists ? mdPath : userPath;
    const { frontmatter, body } = parseMdFile(targetPath);
    return {
      source: 'md',
      scope: projectExists ? COMMAND_SCOPE.PROJECT : COMMAND_SCOPE.USER,
      path: targetPath,
      legacy: isLegacyCommandFrontmatter(frontmatter),
      config: toCommandEntity(frontmatter, body),
    };
  }

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'commands', commandName);
  if (jsonSource.exists) {
    return {
      source: 'json',
      scope: jsonSource.path === layers.paths.projectPath ? COMMAND_SCOPE.PROJECT : COMMAND_SCOPE.USER,
      path: jsonSource.path,
      legacy: Boolean(jsonSource.legacy),
      config: toCommandEntity(jsonSource.section),
    };
  }

  return { source: 'none', scope: null, path: null, legacy: false, config: {} };
}

function writeCommandMd(targetPath, entity) {
  const { fields, template } = fromCommandEntity(entity);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeMdFile(targetPath, fields, template);
}

// Clearing a v1 field has to reach its v2 location: `subtask` is `subagent`,
// and `variant` is the suffix on `model`.
function deleteCommandField(entity, field) {
  if (field === 'variant') {
    const parsed = parseModelSelection(entity.model);
    if (!parsed) return;
    const stripped = formatModelSelection({ providerID: parsed.providerID, modelID: parsed.modelID });
    if (stripped) entity.model = stripped;
    return;
  }
  delete entity[field === 'subtask' ? 'subagent' : field];
}

function applyCommandUpdates(entity, updates) {
  const next = { ...entity };
  for (const [field, value] of Object.entries(isRecord(updates) ? updates : {})) {
    if (field === 'scope' || value === undefined) continue;
    if (value === null) {
      deleteCommandField(next, field);
      continue;
    }
    // `subtask` is the v1 spelling of `subagent`; accept it from older clients.
    next[field === 'subtask' ? 'subagent' : field] = value;
  }
  return toCommandEntity(next);
}

function updateCommandV2(commandName, updates, workingDirectory) {
  ensureDirs();

  const current = getCommandConfig(commandName, workingDirectory);
  const entity = applyCommandUpdates(current.config, updates);

  if (current.source === 'md') {
    writeCommandMd(current.path, entity);
    console.log(`Updated command: ${commandName} (md: ${current.path})`);
    return { source: 'md', scope: current.scope, path: current.path };
  }

  if (current.source === 'json') {
    const layers = readConfigLayers(workingDirectory);
    const jsonSource = getJsonEntrySource(layers, 'commands', commandName);
    const config = jsonSource.config || {};
    const rawTemplate = jsonSource.section?.template;
    if (isPromptFileReference(rawTemplate)) {
      const templateFilePath = resolvePromptFilePath(rawTemplate);
      if (!templateFilePath) {
        throw new Error(`Invalid template file reference for command ${commandName}`);
      }
      if (entity.template !== current.config.template) {
        writePromptFile(templateFilePath, entity.template ?? '');
      }
      entity.template = rawTemplate;
    }
    writeSectionEntry(config, 'commands', commandName, entity);
    const targetPath = jsonSource.path || CONFIG_FILE;
    writeConfig(config, targetPath);
    console.log(`Updated command: ${commandName} (json: ${targetPath})`);
    return { source: 'json', scope: current.scope, path: targetPath };
  }

  // Built-in override: materialize a user-level v2 markdown command.
  const targetPath = v2UserCommandPath(commandName);
  writeCommandMd(targetPath, entity);
  console.log(`Created command override: ${commandName} (scope: ${COMMAND_SCOPE.USER}, path: ${targetPath})`);
  return { source: 'md', scope: COMMAND_SCOPE.USER, path: targetPath };
}

function deleteCommandV2(commandName, workingDirectory) {
  let deleted = false;

  if (workingDirectory) {
    const projectPath = v2ProjectCommandPath(workingDirectory, commandName);
    if (fs.existsSync(projectPath)) {
      fs.unlinkSync(projectPath);
      console.log(`Deleted project-level command .md file: ${projectPath}`);
      deleted = true;
    }
  }

  const userPath = v2UserCommandPath(commandName);
  if (fs.existsSync(userPath)) {
    fs.unlinkSync(userPath);
    console.log(`Deleted user-level command .md file: ${userPath}`);
    deleted = true;
  }

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'commands', commandName);
  if (jsonSource.exists && jsonSource.config && jsonSource.path
    && deleteSectionEntry(jsonSource.config, 'commands', commandName)) {
    writeConfig(jsonSource.config, jsonSource.path);
    console.log(`Removed command from opencode.json: ${commandName}`);
    deleted = true;
  }

  if (!deleted) {
    throw new Error(`Command "${commandName}" not found`);
  }
}

// ============== END V2 TRACK ==============

function getCommandSources(commandName, workingDirectory) {
  if (v2TrackActive()) {
    return getCommandSourcesV2(commandName, workingDirectory);
  }

  const projectPath = workingDirectory ? getProjectCommandPath(workingDirectory, commandName) : null;
  const projectExists = projectPath && fs.existsSync(projectPath);

  const userPath = getUserCommandPath(commandName);
  const userExists = fs.existsSync(userPath);

  const mdPath = projectExists ? projectPath : (userExists ? userPath : null);
  const mdExists = !!mdPath;
  const mdScope = projectExists ? COMMAND_SCOPE.PROJECT : (userExists ? COMMAND_SCOPE.USER : null);

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'command', commandName);
  const jsonSection = jsonSource.section;
  const jsonPath = jsonSource.path || layers.paths.customPath || layers.paths.projectPath || layers.paths.userPath;
  const jsonScope = jsonSource.path === layers.paths.projectPath ? COMMAND_SCOPE.PROJECT : COMMAND_SCOPE.USER;

  const sources = {
    md: {
      exists: mdExists,
      path: mdPath,
      scope: mdScope,
      fields: []
    },
    json: {
      exists: jsonSource.exists,
      path: jsonPath,
      scope: jsonSource.exists ? jsonScope : null,
      fields: []
    },
    projectMd: {
      exists: projectExists,
      path: projectPath
    },
    userMd: {
      exists: userExists,
      path: userPath
    }
  };

  if (mdExists) {
    const { frontmatter, body } = parseMdFile(mdPath);
    sources.md.fields = Object.keys(frontmatter);
    if (body) {
      sources.md.fields.push('template');
    }
  }

  if (jsonSection) {
    sources.json.fields = Object.keys(jsonSection);
  }

  return sources;
}

function createCommand(commandName, config, workingDirectory, scope) {
  ensureDirs();

  if (v2TrackActive()) {
    const v2ProjectPath = workingDirectory ? v2ProjectCommandPath(workingDirectory, commandName) : null;
    const v2UserPath = v2UserCommandPath(commandName);

    if (v2ProjectPath && fs.existsSync(v2ProjectPath)) {
      throw new Error(`Command ${commandName} already exists as project-level .md file`);
    }

    if (fs.existsSync(v2UserPath)) {
      throw new Error(`Command ${commandName} already exists as user-level .md file`);
    }

    const v2Layers = readConfigLayers(workingDirectory);
    if (getJsonEntrySource(v2Layers, 'commands', commandName).exists) {
      throw new Error(`Command ${commandName} already exists in opencode.json`);
    }

    let v2TargetPath;
    let v2TargetScope;

    if (scope === COMMAND_SCOPE.PROJECT && workingDirectory) {
      fs.mkdirSync(path.join(workingDirectory, '.opencode', 'commands'), { recursive: true });
      v2TargetPath = v2ProjectPath;
      v2TargetScope = COMMAND_SCOPE.PROJECT;
    } else {
      v2TargetPath = v2UserPath;
      v2TargetScope = COMMAND_SCOPE.USER;
    }

    const { scope: _ignoredScope, ...entity } = isRecord(config) ? config : {};
    writeCommandMd(v2TargetPath, entity);
    console.log(`Created new command: ${commandName} (scope: ${v2TargetScope}, path: ${v2TargetPath})`);
    return { scope: v2TargetScope, path: v2TargetPath };
  }

  const projectPath = workingDirectory ? getProjectCommandPath(workingDirectory, commandName) : null;
  const userPath = getUserCommandPath(commandName);

  if (projectPath && fs.existsSync(projectPath)) {
    throw new Error(`Command ${commandName} already exists as project-level .md file`);
  }

  if (fs.existsSync(userPath)) {
    throw new Error(`Command ${commandName} already exists as user-level .md file`);
  }

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'command', commandName);
  if (jsonSource.exists) {
    throw new Error(`Command ${commandName} already exists in opencode.json`);
  }

  let targetPath;
  let targetScope;

  if (scope === COMMAND_SCOPE.PROJECT && workingDirectory) {
    ensureProjectCommandDir(workingDirectory);
    targetPath = projectPath;
    targetScope = COMMAND_SCOPE.PROJECT;
  } else {
    targetPath = userPath;
    targetScope = COMMAND_SCOPE.USER;
  }

  const { template, scope: _scopeFromConfig, ...frontmatter } = config;

  writeMdFile(targetPath, frontmatter, template || '');
  console.log(`Created new command: ${commandName} (scope: ${targetScope}, path: ${targetPath})`);
}

function updateCommand(commandName, updates, workingDirectory) {
  ensureDirs();

  if (v2TrackActive()) {
    return updateCommandV2(commandName, updates, workingDirectory);
  }

  const { scope, path: mdPath } = getCommandWritePath(commandName, workingDirectory);
  const mdExists = mdPath && fs.existsSync(mdPath);

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'command', commandName);
  const jsonSection = jsonSource.section;
  const hasJsonFields = jsonSource.exists && jsonSection && Object.keys(jsonSection).length > 0;
  const jsonTarget = jsonSource.exists
    ? { config: jsonSource.config, path: jsonSource.path }
    : getJsonWriteTarget(layers, workingDirectory ? COMMAND_SCOPE.PROJECT : COMMAND_SCOPE.USER);
  let config = jsonTarget.config || {};

  const isBuiltinOverride = !mdExists && !hasJsonFields;

  let targetPath = mdPath;
  let targetScope = scope;

  if (!mdExists && isBuiltinOverride) {
    targetPath = getUserCommandPath(commandName);
    targetScope = COMMAND_SCOPE.USER;
  }

  const mdData = mdExists ? parseMdFile(mdPath) : (isBuiltinOverride ? { frontmatter: {}, body: '' } : null);

  let mdModified = false;
  let jsonModified = false;
  const creatingNewMd = isBuiltinOverride;

  for (const [field, value] of Object.entries(updates)) {
    if (field === 'template') {
      const normalizedValue = typeof value === 'string' ? value : (value == null ? '' : String(value));

      if (mdExists || creatingNewMd) {
        if (mdData) {
          mdData.body = normalizedValue;
          mdModified = true;
        }
        continue;
      } else if (isPromptFileReference(jsonSection?.template)) {
        const templateFilePath = resolvePromptFilePath(jsonSection.template);
        if (!templateFilePath) {
          throw new Error(`Invalid template file reference for command ${commandName}`);
        }
        writePromptFile(templateFilePath, normalizedValue);
        continue;
      } else if (isPromptFileReference(normalizedValue)) {
        if (!config.command) config.command = {};
        if (!config.command[commandName]) config.command[commandName] = {};
        config.command[commandName].template = normalizedValue;
        jsonModified = true;
        continue;
      }

      if (!config.command) config.command = {};
      if (!config.command[commandName]) config.command[commandName] = {};
      config.command[commandName].template = normalizedValue;
      jsonModified = true;
      continue;
    }

    const inMd = mdData?.frontmatter?.[field] !== undefined;
    const inJson = jsonSection?.[field] !== undefined;

    if (inJson) {
      if (!config.command) config.command = {};
      if (!config.command[commandName]) config.command[commandName] = {};
      config.command[commandName][field] = value;
      jsonModified = true;
    } else if (inMd || creatingNewMd) {
      if (mdData) {
        mdData.frontmatter[field] = value;
        mdModified = true;
      }
    } else {
      if ((mdExists || creatingNewMd) && mdData) {
        mdData.frontmatter[field] = value;
        mdModified = true;
      } else {
        if (!config.command) config.command = {};
        if (!config.command[commandName]) config.command[commandName] = {};
        config.command[commandName][field] = value;
        jsonModified = true;
      }
    }
  }

  if (mdModified && mdData) {
    writeMdFile(targetPath, mdData.frontmatter, mdData.body);
  }

  if (jsonModified) {
    writeConfig(config, jsonTarget.path || CONFIG_FILE);
  }

  console.log(`Updated command: ${commandName} (scope: ${targetScope}, md: ${mdModified}, json: ${jsonModified})`);
}

function deleteCommand(commandName, workingDirectory) {
  if (v2TrackActive()) {
    return deleteCommandV2(commandName, workingDirectory);
  }

  let deleted = false;

  if (workingDirectory) {
    const projectPath = getProjectCommandPath(workingDirectory, commandName);
    if (fs.existsSync(projectPath)) {
      fs.unlinkSync(projectPath);
      console.log(`Deleted project-level command .md file: ${projectPath}`);
      deleted = true;
    }
  }

  const userPath = getUserCommandPath(commandName);
  if (fs.existsSync(userPath)) {
    fs.unlinkSync(userPath);
    console.log(`Deleted user-level command .md file: ${userPath}`);
    deleted = true;
  }

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'command', commandName);
  if (jsonSource.exists && jsonSource.config && jsonSource.path) {
    if (!jsonSource.config.command) jsonSource.config.command = {};
    delete jsonSource.config.command[commandName];
    writeConfig(jsonSource.config, jsonSource.path);
    console.log(`Removed command from opencode.json: ${commandName}`);
    deleted = true;
  }

  if (!deleted) {
    throw new Error(`Command "${commandName}" not found`);
  }
}

export {
  ensureProjectCommandDir,
  getProjectCommandPath,
  getUserCommandPath,
  getCommandScope,
  getCommandWritePath,
  getCommandSources,
  getCommandConfig,
  createCommand,
  updateCommand,
  deleteCommand,
};

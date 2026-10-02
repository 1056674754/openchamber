import fs from 'fs';
import path from 'path';
import {
  CONFIG_FILE,
  AGENT_DIR,
  AGENT_SCOPE,
  OPENCODE_CONFIG_DIR,
  ensureDirs,
  parseMdFile,
  writeMdFile,
  readConfigLayers,
  readConfigFile,
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
  toAgentEntity,
  fromAgentEntity,
  isLegacyAgentFrontmatter,
  writeSectionEntry,
  deleteSectionEntry,
  effectiveAgentRules,
  readGlobalPermissionRules,
  normalizePermissionRules,
  parseModelSelection,
  formatModelSelection,
  isRecord,
} from './config-v2.js';

// ============== AGENT SCOPE HELPERS ==============

/**
 * Ensure project-level agent directory exists
 */
function ensureProjectAgentDir(workingDirectory) {
  const projectAgentDir = path.join(workingDirectory, '.opencode', 'agents');
  if (!fs.existsSync(projectAgentDir)) {
    fs.mkdirSync(projectAgentDir, { recursive: true });
  }
  const legacyProjectAgentDir = path.join(workingDirectory, '.opencode', 'agent');
  if (!fs.existsSync(legacyProjectAgentDir)) {
    fs.mkdirSync(legacyProjectAgentDir, { recursive: true });
  }
  return projectAgentDir;
}

/**
 * Get project-level agent path
 */
function getProjectAgentPath(workingDirectory, agentName) {
  const pluralPath = path.join(workingDirectory, '.opencode', 'agents', `${agentName}.md`);
  const legacyPath = path.join(workingDirectory, '.opencode', 'agent', `${agentName}.md`);
  if (fs.existsSync(legacyPath) && !fs.existsSync(pluralPath)) return legacyPath;
  return pluralPath;
}

/**
 * Create a per-request lookup cache for user-level agent path resolution.
 */
function createAgentLookupCache() {
  return {
    userAgentIndexByName: new Map(),
    userAgentLookupByName: new Map(),
    userAgentIndexReady: false,
  };
}

function buildUserAgentIndex(cache) {
  if (cache.userAgentIndexReady) return;
  cache.userAgentIndexReady = true;

  if (!fs.existsSync(AGENT_DIR)) return;

  const dirsToVisit = [AGENT_DIR];
  while (dirsToVisit.length > 0) {
    const dir = dirsToVisit.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const agentName = entry.name.slice(0, -3);
      if (!cache.userAgentIndexByName.has(agentName)) {
        cache.userAgentIndexByName.set(agentName, path.join(dir, entry.name));
      }
    }

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry.isDirectory()) {
        dirsToVisit.push(path.join(dir, entry.name));
      }
    }
  }
}

function getIndexedUserAgentPath(agentName, cache) {
  if (cache.userAgentLookupByName.has(agentName)) {
    return cache.userAgentLookupByName.get(agentName);
  }

  buildUserAgentIndex(cache);
  const found = cache.userAgentIndexByName.get(agentName) || null;
  cache.userAgentLookupByName.set(agentName, found);
  return found;
}

/**
 * Get user-level agent path — walks subfolders to support grouped layouts.
 * e.g. ~/.config/opencode/agents/business/ceo-diginno.md
 */
function getUserAgentPath(agentName, lookupCache = null) {
  // 1. Check flat path first (legacy / newly created agents)
  const pluralPath = path.join(AGENT_DIR, `${agentName}.md`);
  if (fs.existsSync(pluralPath)) return pluralPath;

  const legacyPath = path.join(AGENT_DIR, '..', 'agent', `${agentName}.md`);
  if (fs.existsSync(legacyPath)) return legacyPath;

  // 2. Lookup subfolders for grouped layout
  const cache = lookupCache || createAgentLookupCache();
  const found = getIndexedUserAgentPath(agentName, cache);
  if (found) return found;

  // 3. Return expected flat path as default (for new agent creation)
  return pluralPath;
}

/**
 * Determine agent scope based on where the .md file exists
 * Priority: project level > user level > null (built-in only)
 */
function getAgentScope(agentName, workingDirectory, lookupCache = null) {
  if (v2TrackActive()) {
    if (workingDirectory) {
      const projectPath = v2ProjectAgentPath(workingDirectory, agentName);
      if (fs.existsSync(projectPath)) {
        return { scope: AGENT_SCOPE.PROJECT, path: projectPath };
      }
    }
    const v2UserPath = v2UserAgentPath(agentName, lookupCache);
    if (fs.existsSync(v2UserPath)) {
      return { scope: AGENT_SCOPE.USER, path: v2UserPath };
    }
    return { scope: null, path: null };
  }

  if (workingDirectory) {
    const projectPath = getProjectAgentPath(workingDirectory, agentName);
    if (fs.existsSync(projectPath)) {
      return { scope: AGENT_SCOPE.PROJECT, path: projectPath };
    }
  }
  
  const userPath = getUserAgentPath(agentName, lookupCache);
  if (fs.existsSync(userPath)) {
    return { scope: AGENT_SCOPE.USER, path: userPath };
  }
  
  return { scope: null, path: null };
}

/**
 * Get the path where an agent should be written based on scope
 */
function getAgentWritePath(agentName, workingDirectory, requestedScope, lookupCache = null) {
  // For updates: check existing location first (project takes precedence)
  const existing = getAgentScope(agentName, workingDirectory, lookupCache);
  if (existing.path) {
    return existing;
  }

  // For new agents or built-in overrides: use requested scope or default to user
  const scope = requestedScope || AGENT_SCOPE.USER;
  if (scope === AGENT_SCOPE.PROJECT && workingDirectory) {
    if (v2TrackActive()) {
      return {
        scope: AGENT_SCOPE.PROJECT,
        path: v2ProjectAgentPath(workingDirectory, agentName),
      };
    }
    return {
      scope: AGENT_SCOPE.PROJECT,
      path: getProjectAgentPath(workingDirectory, agentName)
    };
  }

  if (v2TrackActive()) {
    return {
      scope: AGENT_SCOPE.USER,
      path: v2UserAgentPath(agentName, lookupCache)
    };
  }

  return {
    scope: AGENT_SCOPE.USER,
    path: getUserAgentPath(agentName, lookupCache)
  };
}

// ============== V2 TRACK (spine OC2-S8 leftover of S3, upstream `654705f7d`) ==============
//
// OpenCode 2 discovers agents from `agent/`, `agents/`, `mode/` and `modes/`.
// OpenChamber reads every one of those and WRITES only to `agents/`. An agent
// that already lives in a v1 directory is rewritten in place (v2 fields, same
// path) so no file silently moves out from under the user. Every v2 code path
// below is gated on the recorded protocol mode; the v1 track above never
// enters it.

const v2TrackActive = () => resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2';

const V2_USER_AGENT_DIRS = ['agents', 'agent', 'modes', 'mode'].map((name) => path.join(OPENCODE_CONFIG_DIR, name));
const V2_PROJECT_AGENT_DIR_NAMES = ['agents', 'agent', 'modes', 'mode'];

function v2ProjectAgentPath(workingDirectory, agentName) {
  const preferred = path.join(workingDirectory, '.opencode', 'agents', `${agentName}.md`);
  // OpenCode 2 discovers `.opencode` from the working directory up to the
  // project root, so a definition in a parent directory of a monorepo
  // package counts; nested ids (`team/reviewer`) map onto the path.
  const worktreeRoot = findWorktreeRoot(workingDirectory) || path.resolve(workingDirectory);
  for (const base of getAncestors(workingDirectory, worktreeRoot)) {
    for (const dirName of V2_PROJECT_AGENT_DIR_NAMES) {
      const candidate = path.join(base, '.opencode', dirName, `${agentName}.md`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return preferred;
}

function buildV2UserAgentIndex(cache) {
  if (cache.userAgentIndexReady) return;
  cache.userAgentIndexReady = true;

  const dirsToVisit = V2_USER_AGENT_DIRS.filter((dir) => fs.existsSync(dir));
  while (dirsToVisit.length > 0) {
    const dir = dirsToVisit.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const agentName = entry.name.slice(0, -3);
      if (!cache.userAgentIndexByName.has(agentName)) {
        cache.userAgentIndexByName.set(agentName, path.join(dir, entry.name));
      }
    }

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry.isDirectory()) {
        dirsToVisit.push(path.join(dir, entry.name));
      }
    }
  }
}

function getV2IndexedUserAgentPath(agentName, cache) {
  if (cache.userAgentLookupByName.has(agentName)) {
    return cache.userAgentLookupByName.get(agentName);
  }

  buildV2UserAgentIndex(cache);
  const found = cache.userAgentIndexByName.get(agentName) || null;
  cache.userAgentLookupByName.set(agentName, found);
  return found;
}

/**
 * User-level agent path on the v2 track — walks subfolders to support grouped
 * layouts (e.g. `~/.config/opencode/agents/business/ceo.md`) across every v1
 * and v2 discovery directory. New agents land flat in the v2 `agents/` one.
 */
function v2UserAgentPath(agentName, lookupCache = null) {
  const preferred = path.join(AGENT_DIR, `${agentName}.md`);
  for (const dir of V2_USER_AGENT_DIRS) {
    const candidate = path.join(dir, `${agentName}.md`);
    if (fs.existsSync(candidate)) return candidate;
  }

  const cache = lookupCache || createAgentLookupCache();
  const found = getV2IndexedUserAgentPath(agentName, cache);
  if (found) return found;

  return preferred;
}

function readMdAgent(mdPath) {
  const { frontmatter, body } = parseMdFile(mdPath);
  return {
    entity: toAgentEntity(frontmatter, body),
    frontmatter,
    body,
    legacy: isLegacyAgentFrontmatter(frontmatter),
  };
}

function getAgentSourcesV2(agentName, workingDirectory, lookupCache) {
  const projectPath = workingDirectory ? v2ProjectAgentPath(workingDirectory, agentName) : null;
  const projectExists = Boolean(projectPath) && fs.existsSync(projectPath);

  const userPath = v2UserAgentPath(agentName, lookupCache);
  const userExists = fs.existsSync(userPath);

  const mdPath = projectExists ? projectPath : (userExists ? userPath : null);
  const mdExists = Boolean(mdPath);
  const mdScope = projectExists ? AGENT_SCOPE.PROJECT : (userExists ? AGENT_SCOPE.USER : null);

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'agents', agentName);
  const jsonPath = jsonSource.path || layers.paths.customPath || layers.paths.projectPath || layers.paths.userPath;
  const jsonScope = jsonSource.path === layers.paths.projectPath ? AGENT_SCOPE.PROJECT : AGENT_SCOPE.USER;

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
    const md = readMdAgent(mdPath);
    sources.md.legacy = md.legacy;
    sources.md.fields = Object.keys(md.entity);
  }

  if (jsonSource.exists) {
    sources.json.fields = Object.keys(toAgentEntity(jsonSource.section));
  }

  return sources;
}

/**
 * Canonical v2 agent entity plus where it came from. `config.system` is the
 * markdown body for .md agents; `config.permissions` is always the ordered v2
 * rule array, even when the file still uses a v1 `permission` map.
 */
function getAgentConfigV2(agentName, workingDirectory, lookupCache) {
  const projectPath = workingDirectory ? v2ProjectAgentPath(workingDirectory, agentName) : null;
  const projectExists = Boolean(projectPath) && fs.existsSync(projectPath);

  const userPath = v2UserAgentPath(agentName, lookupCache);
  const userExists = fs.existsSync(userPath);

  if (projectExists || userExists) {
    const mdPath = projectExists ? projectPath : userPath;
    const md = readMdAgent(mdPath);
    return {
      source: 'md',
      scope: projectExists ? AGENT_SCOPE.PROJECT : AGENT_SCOPE.USER,
      path: mdPath,
      legacy: md.legacy,
      config: md.entity,
    };
  }

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'agents', agentName);

  if (jsonSource.exists) {
    const scope = jsonSource.path === layers.paths.projectPath ? AGENT_SCOPE.PROJECT : AGENT_SCOPE.USER;
    return {
      source: 'json',
      scope,
      path: jsonSource.path,
      legacy: Boolean(jsonSource.legacy),
      config: toAgentEntity(jsonSource.section),
    };
  }

  return {
    source: 'none',
    scope: null,
    path: null,
    legacy: false,
    config: {},
  };
}

/**
 * The permission rules that apply to an agent, in evaluation order (global
 * rules first, agent rules last; last match wins). Answers the editor question
 * "what applies to this agent". v2 track only.
 */
function getAgentPermissions(agentName, workingDirectory, lookupCache = createAgentLookupCache()) {
  const layers = readConfigLayers(workingDirectory);
  const global = [
    ...readGlobalPermissionRules(layers.userConfig),
    ...readGlobalPermissionRules(layers.projectConfig),
    ...readGlobalPermissionRules(layers.customConfig),
  ];
  const agent = getAgentConfigV2(agentName, workingDirectory, lookupCache);
  return {
    global,
    agent: agent.config.permissions ?? [],
    effective: effectiveAgentRules(global, agent.config.permissions ?? []),
    source: agent.source,
    path: agent.path,
  };
}

function writeAgentMd(targetPath, entity) {
  const { fields, system } = fromAgentEntity(entity);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // Native keys only: a single legacy key routes the whole file through
  // OpenCode's v1 decoder, which would drop the `permissions` array.
  writeMdFile(targetPath, fields, system);
}

// v1 agent fields that do not exist at the top level of a v2 entity any more.
// A client clearing one of them names the v1 field, so deletion has to reach
// the v2 location instead of removing a key that was never there.
const AGENT_REQUEST_BODY_FIELDS = ['temperature', 'top_p'];

function deleteRequestBodyField(entity, key) {
  if (!isRecord(entity.request) || !isRecord(entity.request.body)) return;
  delete entity.request.body[key];
  if (Object.keys(entity.request.body).length === 0) delete entity.request.body;
  if (Object.keys(entity.request).length === 0) delete entity.request;
}

/** Drop the `#variant` suffix, keeping the provider and model. */
function stripModelVariant(entity) {
  const parsed = parseModelSelection(entity.model);
  if (!parsed) return;
  const stripped = formatModelSelection({ providerID: parsed.providerID, modelID: parsed.modelID });
  if (stripped) entity.model = stripped;
}

function deleteAgentField(entity, field) {
  if (field === 'permission' || field === 'permissions') {
    delete entity.permissions;
    return;
  }
  if (field === 'variant') {
    stripModelVariant(entity);
    return;
  }
  if (AGENT_REQUEST_BODY_FIELDS.includes(field)) {
    deleteRequestBodyField(entity, field);
    return;
  }
  delete entity[field === 'prompt' ? 'system' : field];
}

/**
 * Merge a partial update into a canonical entity. `null` removes a field,
 * `undefined` leaves it alone.
 */
function applyAgentUpdates(entity, updates) {
  // `request` is copied so clearing one overlay field cannot mutate the entity
  // the caller still holds.
  const next = { ...entity };
  if (isRecord(next.request)) {
    const request = { ...next.request };
    if (isRecord(request.body)) request.body = { ...request.body };
    if (isRecord(request.headers)) request.headers = { ...request.headers };
    next.request = request;
  }
  for (const [field, value] of Object.entries(isRecord(updates) ? updates : {})) {
    if (field === 'scope' || value === undefined) continue;
    if (value === null) {
      deleteAgentField(next, field);
      continue;
    }
    if (field === 'permission' || field === 'permissions') {
      const rules = normalizePermissionRules(value);
      if (rules.length === 0) delete next.permissions;
      else next.permissions = rules;
      continue;
    }
    // `prompt` is the v1 spelling of `system`; accept it so older clients keep working.
    next[field === 'prompt' ? 'system' : field] = value;
  }
  return toAgentEntity(next);
}

function updateAgentV2(agentName, updates, workingDirectory) {
  ensureDirs();
  const lookupCache = createAgentLookupCache();

  const current = getAgentConfigV2(agentName, workingDirectory, lookupCache);
  const entity = applyAgentUpdates(current.config, updates);

  if (current.source === 'md') {
    writeAgentMd(current.path, entity);
    console.log(`Updated agent: ${agentName} (md: ${current.path})`);
    return { source: 'md', scope: current.scope, path: current.path };
  }

  if (current.source === 'json') {
    const layers = readConfigLayers(workingDirectory);
    const jsonSource = getJsonEntrySource(layers, 'agents', agentName);
    const config = jsonSource.config || {};
    const rawSystem = jsonSource.section?.system ?? jsonSource.section?.prompt;
    // `{file:...}` substitution still works in OpenCode 2, so an agent whose
    // system prompt lives in a file keeps the reference and the file is edited.
    if (isPromptFileReference(rawSystem)) {
      const promptFilePath = resolvePromptFilePath(rawSystem);
      if (!promptFilePath) {
        throw new Error(`Invalid prompt file reference for agent ${agentName}`);
      }
      if (entity.system !== current.config.system) {
        writePromptFile(promptFilePath, entity.system ?? '');
      }
      entity.system = rawSystem;
    }
    writeSectionEntry(config, 'agents', agentName, entity);
    const targetPath = jsonSource.path || CONFIG_FILE;
    writeConfig(config, targetPath);
    console.log(`Updated agent: ${agentName} (json: ${targetPath})`);
    return { source: 'json', scope: current.scope, path: targetPath };
  }

  // Built-in override: materialize a user-level v2 markdown agent.
  const { scope, path: targetPath } = getAgentWritePath(agentName, workingDirectory, AGENT_SCOPE.USER, lookupCache);
  writeAgentMd(targetPath, entity);
  console.log(`Created agent override: ${agentName} (scope: ${scope}, path: ${targetPath})`);
  return { source: 'md', scope, path: targetPath };
}

function deleteAgentV2(agentName, workingDirectory, scope) {
  const lookupCache = createAgentLookupCache();
  const requestedScope = scope === AGENT_SCOPE.PROJECT || scope === AGENT_SCOPE.USER ? scope : null;

  if ((!requestedScope || requestedScope === AGENT_SCOPE.PROJECT) && workingDirectory) {
    const projectPath = v2ProjectAgentPath(workingDirectory, agentName);
    if (fs.existsSync(projectPath)) {
      fs.unlinkSync(projectPath);
      console.log(`Deleted project-level agent .md file: ${projectPath}`);
      return;
    }
  }

  if (!requestedScope || requestedScope === AGENT_SCOPE.USER) {
    const userPath = v2UserAgentPath(agentName, lookupCache);
    if (fs.existsSync(userPath)) {
      fs.unlinkSync(userPath);
      console.log(`Deleted user-level agent .md file: ${userPath}`);
      return;
    }
  }

  const layers = readConfigLayers(workingDirectory);

  if (requestedScope === AGENT_SCOPE.PROJECT) {
    if (layers.paths.projectPath && deleteSectionEntry(layers.projectConfig, 'agents', agentName)) {
      writeConfig(layers.projectConfig, layers.paths.projectPath);
      console.log(`Removed project-level agent from opencode.json: ${agentName}`);
      return;
    }
    throw new Error(`Project agent ${agentName} not found`);
  }

  if (requestedScope === AGENT_SCOPE.USER) {
    const userJsonPath = layers.paths.customPath || layers.paths.userPath;
    const userJsonConfig = layers.paths.customPath ? layers.customConfig : layers.userConfig;
    if (userJsonPath && deleteSectionEntry(userJsonConfig, 'agents', agentName)) {
      writeConfig(userJsonConfig, userJsonPath);
      console.log(`Removed user-level agent from opencode.json: ${agentName}`);
      return;
    }
    throw new Error(`User agent ${agentName} not found`);
  }

  const jsonSource = getJsonEntrySource(layers, 'agents', agentName);
  if (jsonSource.exists && jsonSource.config && jsonSource.path
    && deleteSectionEntry(jsonSource.config, 'agents', agentName)) {
    writeConfig(jsonSource.config, jsonSource.path);
    console.log(`Removed agent from opencode.json: ${agentName}`);
    return;
  }

  throw new Error(`Agent ${agentName} is built-in or not deletable`);
}

// ============== END V2 TRACK ==============

/**
 * Detect where an agent's permission field is currently defined
 * Priority: project .md > user .md > project JSON > user JSON
 * Returns: { source: 'md'|'json'|null, scope: 'project'|'user'|null, path: string|null }
 */
function getAgentPermissionSource(agentName, workingDirectory, lookupCache = null) {
  // Check project-level .md first
  if (workingDirectory) {
    const projectMdPath = getProjectAgentPath(workingDirectory, agentName);
    if (fs.existsSync(projectMdPath)) {
      const { frontmatter } = parseMdFile(projectMdPath);
      if (frontmatter.permission !== undefined) {
        return { source: 'md', scope: AGENT_SCOPE.PROJECT, path: projectMdPath };
      }
    }
  }

  // Check user-level .md
  const userMdPath = getUserAgentPath(agentName, lookupCache);
  if (fs.existsSync(userMdPath)) {
    const { frontmatter } = parseMdFile(userMdPath);
    if (frontmatter.permission !== undefined) {
      return { source: 'md', scope: AGENT_SCOPE.USER, path: userMdPath };
    }
  }

  // Check JSON layers in effective override order. readConfigLayers merges
  // user -> project -> custom, so custom wins over project, project over user.
  const layers = readConfigLayers(workingDirectory);

  const customJsonPermission = layers.customConfig?.agent?.[agentName]?.permission;
  if (customJsonPermission !== undefined && layers.paths.customPath) {
    return { source: 'json', scope: 'custom', path: layers.paths.customPath };
  }

  const projectJsonPermission = layers.projectConfig?.agent?.[agentName]?.permission;
  if (projectJsonPermission !== undefined && layers.paths.projectPath) {
    return { source: 'json', scope: AGENT_SCOPE.PROJECT, path: layers.paths.projectPath };
  }

  const userJsonPermission = layers.userConfig?.agent?.[agentName]?.permission;
  if (userJsonPermission !== undefined) {
    return { source: 'json', scope: AGENT_SCOPE.USER, path: layers.paths.userPath };
  }

  return { source: null, scope: null, path: null };
}

function mergePermissionWithNonWildcards(newPermission, permissionSource, agentName) {
  if (!permissionSource.source || !permissionSource.path) {
    return newPermission;
  }

  let existingPermission = null;
  if (permissionSource.source === 'md') {
    const { frontmatter } = parseMdFile(permissionSource.path);
    existingPermission = frontmatter.permission;
  } else if (permissionSource.source === 'json') {
    const config = readConfigFile(permissionSource.path);
    existingPermission = config?.agent?.[agentName]?.permission;
  }

  if (!existingPermission || typeof existingPermission === 'string') {
    return newPermission;
  }

  if (newPermission == null) {
    return null;
  }

  if (typeof newPermission === 'string') {
    return newPermission;
  }

  const nonWildcardPatterns = {};
  for (const [permKey, permValue] of Object.entries(existingPermission)) {
    if (permKey === '*') continue;

    if (typeof permValue === 'object' && permValue !== null && !Array.isArray(permValue)) {
      const nonWildcards = {};
      for (const [pattern, action] of Object.entries(permValue)) {
        if (pattern !== '*') {
          nonWildcards[pattern] = action;
        }
      }
      if (Object.keys(nonWildcards).length > 0) {
        nonWildcardPatterns[permKey] = nonWildcards;
      }
    }
  }

  if (Object.keys(nonWildcardPatterns).length === 0) {
    return newPermission;
  }

  const merged = { ...newPermission };
  for (const [permKey, patterns] of Object.entries(nonWildcardPatterns)) {
    const newValue = merged[permKey];
    if (typeof newValue === 'string') {
      merged[permKey] = { '*': newValue, ...patterns };
    } else if (typeof newValue === 'object' && newValue !== null) {
      merged[permKey] = { ...patterns, ...newValue };
    } else {
      const existingValue = existingPermission[permKey];
      if (typeof existingValue === 'object' && existingValue !== null) {
        const wildcard = existingValue['*'];
        merged[permKey] = wildcard ? { '*': wildcard, ...patterns } : patterns;
      }
    }
  }

  return merged;
}

function getAgentSources(agentName, workingDirectory, lookupCache = createAgentLookupCache()) {
  if (v2TrackActive()) {
    return getAgentSourcesV2(agentName, workingDirectory, lookupCache);
  }

  const projectPath = workingDirectory ? getProjectAgentPath(workingDirectory, agentName) : null;
  const projectExists = projectPath && fs.existsSync(projectPath);

  const userPath = getUserAgentPath(agentName, lookupCache);
  const userExists = fs.existsSync(userPath);

  const mdPath = projectExists ? projectPath : (userExists ? userPath : null);
  const mdExists = !!mdPath;
  const mdScope = projectExists ? AGENT_SCOPE.PROJECT : (userExists ? AGENT_SCOPE.USER : null);

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'agent', agentName);
  const jsonSection = jsonSource.section;
  const jsonPath = jsonSource.path || layers.paths.customPath || layers.paths.projectPath || layers.paths.userPath;
  const jsonScope = jsonSource.path === layers.paths.projectPath ? AGENT_SCOPE.PROJECT : AGENT_SCOPE.USER;

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
      sources.md.fields.push('prompt');
    }
  }

  if (jsonSection) {
    sources.json.fields = Object.keys(jsonSection);
  }

  return sources;
}

function getAgentConfig(agentName, workingDirectory, lookupCache = createAgentLookupCache()) {
  if (v2TrackActive()) {
    return getAgentConfigV2(agentName, workingDirectory, lookupCache);
  }

  const projectPath = workingDirectory ? getProjectAgentPath(workingDirectory, agentName) : null;
  const projectExists = projectPath && fs.existsSync(projectPath);

  const userPath = getUserAgentPath(agentName, lookupCache);
  const userExists = fs.existsSync(userPath);

  if (projectExists || userExists) {
    const mdPath = projectExists ? projectPath : userPath;
    const { frontmatter, body } = parseMdFile(mdPath);

    return {
      source: 'md',
      scope: projectExists ? AGENT_SCOPE.PROJECT : AGENT_SCOPE.USER,
      config: {
        ...frontmatter,
        ...(typeof body === 'string' && body.length > 0 ? { prompt: body } : {}),
      },
    };
  }

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'agent', agentName);

  if (jsonSource.exists && jsonSource.section) {
    const scope = jsonSource.path === layers.paths.projectPath ? AGENT_SCOPE.PROJECT : AGENT_SCOPE.USER;
    return {
      source: 'json',
      scope,
      config: { ...jsonSource.section },
    };
  }

  return {
    source: 'none',
    scope: null,
    config: {},
  };
}

function createAgent(agentName, config, workingDirectory, scope) {
  ensureDirs();
  const lookupCache = createAgentLookupCache();

  if (v2TrackActive()) {
    const v2ProjectPath = workingDirectory ? v2ProjectAgentPath(workingDirectory, agentName) : null;
    const v2UserPath = v2UserAgentPath(agentName, lookupCache);

    if (v2ProjectPath && fs.existsSync(v2ProjectPath)) {
      throw new Error(`Agent ${agentName} already exists as project-level .md file`);
    }

    if (fs.existsSync(v2UserPath)) {
      throw new Error(`Agent ${agentName} already exists as user-level .md file`);
    }

    const v2Layers = readConfigLayers(workingDirectory);
    if (getJsonEntrySource(v2Layers, 'agents', agentName).exists) {
      throw new Error(`Agent ${agentName} already exists in opencode.json`);
    }

    let v2TargetPath;
    let v2TargetScope;

    if (scope === AGENT_SCOPE.PROJECT && workingDirectory) {
      fs.mkdirSync(path.join(workingDirectory, '.opencode', 'agents'), { recursive: true });
      v2TargetPath = v2ProjectPath;
      v2TargetScope = AGENT_SCOPE.PROJECT;
    } else {
      v2TargetPath = v2UserPath;
      v2TargetScope = AGENT_SCOPE.USER;
    }

    const { scope: _ignoredScope, ...entity } = isRecord(config) ? config : {};
    writeAgentMd(v2TargetPath, entity);
    console.log(`Created new agent: ${agentName} (scope: ${v2TargetScope}, path: ${v2TargetPath})`);
    return { scope: v2TargetScope, path: v2TargetPath };
  }

  const projectPath = workingDirectory ? getProjectAgentPath(workingDirectory, agentName) : null;
  const userPath = getUserAgentPath(agentName, lookupCache);

  if (projectPath && fs.existsSync(projectPath)) {
    throw new Error(`Agent ${agentName} already exists as project-level .md file`);
  }

  if (fs.existsSync(userPath)) {
    throw new Error(`Agent ${agentName} already exists as user-level .md file`);
  }

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'agent', agentName);
  if (jsonSource.exists) {
    throw new Error(`Agent ${agentName} already exists in opencode.json`);
  }

  let targetPath;
  let targetScope;

  if (scope === AGENT_SCOPE.PROJECT && workingDirectory) {
    ensureProjectAgentDir(workingDirectory);
    targetPath = projectPath;
    targetScope = AGENT_SCOPE.PROJECT;
  } else {
    targetPath = userPath;
    targetScope = AGENT_SCOPE.USER;
  }

  const { prompt, scope: _scopeFromConfig, ...frontmatter } = config;

  writeMdFile(targetPath, frontmatter, prompt || '');
  console.log(`Created new agent: ${agentName} (scope: ${targetScope}, path: ${targetPath})`);
}

function updateAgent(agentName, updates, workingDirectory) {
  ensureDirs();
  const lookupCache = createAgentLookupCache();

  if (v2TrackActive()) {
    return updateAgentV2(agentName, updates, workingDirectory);
  }

  const { scope, path: mdPath } = getAgentWritePath(agentName, workingDirectory, undefined, lookupCache);
  const mdExists = mdPath && fs.existsSync(mdPath);

  const layers = readConfigLayers(workingDirectory);
  const jsonSource = getJsonEntrySource(layers, 'agent', agentName);
  const jsonSection = jsonSource.section;
  const hasJsonFields = jsonSource.exists && jsonSection && Object.keys(jsonSection).length > 0;
  const jsonTarget = jsonSource.exists
    ? { config: jsonSource.config, path: jsonSource.path }
    : getJsonWriteTarget(layers, AGENT_SCOPE.USER);
  let config = jsonTarget.config || {};

  const isBuiltinOverride = !mdExists && !hasJsonFields;

  let targetPath = mdPath;
  let targetScope = scope;

  if (!mdExists && isBuiltinOverride) {
    targetPath = getUserAgentPath(agentName, lookupCache);
    targetScope = AGENT_SCOPE.USER;
  }

  let mdData = mdExists ? parseMdFile(mdPath) : (isBuiltinOverride ? { frontmatter: {}, body: '' } : null);

  let mdModified = false;
  let jsonModified = false;
  const creatingNewMd = isBuiltinOverride;

  for (const [field, value] of Object.entries(updates)) {
    if (value === undefined) continue;

    if (field === 'prompt') {
      if (value === null) {
        if (mdExists || creatingNewMd) {
          if (mdData) {
            mdData.body = '';
            mdModified = true;
          }
          continue;
        }

        if (isPromptFileReference(jsonSection?.prompt)) {
          const promptFilePath = resolvePromptFilePath(jsonSection.prompt);
          if (!promptFilePath) {
            throw new Error(`Invalid prompt file reference for agent ${agentName}`);
          }
          writePromptFile(promptFilePath, '');
          continue;
        }

        if (config.agent?.[agentName]) {
          delete config.agent[agentName].prompt;

          if (Object.keys(config.agent[agentName]).length === 0) {
            delete config.agent[agentName];
          }
          if (Object.keys(config.agent).length === 0) {
            delete config.agent;
          }

          jsonModified = true;
        }
        continue;
      }

      const normalizedValue = typeof value === 'string' ? value : (value == null ? '' : String(value));

      if (mdExists || creatingNewMd) {
        if (mdData) {
          mdData.body = normalizedValue;
          mdModified = true;
        }
        continue;
      } else if (isPromptFileReference(jsonSection?.prompt)) {
        const promptFilePath = resolvePromptFilePath(jsonSection.prompt);
        if (!promptFilePath) {
          throw new Error(`Invalid prompt file reference for agent ${agentName}`);
        }
        writePromptFile(promptFilePath, normalizedValue);
        continue;
      } else if (isPromptFileReference(normalizedValue)) {
        if (!config.agent) config.agent = {};
        if (!config.agent[agentName]) config.agent[agentName] = {};
        config.agent[agentName].prompt = normalizedValue;
        jsonModified = true;
        continue;
      }

      if (!config.agent) config.agent = {};
      if (!config.agent[agentName]) config.agent[agentName] = {};
      config.agent[agentName].prompt = normalizedValue;
      jsonModified = true;
      continue;
    }

    if (field === 'permission') {
      const permissionSource = getAgentPermissionSource(agentName, workingDirectory, lookupCache);
      const newPermission = mergePermissionWithNonWildcards(value, permissionSource, agentName);

      if (permissionSource.source === 'md') {
        if (mdData && permissionSource.path === targetPath) {
          mdData.frontmatter.permission = newPermission;
          mdModified = true;
        } else {
          const existingMdData = parseMdFile(permissionSource.path);
          existingMdData.frontmatter.permission = newPermission;
          writeMdFile(permissionSource.path, existingMdData.frontmatter, existingMdData.body);
          console.log(`Updated permission in .md file: ${permissionSource.path}`);
        }
      } else if (permissionSource.source === 'json') {
        if (permissionSource.path === (jsonTarget.path || CONFIG_FILE)) {
          if (!config.agent) config.agent = {};
          if (!config.agent[agentName]) config.agent[agentName] = {};
          config.agent[agentName].permission = newPermission;
          jsonModified = true;
        } else {
          const existingConfig = readConfigFile(permissionSource.path);
          if (!existingConfig.agent) existingConfig.agent = {};
          if (!existingConfig.agent[agentName]) existingConfig.agent[agentName] = {};
          existingConfig.agent[agentName].permission = newPermission;
          writeConfig(existingConfig, permissionSource.path);
          console.log(`Updated permission in JSON: ${permissionSource.path}`);
        }
      } else {
        if (mdExists && mdData) {
          mdData.frontmatter.permission = newPermission;
          mdModified = true;
        } else if (hasJsonFields) {
          if (!config.agent) config.agent = {};
          if (!config.agent[agentName]) config.agent[agentName] = {};
          config.agent[agentName].permission = newPermission;
          jsonModified = true;
        } else {
          const writeTarget = getJsonWriteTarget(layers, AGENT_SCOPE.USER);
          if (!writeTarget.config.agent) writeTarget.config.agent = {};
          if (!writeTarget.config.agent[agentName]) writeTarget.config.agent[agentName] = {};
          writeTarget.config.agent[agentName].permission = newPermission;
          writeConfig(writeTarget.config, writeTarget.path);
          console.log(`Created permission in JSON: ${writeTarget.path}`);
        }
      }
      continue;
    }

    const inMd = mdData?.frontmatter?.[field] !== undefined;
    const inJson = jsonSection?.[field] !== undefined;

    if (value === null) {
      if (mdData && inMd) {
        delete mdData.frontmatter[field];
        mdModified = true;
      }

      if (inJson && config.agent?.[agentName]) {
        delete config.agent[agentName][field];

        if (Object.keys(config.agent[agentName]).length === 0) {
          delete config.agent[agentName];
        }
        if (Object.keys(config.agent).length === 0) {
          delete config.agent;
        }

        jsonModified = true;
      }

      continue;
    }

    if (inJson) {
      if (!config.agent) config.agent = {};
      if (!config.agent[agentName]) config.agent[agentName] = {};
      config.agent[agentName][field] = value;
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
        if (!config.agent) config.agent = {};
        if (!config.agent[agentName]) config.agent[agentName] = {};
        config.agent[agentName][field] = value;
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

  console.log(`Updated agent: ${agentName} (scope: ${targetScope}, md: ${mdModified}, json: ${jsonModified})`);
}

function deleteJsonAgentEntry(config, agentName) {
  const agentMap = config.agent;
  if (!agentMap || typeof agentMap !== 'object' || Array.isArray(agentMap) || !agentMap[agentName]) return false;
  delete agentMap[agentName];
  if (Object.keys(agentMap).length === 0) {
    delete config.agent;
  }
  return true;
}

function deleteAgent(agentName, workingDirectory, scope) {
  const lookupCache = createAgentLookupCache();

  if (v2TrackActive()) {
    return deleteAgentV2(agentName, workingDirectory, scope);
  }

  const requestedScope = scope === AGENT_SCOPE.PROJECT || scope === AGENT_SCOPE.USER ? scope : null;

  if ((!requestedScope || requestedScope === AGENT_SCOPE.PROJECT) && workingDirectory) {
    const projectPath = getProjectAgentPath(workingDirectory, agentName);
    if (fs.existsSync(projectPath)) {
      fs.unlinkSync(projectPath);
      console.log(`Deleted project-level agent .md file: ${projectPath}`);
      return;
    }
  }

  if (!requestedScope || requestedScope === AGENT_SCOPE.USER) {
    const userPath = getUserAgentPath(agentName, lookupCache);
    if (fs.existsSync(userPath)) {
      fs.unlinkSync(userPath);
      console.log(`Deleted user-level agent .md file: ${userPath}`);
      return;
    }
  }

  const layers = readConfigLayers(workingDirectory);

  if (requestedScope === AGENT_SCOPE.PROJECT) {
    if (layers.paths.projectPath && deleteJsonAgentEntry(layers.projectConfig, agentName)) {
      writeConfig(layers.projectConfig, layers.paths.projectPath);
      console.log(`Removed project-level agent from opencode.json: ${agentName}`);
      return;
    }
    throw new Error(`Project agent ${agentName} not found`);
  }

  if (requestedScope === AGENT_SCOPE.USER) {
    const userJsonPath = layers.paths.customPath || layers.paths.userPath;
    const userJsonConfig = layers.paths.customPath ? layers.customConfig : layers.userConfig;
    if (userJsonPath && deleteJsonAgentEntry(userJsonConfig, agentName)) {
      writeConfig(userJsonConfig, userJsonPath);
      console.log(`Removed user-level agent from opencode.json: ${agentName}`);
      return;
    }
    throw new Error(`User agent ${agentName} not found`);
  }

  const jsonSource = getJsonEntrySource(layers, 'agent', agentName);
  if (jsonSource.exists && jsonSource.config && jsonSource.path && deleteJsonAgentEntry(jsonSource.config, agentName)) {
    writeConfig(jsonSource.config, jsonSource.path);
    console.log(`Removed agent from opencode.json: ${agentName}`);
    return;
  }

  throw new Error(`Agent ${agentName} is built-in or not deletable`);
}

export {
  ensureProjectAgentDir,
  getProjectAgentPath,
  getUserAgentPath,
  getAgentScope,
  getAgentWritePath,
  getAgentPermissionSource,
  getAgentSources,
  getAgentConfig,
  getAgentPermissions,
  createAgent,
  updateAgent,
  deleteAgent,
};

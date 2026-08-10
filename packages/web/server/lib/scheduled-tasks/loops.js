import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_TASK_NAME_LENGTH } from '../projects/project-config.js';
import { findWorktreeRoot, getAncestors, parseMdFile, writeMdFile } from '../opencode/shared.js';

const LOOP_DIRECTORY = 'loops';

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const splitProviderModel = (value) => {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const separator = raw.indexOf('/');
  if (separator <= 0 || separator === raw.length - 1) return null;
  const providerID = raw.slice(0, separator).trim();
  const modelID = raw.slice(separator + 1).trim();
  return providerID && modelID ? { providerID, modelID } : null;
};

export const parseLoopDefinition = (filePath) => {
  let parsed;
  try {
    parsed = parseMdFile(filePath);
  } catch (error) {
    console.warn(`[loops] skipped malformed loop file ${filePath}:`, error instanceof Error ? error.message : error);
    return null;
  }

  const frontmatter = parsed.frontmatter && typeof parsed.frontmatter === 'object'
    ? parsed.frontmatter
    : {};
  const name = asNonEmptyString(frontmatter.name);
  if (!name) {
    console.warn(`[loops] skipped ${filePath}: frontmatter "name" is required`);
    return null;
  }
  if (name.length > MAX_TASK_NAME_LENGTH) {
    console.warn(`[loops] skipped ${filePath}: frontmatter "name" exceeds ${MAX_TASK_NAME_LENGTH} characters`);
    return null;
  }

  const cron = asNonEmptyString(frontmatter.schedule);
  if (!cron) {
    console.warn(`[loops] skipped ${filePath}: frontmatter "schedule" is required`);
    return null;
  }
  const providerModel = splitProviderModel(frontmatter.model);
  if (!providerModel) {
    console.warn(`[loops] skipped ${filePath}: frontmatter "model" must be "provider/model"`);
    return null;
  }
  const prompt = asNonEmptyString(parsed.body);
  if (!prompt) {
    console.warn(`[loops] skipped ${filePath}: markdown body is required`);
    return null;
  }

  const timezone = asNonEmptyString(frontmatter.timezone);
  const agent = asNonEmptyString(frontmatter.agent);
  return {
    name,
    enabled: frontmatter.enabled === true,
    schedule: {
      kind: 'cron',
      cron,
      ...(timezone ? { timezone } : {}),
    },
    execution: {
      prompt,
      ...providerModel,
      ...(agent ? { agent } : {}),
    },
  };
};

export const setLoopFileEnabled = (filePath, enabled) => {
  if (!parseLoopDefinition(filePath)) return false;
  const { frontmatter, body } = parseMdFile(filePath);
  writeMdFile(filePath, { ...frontmatter, enabled: enabled === true }, body);
  return true;
};

const listMarkdownFiles = (directory) => {
  if (!directory || !fs.existsSync(directory)) return [];
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch {
    return [];
  }
};

export const discoverLoopFiles = (projectPath) => {
  const files = listMarkdownFiles(path.join(os.homedir(), '.agents', LOOP_DIRECTORY))
    .map((filePath) => ({ scope: 'user', filePath }));
  if (!projectPath) return files;

  const worktreeRoot = findWorktreeRoot(projectPath) || path.resolve(projectPath);
  for (const ancestor of getAncestors(projectPath, worktreeRoot)) {
    const directory = path.join(ancestor, '.agents', LOOP_DIRECTORY);
    for (const filePath of listMarkdownFiles(directory)) {
      files.push({ scope: 'project', filePath });
    }
  }
  return files;
};

export const discoverLoops = (projectPath) => {
  const validByName = new Map();
  const malformed = [];
  for (const { scope, filePath } of discoverLoopFiles(projectPath)) {
    const definition = parseLoopDefinition(filePath);
    if (!definition) {
      malformed.push({ scope, filePath, definition: null });
      continue;
    }

    const existing = validByName.get(definition.name);
    if (existing && (existing.scope === 'project' || scope === 'user')) continue;
    validByName.set(definition.name, { scope, filePath, definition });
  }
  return [...malformed, ...validByName.values()];
};

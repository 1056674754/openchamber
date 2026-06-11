/**
 * Config writer for writing to OpenCode configuration files.
 * Preserves existing JSONC formatting (comments, trailing commas) where possible.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { modify as modifyJsonc, applyEdits } from 'jsonc-parser';
import {
  readConfigLayers,
  getJsonWriteTarget,
  writeConfig,
  readConfigFile,
} from './shared.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getWriteTarget(workingDirectory, preferredScope) {
  const layers = readConfigLayers(workingDirectory);
  return getJsonWriteTarget(layers, preferredScope);
}

/**
 * Write a section to the config, preserving JSONC formatting.
 *
 * @param {string} workingDirectory
 * @param {string} sectionKey - e.g. 'permission', 'agent', 'mcp'
 * @param {object} value - the new value for the section
 * @param {'user'|'project'} preferredScope
 * @returns {{ filePath: string, backupPath: string|null }}
 */
export function writeConfigSection(workingDirectory, sectionKey, value, preferredScope = 'user') {
  const { config: targetConfig, path: targetPath } = getWriteTarget(workingDirectory, preferredScope);

  let filePath = targetPath;
  if (!filePath) {
    filePath = path.join(CONFIG_DIR, 'opencode.jsonc');
    ensureDir(CONFIG_DIR);
  }

  const exists = fs.existsSync(filePath);

  if (exists) {
    // Backup
    const backupFile = `${filePath}.openchamber.backup`;
    fs.copyFileSync(filePath, backupFile);

    // Read raw text
    const raw = fs.readFileSync(filePath, 'utf8');

    if (raw.trim()) {
      // JSONC-preserving write: modify the section key in-place
      const edits = modifyJsonc(raw, [sectionKey], value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      const updated = applyEdits(raw, edits);
      fs.writeFileSync(filePath, updated, 'utf8');
      return { filePath, backupPath: backupFile };
    }
  }

  // New file or empty file: write from scratch
  const current = exists ? readConfigFile(filePath) : {};
  current[sectionKey] = value;
  ensureDir(path.dirname(filePath));
  writeConfig(current, filePath);
  const backupPath = exists ? `${filePath}.openchamber.backup` : null;
  return { filePath, backupPath };
}

/**
 * Write a specific permission rule for a tool.
 *
 * @param {string} workingDirectory
 * @param {string} toolName - e.g. 'bash', 'edit', 'read'
 * @param {'ask'|'allow'|'deny'|object} rule
 * @param {'user'|'project'} preferredScope
 * @param {string|null} [agentName] - if set, write to agent-level permission instead
 */
export function writePermissionRule(workingDirectory, toolName, rule, preferredScope, agentName) {
  const layers = readConfigLayers(workingDirectory);
  const { config: targetConfig, path: targetPath } = getWriteTarget(layers, preferredScope);

  let filePath = targetPath;
  if (!filePath) {
    filePath = path.join(CONFIG_DIR, 'opencode.jsonc');
    ensureDir(CONFIG_DIR);
  }

  const exists = fs.existsSync(filePath);

  if (exists) {
    const backupFile = `${filePath}.openchamber.backup`;
    fs.copyFileSync(filePath, backupFile);

    const raw = fs.readFileSync(filePath, 'utf8');

    let keyPath;
    if (agentName) {
      // Agent-level permission: agent.<name>.permission.<tool>
      keyPath = ['agent', agentName, 'permission', toolName];
    } else {
      // Global permission
      keyPath = ['permission', toolName];
    }

    if (raw.trim()) {
      const edits = modifyJsonc(raw, keyPath, rule, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      const updated = applyEdits(raw, edits);
      fs.writeFileSync(filePath, updated, 'utf8');
      return { filePath, backupPath: backupFile };
    }
  }

  // New file
  const current = exists ? readConfigFile(filePath) : {};
  if (agentName) {
    current.agent = current.agent || {};
    current.agent[agentName] = current.agent[agentName] || {};
    current.agent[agentName].permission = current.agent[agentName].permission || {};
    current.agent[agentName].permission[toolName] = rule;
  } else {
    if (typeof current.permission !== 'object' || Array.isArray(current.permission)) {
      current.permission = {};
    }
    current.permission[toolName] = rule;
  }
  ensureDir(path.dirname(filePath));
  writeConfig(current, filePath);
  const backupPath = exists ? `${filePath}.openchamber.backup` : null;
  return { filePath, backupPath };
}

/**
 * Bulk write all permission rules at once (replaces entire permission section).
 */
export function writeBulkPermissions(workingDirectory, globalRules, agentRules, preferredScope) {
  const result = writeConfigSection(workingDirectory, 'permission', globalRules, preferredScope);

  // For each agent that has permission overrides
  for (const [agentName, rules] of Object.entries(agentRules)) {
    const layers = readConfigLayers(workingDirectory);
    const { config: targetConfig, path: targetPath } = getWriteTarget(layers, preferredScope);

    let filePath = targetPath;
    if (!filePath) {
      filePath = path.join(CONFIG_DIR, 'opencode.jsonc');
      ensureDir(CONFIG_DIR);
    }

    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw.trim()) {
        const edits = modifyJsonc(raw, ['agent', agentName, 'permission'], rules, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        const updated = applyEdits(raw, edits);
        fs.writeFileSync(filePath, updated, 'utf8');
      }
    }
  }

  return result;
}

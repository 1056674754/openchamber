import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The path constants are frozen when the modules load, so point
// XDG_CONFIG_HOME at a scratch directory BEFORE importing them. Nothing in
// this file may touch the real ~/.config/opencode.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-commands-v2-'));
process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
delete process.env.OPENCODE_CONFIG;

const originalProtocolMode = process.env.OPENCHAMBER_PROTOCOL_MODE;
delete process.env.OPENCHAMBER_PROTOCOL_MODE;

const { ensureDirs, parseMdFile, writeMdFile } = await import('./shared.js');
const { resetProtocolModes } = await import('./protocol-mode.js');
const {
  getCommandConfig,
  getCommandSources,
  createCommand,
  updateCommand,
  deleteCommand,
} = await import('./commands.js');

ensureDirs();

const setMode = (mode) => {
  resetProtocolModes();
  if (mode) {
    process.env.OPENCHAMBER_PROTOCOL_MODE = mode;
  } else {
    delete process.env.OPENCHAMBER_PROTOCOL_MODE;
  }
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const projectDir = () => {
  const dir = fs.mkdtempSync(path.join(root, 'proj-'));
  // findWorktreeRoot stops the v2 `.opencode` ancestor walk at the project root.
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.opencode'), { recursive: true });
  return dir;
};

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  resetProtocolModes();
  if (typeof originalProtocolMode === 'string') {
    process.env.OPENCHAMBER_PROTOCOL_MODE = originalProtocolMode;
  } else {
    delete process.env.OPENCHAMBER_PROTOCOL_MODE;
  }
});

describe('commands v1 track is unchanged (default mode)', () => {
  it('writes the v1 `command` JSON section and keeps the raw template field', () => {
    setMode(undefined);
    const dir = projectDir();
    const configPath = path.join(dir, 'opencode.json');
    writeJson(configPath, { command: { ship: { description: 'Old' } } });

    updateCommand('ship', { template: 'Ship it {{args}}' }, dir);

    const written = readJson(configPath);
    expect(written.command.ship).toEqual({ description: 'Old', template: 'Ship it {{args}}' });
    expect(written.commands).toBeUndefined();
  });
});

describe('commands v2 track (protocolMode v2)', () => {
  it('creates a command as a native v2 markdown entity and reports where it landed', () => {
    setMode('v2');
    const dir = projectDir();

    const created = createCommand('deploy', {
      description: 'Deploy the app',
      agent: 'build',
      model: 'anthropic/claude-sonnet-4#fast',
      subagent: true,
      template: 'Deploy {{args}}',
    }, dir, 'project');

    expect(created).toEqual({
      scope: 'project',
      path: path.join(dir, '.opencode', 'commands', 'deploy.md'),
    });
    const stored = parseMdFile(created.path);
    expect(stored.frontmatter).toEqual({
      description: 'Deploy the app',
      agent: 'build',
      model: 'anthropic/claude-sonnet-4#fast',
      subagent: true,
    });
    expect(stored.body).toContain('Deploy {{args}}');

    const configInfo = getCommandConfig('deploy', dir);
    expect(configInfo).toMatchObject({
      source: 'md',
      scope: 'project',
      path: created.path,
      legacy: false,
    });
    expect(configInfo.config).toEqual({
      template: 'Deploy {{args}}',
      description: 'Deploy the app',
      agent: 'build',
      model: 'anthropic/claude-sonnet-4#fast',
      subagent: true,
    });
  });

  it('rewrites a legacy command file in place and maps v1 field names on update', () => {
    setMode('v2');
    const dir = projectDir();
    const commandPath = path.join(dir, '.opencode', 'command', 'review.md');
    fs.mkdirSync(path.dirname(commandPath), { recursive: true });
    writeMdFile(commandPath, {
      description: 'Old',
      model: 'openai/gpt-5#high',
      subtask: true,
    }, 'Review {{args}}');

    const updated = updateCommand('review', { description: 'New' }, dir);
    expect(updated).toEqual({ source: 'md', scope: 'project', path: commandPath });

    // The v1 directory location is rewritten in place, in v2 shape.
    const stored = parseMdFile(commandPath);
    expect(stored.frontmatter).toEqual({
      description: 'New',
      model: 'openai/gpt-5#high',
      subagent: true,
    });

    updateCommand('review', { subtask: false, variant: null }, dir);
    const cleared = parseMdFile(commandPath);
    expect(cleared.frontmatter).toEqual({ description: 'New', model: 'openai/gpt-5', subagent: false });
  });

  it('moves a legacy `command` JSON entry to `commands` when updating through JSON', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, { command: { jsoncmd: { description: 'Old', template: 'T' } } });

    const updated = updateCommand('jsoncmd', { description: 'New' }, dir);
    expect(updated).toEqual({ source: 'json', scope: 'project', path: configPath });

    const written = readJson(configPath);
    expect(written.command).toBeUndefined();
    expect(written.commands.jsoncmd).toEqual({ description: 'New', template: 'T' });
  });

  it('deletes both JSON spellings and reports not-found explicitly', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, {
      commands: { fresh: { description: 'v2' } },
      command: { stale: { description: 'v1' } },
    });

    deleteCommand('fresh', dir);
    let written = readJson(configPath);
    expect(written.commands).toBeUndefined();
    expect(written.command).toEqual({ stale: { description: 'v1' } });

    deleteCommand('stale', dir);
    written = readJson(configPath);
    expect(written).toEqual({});

    expect(() => deleteCommand('missing', dir)).toThrow('not found');
  });

  it('answers the canonical config for a JSON entry and reports legacy flags', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, {
      command: { oldstyle: { description: 'v1 key', template: 'T', subtask: true } },
      commands: { newstyle: { description: 'v2 key', model: 'openai/gpt-5' } },
    });

    const oldConfig = getCommandConfig('oldstyle', dir);
    expect(oldConfig).toMatchObject({
      source: 'json',
      scope: 'project',
      path: configPath,
      legacy: true,
    });
    expect(oldConfig.config).toEqual({
      template: 'T',
      description: 'v1 key',
      subagent: true,
    });

    const newSources = getCommandSources('newstyle', dir);
    expect(newSources.json).toMatchObject({ exists: true, legacy: false, sectionKey: 'commands' });

    const oldSources = getCommandSources('oldstyle', dir);
    expect(oldSources.json).toMatchObject({ exists: true, legacy: true, sectionKey: 'command' });
  });
});

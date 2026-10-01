import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The path constants are frozen when the modules load, so point
// XDG_CONFIG_HOME at a scratch directory BEFORE importing them. Nothing in
// this file may touch the real ~/.config/opencode.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-entity-v2-'));
process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
delete process.env.OPENCODE_CONFIG;

const originalProtocolMode = process.env.OPENCHAMBER_PROTOCOL_MODE;
delete process.env.OPENCHAMBER_PROTOCOL_MODE;

const {
  getJsonEntrySource,
  lookupSectionEntry,
  getProjectConfigCandidates,
  getConfigPaths,
  readConfigLayers,
} = await import('./shared.js');
const { resetProtocolModes } = await import('./protocol-mode.js');

const readLayers = (workingDirectory) => readConfigLayers(workingDirectory);

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const setMode = (mode) => {
  resetProtocolModes();
  if (mode) {
    process.env.OPENCHAMBER_PROTOCOL_MODE = mode;
  } else {
    delete process.env.OPENCHAMBER_PROTOCOL_MODE;
  }
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

describe('v1 config layout is the untouched default', () => {
  it('answers v1 section keys only and keeps the v1 file layout', () => {
    setMode(undefined);

    const config = { agent: { reviewer: { model: 'x' } }, mcp: { local: { type: 'local' } } };
    expect(lookupSectionEntry(config, 'agents', 'reviewer')).toEqual({
      value: { model: 'x' },
      key: 'agent',
      legacy: true,
    });

    const layers = readLayers('/tmp/nowhere');
    const source = getJsonEntrySource(
      { ...layers, customConfig: config, paths: { ...layers.paths, customPath: '/tmp/custom.json' } },
      'mcp',
      'local',
    );
    expect(source.exists).toBe(true);
    expect(source).not.toHaveProperty('sectionKey');

    const workingDirectory = path.join(root, 'v1-project');
    expect(getProjectConfigCandidates(workingDirectory)[0]).toBe(path.join(workingDirectory, 'opencode.json'));
    expect(getConfigPaths(workingDirectory).userPaths).toEqual([
      path.join(path.join(root, 'xdg'), 'opencode', 'config.json'),
      path.join(path.join(root, 'xdg'), 'opencode', 'opencode.json'),
      path.join(path.join(root, 'xdg'), 'opencode', 'opencode.jsonc'),
    ]);
  });
});

describe('v2 config layout activates only on the v2 track', () => {
  it('reads both section spellings and reports where an entry lives', () => {
    setMode('v2');

    const config = {
      mcp: {
        legacy: { type: 'local', command: ['a'] },
        servers: { fresh: { type: 'remote', url: 'https://example.test' } },
      },
      agents: { native: { description: 'v2 key' } },
      agent: { old: { description: 'v1 key' } },
    };
    expect(lookupSectionEntry(config, 'mcp', 'fresh')).toEqual({
      value: { type: 'remote', url: 'https://example.test' },
      key: 'mcp.servers',
      legacy: false,
    });
    expect(lookupSectionEntry(config, 'mcp', 'legacy')).toEqual({
      value: { type: 'local', command: ['a'] },
      key: 'mcp',
      legacy: true,
    });
    expect(lookupSectionEntry(config, 'agents', 'native').key).toBe('agents');
    expect(lookupSectionEntry(config, 'agents', 'old')).toEqual({
      value: { description: 'v1 key' },
      key: 'agent',
      legacy: true,
    });

    const layers = readLayers('/tmp/nowhere');
    const source = getJsonEntrySource(
      { ...layers, userConfig: config, paths: { ...layers.paths, userPath: '/tmp/user/opencode.json' } },
      'mcp',
      'fresh',
    );
    expect(source.exists).toBe(true);
    expect(source.sectionKey).toBe('mcp.servers');
    expect(source.legacy).toBe(false);
  });

  it('lets `.opencode/` project configs win and drops the v1-era config.json', () => {
    setMode('v2');

    const workingDirectory = path.join(root, 'v2-project');
    expect(getProjectConfigCandidates(workingDirectory)[0]).toBe(
      path.join(workingDirectory, '.opencode', 'opencode.json'),
    );
    expect(getConfigPaths(workingDirectory).userPaths).toEqual([
      path.join(path.join(root, 'xdg'), 'opencode', 'opencode.json'),
      path.join(path.join(root, 'xdg'), 'opencode', 'opencode.jsonc'),
    ]);
  });

  it('honours OPENCODE_CONFIG_DIR on the v2 track only', () => {
    const configuredDir = path.join(root, 'configured-dir');
    process.env.OPENCODE_CONFIG_DIR = configuredDir;
    try {
      setMode('v2');
      expect(getConfigPaths('/tmp/nowhere').userPaths[0]).toBe(path.join(configuredDir, 'opencode.json'));

      setMode(undefined);
      expect(getConfigPaths('/tmp/nowhere').userPaths[0]).toBe(
        path.join(path.join(root, 'xdg'), 'opencode', 'config.json'),
      );
    } finally {
      delete process.env.OPENCODE_CONFIG_DIR;
      setMode(undefined);
    }
  });

  it('records the mode from an /api/info probe and reads the v2 layout with it', async () => {
    setMode(undefined);
    const workingDirectory = path.join(root, 'probe-project');
    writeJson(path.join(workingDirectory, '.opencode', 'opencode.json'), {
      mcp: { servers: { probed: { type: 'local', command: ['b'] } } },
    });

    // Default resolution is v1: the `.opencode/` file still exists but the
    // v1-first candidate order and v1 section key mean the entry is found by
    // its legacy shape only.
    const before = getJsonEntrySource(readLayers(workingDirectory), 'mcp', 'probed');
    expect(before.exists).toBe(false);

    const { recordProtocolMode } = await import('./protocol-mode.js');
    recordProtocolMode('default', { mode: 'v2', version: '2.0.14', source: 'probe' });
    const after = getJsonEntrySource(readLayers(workingDirectory), 'mcp', 'probed');
    expect(after.exists).toBe(true);
    expect(after.sectionKey).toBe('mcp.servers');
    expect(after.legacy).toBe(false);
    expect(after.path).toBe(path.join(workingDirectory, '.opencode', 'opencode.json'));
  });
});

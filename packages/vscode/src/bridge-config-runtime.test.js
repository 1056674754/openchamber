import { afterEach, describe, expect, mock, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

mock.module('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: () => undefined }),
  },
}));

const { handleConfigBridgeMessage } = await import('./bridge-config-runtime.ts');

const tempRoots = [];
const originalOpencodeConfig = process.env.OPENCODE_CONFIG;

const deps = {
  readSettings: () => ({}),
  persistSettings: async (changes) => changes,
  readMagicPromptOverrides: () => ({ version: 1, overrides: {} }),
  saveMagicPromptOverride: async () => ({ version: 1, overrides: {} }),
  resetMagicPromptOverride: async () => ({ version: 1, overrides: {} }),
  resetAllMagicPromptOverrides: async () => ({ version: 1, overrides: {} }),
  fetchOpenCodeSkillsFromApi: async () => null,
  clientReloadDelayMs: 800,
};

afterEach(() => {
  if (originalOpencodeConfig === undefined) {
    delete process.env.OPENCODE_CONFIG;
  } else {
    process.env.OPENCODE_CONFIG = originalOpencodeConfig;
  }

  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('VS Code config bridge agent updates', () => {
  test('removes agent fields when update payload sends null', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-agent-null-'));
    tempRoots.push(root);
    const restart = mock(async () => undefined);
    const ctx = {
      restart,
      manager: {
        getWorkingDirectory: () => root,
        restart,
      },
    };
    const configDir = path.join(root, '.opencode');
    const configPath = path.join(configDir, 'opencode.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      agent: {
        build: {
          variant: 'fast',
          temperature: 0.3,
          top_p: 0.8,
          mode: 'subagent',
        },
      },
    }, null, 2), 'utf8');

    const updated = await handleConfigBridgeMessage({
      id: 'update-agent-null-fields',
      type: 'api:config/agents',
      payload: {
        method: 'PATCH',
        name: 'build',
        directory: root,
        body: { variant: null, temperature: null, top_p: null },
      },
    }, ctx, deps);

    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(updated?.success).toBe(true);
    expect(stored.agent.build).toEqual({ mode: 'subagent' });
  });

  test('preserves existing markdown frontmatter when an update field is undefined', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-agent-frontmatter-'));
    tempRoots.push(root);
    const restart = mock(async () => undefined);
    const ctx = {
      restart,
      manager: {
        getWorkingDirectory: () => root,
        restart,
      },
    };
    const agentDir = path.join(root, '.opencode', 'agents');
    const agentPath = path.join(agentDir, 'build.md');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(agentPath, [
      '---',
      'description: Existing description',
      'mode: subagent',
      'custom_field: keep-me',
      '---',
      'Existing prompt',
    ].join('\n'), 'utf8');

    const updated = await handleConfigBridgeMessage({
      id: 'update-agent-undefined-field',
      type: 'api:config/agents',
      payload: {
        method: 'PATCH',
        name: 'build',
        directory: root,
        body: { description: undefined, mode: 'primary' },
      },
    }, ctx, deps);

    const stored = fs.readFileSync(agentPath, 'utf8');
    expect(updated?.success).toBe(true);
    expect(stored).toContain('description: Existing description');
    expect(stored).toContain('mode: primary');
    expect(stored).toContain('custom_field: keep-me');
    expect(stored).toContain('Existing prompt');
  });
});

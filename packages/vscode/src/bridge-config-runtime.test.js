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
const { mergeDiscoveredSkills } = await import('./opencodeConfig.ts');

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

const skill = (name, skillPath, source) => ({
  name,
  path: skillPath,
  scope: 'user',
  source,
});

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

describe('mergeDiscoveredSkills', () => {
  test('marks OpenCode and filesystem skills by sync state when discovery succeeds', () => {
    const primary = [
      skill('skill-a', '/opencode/skill-a/SKILL.md', 'opencode'),
      skill('skill-b', '/opencode/skill-b/SKILL.md', 'opencode'),
    ];
    const fallback = [
      skill('skill-a', '/filesystem/skill-a/SKILL.md', 'agents'),
      skill('skill-b', '/filesystem/skill-b/SKILL.md', 'agents'),
      skill('skill-c', '/filesystem/skill-c/SKILL.md', 'agents'),
    ];

    const merged = mergeDiscoveredSkills(primary, fallback);

    expect(merged).toEqual([
      { ...primary[0], opencodeSynced: true },
      { ...primary[1], opencodeSynced: true },
      { ...fallback[2], opencodeSynced: false },
    ]);
  });

  test('marks filesystem-only skills unsynced when OpenCode reports zero skills', () => {
    const fallback = [skill('skill-x', '/filesystem/skill-x/SKILL.md', 'agents')];

    const merged = mergeDiscoveredSkills([], fallback);

    expect(merged).toEqual([{ ...fallback[0], opencodeSynced: false }]);
  });

  test('leaves filesystem skill sync state unknown when OpenCode discovery fails', () => {
    const fallback = [skill('skill-y', '/filesystem/skill-y/SKILL.md', 'agents')];

    const merged = mergeDiscoveredSkills(null, fallback);

    expect(merged).toEqual(fallback);
    expect(merged[0]).not.toHaveProperty('opencodeSynced');
  });

  test('keeps the OpenCode skill when a filesystem skill has the same name', () => {
    const primary = [skill('skill-a', '/opencode/skill-a/SKILL.md', 'opencode')];
    const fallback = [skill('skill-a', '/filesystem/skill-a/SKILL.md', 'agents')];

    const merged = mergeDiscoveredSkills(primary, fallback);

    expect(merged).toEqual([{ ...primary[0], opencodeSynced: true }]);
  });

  test('marks OpenCode-only skills synced when filesystem discovery is empty', () => {
    const primary = [skill('skill-a', '/opencode/skill-a/SKILL.md', 'opencode')];

    const merged = mergeDiscoveredSkills(primary, []);

    expect(merged).toEqual([{ ...primary[0], opencodeSynced: true }]);
  });
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

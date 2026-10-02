import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The path constants are frozen when the modules load, so point
// XDG_CONFIG_HOME at a scratch directory BEFORE importing them. Nothing in
// this file may touch the real ~/.config/opencode.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-agents-v2-'));
process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
delete process.env.OPENCODE_CONFIG;

const originalProtocolMode = process.env.OPENCHAMBER_PROTOCOL_MODE;
delete process.env.OPENCHAMBER_PROTOCOL_MODE;

const {
  ensureDirs,
  parseMdFile,
  writeMdFile,
} = await import('./shared.js');
const { resetProtocolModes } = await import('./protocol-mode.js');
const {
  getAgentConfig,
  getAgentPermissions,
  getAgentSources,
  createAgent,
  updateAgent,
  deleteAgent,
} = await import('./agents.js');

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
  fs.mkdirSync(path.join(dir, '.opencode', 'agents'), { recursive: true });
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

describe('agents v1 track is unchanged (default mode)', () => {
  it('edits the v1 `agent` JSON section in place and keeps the raw prompt field', () => {
    setMode(undefined);
    const dir = projectDir();
    const configPath = path.join(dir, 'opencode.json');
    writeJson(configPath, { agent: { reviewer: { description: 'Old' } } });

    updateAgent('reviewer', { prompt: 'V1 body' }, dir);

    const written = readJson(configPath);
    expect(written.agent.reviewer).toEqual({ description: 'Old', prompt: 'V1 body' });
    expect(written.agents).toBeUndefined();

    const configInfo = getAgentConfig('reviewer', dir);
    expect(configInfo.source).toBe('json');
    expect(configInfo.scope).toBe('project');
    expect(configInfo).not.toHaveProperty('path');
    expect(configInfo).not.toHaveProperty('legacy');
    expect(configInfo.config).toEqual({ description: 'Old', prompt: 'V1 body' });
  });

  it('resolves agent markdown paths without the ancestor walk', () => {
    setMode(undefined);
    const dir = projectDir();
    fs.mkdirSync(path.join(dir, 'packages', 'app'), { recursive: true });
    // A parent-directory agent exists; the v1 track must NOT discover it.
    writeMdFile(
      path.join(dir, '.opencode', 'agents', 'parent-only.md'),
      { description: 'parent' },
      'parent body',
    );

    const sources = getAgentSources('parent-only', path.join(dir, 'packages', 'app'));
    expect(sources.md.exists).toBe(false);
    expect(sources.json.exists).toBe(false);
  });
});

describe('agents v2 track (protocolMode v2)', () => {
  it('creates an agent as a native v2 markdown entity and reports where it landed', () => {
    setMode('v2');
    const dir = projectDir();

    const created = createAgent('builder', {
      description: 'Builds things',
      mode: 'subagent',
      color: '#12abef',
      prompt: 'Build it well',
    }, dir, 'project');

    expect(created).toEqual({
      scope: 'project',
      path: path.join(dir, '.opencode', 'agents', 'builder.md'),
    });
    const stored = parseMdFile(created.path);
    expect(stored.frontmatter).toEqual({
      description: 'Builds things',
      mode: 'subagent',
      color: '#12abef',
    });
    expect(stored.body).toContain('Build it well');

    const configInfo = getAgentConfig('builder', dir);
    expect(configInfo).toMatchObject({
      source: 'md',
      scope: 'project',
      path: created.path,
      legacy: false,
    });
    expect(configInfo.config).toEqual({
      description: 'Builds things',
      mode: 'subagent',
      color: '#12abef',
      system: 'Build it well',
    });
  });

  it('rewrites a legacy frontmatter in place as v2 fields on update', () => {
    setMode('v2');
    const dir = projectDir();
    const agentPath = path.join(dir, '.opencode', 'agents', 'legacy.md');
    writeMdFile(agentPath, {
      description: 'Old',
      model: 'anthropic/claude-sonnet-4#fast',
      permission: { edit: 'allow', bash: { 'git push*': 'ask' } },
      maxSteps: 12,
      custom_field: 'keep',
    }, 'Legacy body');

    const updated = updateAgent('legacy', { description: 'New' }, dir);
    expect(updated).toEqual({ source: 'md', scope: 'project', path: agentPath });

    const stored = parseMdFile(agentPath);
    expect(stored.frontmatter).toEqual({
      description: 'New',
      model: 'anthropic/claude-sonnet-4#fast',
      permissions: [
        { action: 'edit', resource: '*', effect: 'allow' },
        { action: 'shell', resource: 'git push*', effect: 'ask' },
      ],
      steps: 12,
    });
    expect(stored.body).toContain('Legacy body');
  });

  it('accepts the v1 `prompt` spelling and clears v1-named fields at their v2 location', () => {
    setMode('v2');
    const dir = projectDir();
    const agentPath = path.join(dir, '.opencode', 'agents', 'aliased.md');
    writeMdFile(agentPath, {
      description: 'Aliased',
      model: 'openai/gpt-5#high',
      request: { body: { temperature: 0.2, top_p: 0.9 } },
    }, 'Body');

    updateAgent('aliased', { prompt: 'New body via alias' }, dir);
    let stored = parseMdFile(agentPath);
    expect(stored.frontmatter.model).toBe('openai/gpt-5#high');
    expect(stored.body).toContain('New body via alias');

    updateAgent('aliased', { variant: null, temperature: null, top_p: null }, dir);
    stored = parseMdFile(agentPath);
    expect(stored.frontmatter.model).toBe('openai/gpt-5');
    expect(stored.frontmatter.request).toBeUndefined();
  });

  it('moves a legacy `agent` JSON entry to `agents` when updating through JSON', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, {
      agent: { jsonman: { description: 'Old', permission: { edit: 'deny' } } },
    });

    const updated = updateAgent('jsonman', { description: 'New' }, dir);
    expect(updated).toEqual({ source: 'json', scope: 'project', path: configPath });

    const written = readJson(configPath);
    expect(written.agent).toBeUndefined();
    expect(written.agents.jsonman).toEqual({
      description: 'New',
      permissions: [{ action: 'edit', resource: '*', effect: 'deny' }],
    });
  });

  it('deletes both JSON spellings and reports not-found explicitly', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, {
      agents: { fresh: { description: 'v2' } },
      agent: { stale: { description: 'v1' } },
    });

    deleteAgent('fresh', dir, 'project');
    let written = readJson(configPath);
    expect(written.agents).toBeUndefined();

    deleteAgent('stale', dir, 'project');
    written = readJson(configPath);
    expect(written).toEqual({});

    expect(() => deleteAgent('missing', dir, 'project')).toThrow('not found');
  });

  it('answers ordered permission rules with global-first evaluation order', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, {
      permission: { bash: { 'git push*': 'ask' } },
      agents: { guarded: { description: 'G', permissions: [{ action: 'edit', resource: '*', effect: 'allow' }] } },
    });

    const permissions = getAgentPermissions('guarded', dir);
    expect(permissions.global).toEqual([
      { action: 'shell', resource: 'git push*', effect: 'ask' },
    ]);
    expect(permissions.agent).toEqual([
      { action: 'edit', resource: '*', effect: 'allow' },
    ]);
    expect(permissions.effective).toEqual([
      { action: 'shell', resource: 'git push*', effect: 'ask', source: 'global' },
      { action: 'edit', resource: '*', effect: 'allow', source: 'agent' },
    ]);
    expect(permissions).toMatchObject({ source: 'json', path: configPath });
  });

  it('discovers agents in every v2 directory, including parent `.opencode` dirs', () => {
    setMode('v2');
    const dir = projectDir();
    const nested = path.join(dir, 'packages', 'app');
    fs.mkdirSync(path.join(dir, '.opencode', 'modes'), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });

    writeMdFile(path.join(dir, '.opencode', 'modes', 'planner.md'), { description: 'mode dir' }, '');
    writeMdFile(path.join(dir, '.opencode', 'agents', 'tree.md'), { description: 'parent' }, '');

    const planner = getAgentSources('planner', nested);
    expect(planner.md.exists).toBe(true);
    expect(planner.md.path).toBe(path.join(dir, '.opencode', 'modes', 'planner.md'));

    const tree = getAgentConfig('tree', nested);
    expect(tree).toMatchObject({ source: 'md', scope: 'project', legacy: false });
  });

  it('reports legacy and sectionKey flags on sources', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, {
      agent: { oldstyle: { description: 'v1 key', prompt: 'text' } },
      agents: { newstyle: { description: 'v2 key' } },
    });

    const oldSources = getAgentSources('oldstyle', dir);
    expect(oldSources.json).toMatchObject({ exists: true, legacy: true, sectionKey: 'agent' });
    expect(oldSources.json.fields).toEqual(['system', 'description']);

    const newSources = getAgentSources('newstyle', dir);
    expect(newSources.json).toMatchObject({ exists: true, legacy: false, sectionKey: 'agents' });
  });
});

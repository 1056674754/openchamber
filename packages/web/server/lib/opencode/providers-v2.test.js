import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The path constants are frozen when the modules load, so point
// XDG_CONFIG_HOME at a scratch directory BEFORE importing them. Nothing in
// this file may touch the real ~/.config/opencode.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-providers-v2-'));
process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
delete process.env.OPENCODE_CONFIG;

const originalProtocolMode = process.env.OPENCHAMBER_PROTOCOL_MODE;
delete process.env.OPENCHAMBER_PROTOCOL_MODE;

const { resetProtocolModes } = await import('./protocol-mode.js');
const {
  getProviderSources,
  removeProviderConfig,
  upsertProviderConfig,
  validateCustomProviderConfig,
} = await import('./providers.js');

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

describe('providers v1 track is unchanged (default mode)', () => {
  it('writes the v1 `provider` section with npm/options shapes', () => {
    setMode(undefined);
    const dir = projectDir();

    const result = upsertProviderConfig('v1-provider', {
      name: 'V1 Provider',
      options: { baseURL: 'https://v1.example.com/v1' },
      models: { m: { name: 'M' } },
      env: ['V1_KEY'],
    }, dir, 'project');

    expect(result.path).toBe(path.join(dir, 'opencode.json'));
    const written = readJson(result.path);
    expect(written.provider['v1-provider']).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: 'V1 Provider',
      options: { baseURL: 'https://v1.example.com/v1' },
      models: { m: { name: 'M' } },
      env: ['V1_KEY'],
    });
    expect(written.providers).toBeUndefined();
  });
});

describe('providers v2 track (protocolMode v2)', () => {
  it('accepts the v2 spelling and the v1 spelling, always normalizing to v2', () => {
    setMode('v2');

    const v2Spelling = validateCustomProviderConfig('ok', {
      package: 'aisdk:@ai-sdk/openai-compatible',
      name: 'X',
      settings: { baseURL: 'https://api.example.com/v1' },
      models: { m: { name: 'M' } },
      env: ['KEY'],
    });
    expect(v2Spelling.ok).toBe(true);
    expect(v2Spelling.value.config).toMatchObject({
      package: 'aisdk:@ai-sdk/openai-compatible',
      settings: { baseURL: 'https://api.example.com/v1' },
      models: { m: { modelID: 'm', name: 'M' } },
    });

    const v1Spelling = validateCustomProviderConfig('ok', {
      npm: '@ai-sdk/openai-compatible',
      name: 'X',
      options: { baseURL: 'https://api.example.com/v1' },
      models: { m: { name: 'M' } },
      env: ['KEY'],
    });
    expect(v1Spelling.ok).toBe(true);
    expect(v1Spelling.value.config.package).toBe('aisdk:@ai-sdk/openai-compatible');
    expect(v1Spelling.value.config.settings.baseURL).toBe('https://api.example.com/v1');
    expect(v1Spelling.value.config.npm).toBeUndefined();
    expect(v1Spelling.value.config.options).toBeUndefined();

    // v2 widens the custom-provider npm allowlist.
    expect(validateCustomProviderConfig('ok', {
      package: 'aisdk:@ai-sdk/anthropic',
      name: 'X',
      settings: { baseURL: 'https://api.example.com' },
      models: { m: { name: 'M' } },
      env: ['KEY'],
    }).ok).toBe(true);
    expect(validateCustomProviderConfig('ok', {
      package: 'aisdk:@ai-sdk/deepseek',
      name: 'X',
      settings: { baseURL: 'https://api.example.com' },
      models: { m: { name: 'M' } },
      env: ['KEY'],
    }).error).toContain('@ai-sdk/openai-compatible');
  });

  it('writes the v2 `providers` section with package/settings/modelID shapes', () => {
    setMode('v2');
    const dir = projectDir();

    const result = upsertProviderConfig('campus-llm', {
      name: 'Campus LLM',
      options: { baseURL: 'https://llm.example.edu/v1', headers: { 'X-Campus': '1' } },
      models: { 'fast-model': { name: 'Fast' } },
      env: ['CAMPUS_KEY'],
    }, dir, 'project');

    // The v2 track writes the `.opencode/` project config first.
    expect(result.path).toBe(path.join(dir, '.opencode', 'opencode.json'));
    const written = readJson(result.path);
    expect(written.provider).toBeUndefined();
    expect(written.providers['campus-llm']).toEqual({
      package: 'aisdk:@ai-sdk/openai-compatible',
      name: 'Campus LLM',
      settings: { baseURL: 'https://llm.example.edu/v1' },
      headers: { 'X-Campus': '1' },
      models: { 'fast-model': { modelID: 'fast-model', name: 'Fast' } },
      env: ['CAMPUS_KEY'],
    });

    const sources = getProviderSources('campus-llm', dir);
    expect(sources.sources.project.exists).toBe(true);
    expect(sources.sources.project.path).toBe(result.path);
  });

  it('carries a legacy `provider.<id>` entry forward as v2 on edit and drops the legacy key', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, {
      provider: {
        'legacy-one': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Old',
          options: { baseURL: 'https://old.example.edu/v1' },
          models: { a: { name: 'A' } },
        },
      },
      disabled_providers: ['legacy-one', 'other'],
    });

    const result = upsertProviderConfig('legacy-one', {
      name: 'New',
      settings: { baseURL: 'https://new.example.edu/v1' },
      models: { a: { name: 'A2' }, b: { name: 'B' } },
    }, dir, 'project', { hasStoredAuth: true });

    const written = readJson(result.path);
    expect(written.provider).toBeUndefined();
    expect(written.providers['legacy-one']).toMatchObject({
      package: 'aisdk:@ai-sdk/openai-compatible',
      name: 'New',
      settings: { baseURL: 'https://new.example.edu/v1' },
      models: {
        a: { modelID: 'a', name: 'A2' },
        b: { modelID: 'b', name: 'B' },
      },
    });
    expect(written.disabled_providers).toEqual(['other']);
  });

  it('removes entries from both spellings and reports absence', () => {
    setMode('v2');
    const dir = projectDir();
    const configPath = path.join(dir, '.opencode', 'opencode.json');
    writeJson(configPath, {
      providers: { fresh: { name: 'v2' } },
      provider: { stale: { name: 'v1' } },
    });

    expect(removeProviderConfig('fresh', dir, 'project')).toBe(true);
    let written = readJson(configPath);
    expect(written.providers).toBeUndefined();
    expect(written.provider).toEqual({ stale: { name: 'v1' } });

    expect(removeProviderConfig('stale', dir, 'project')).toBe(true);
    written = readJson(configPath);
    expect(written).toEqual({});

    expect(removeProviderConfig('missing', dir, 'project')).toBe(false);
  });
});

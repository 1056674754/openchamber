import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  upsertProviderConfig,
  validateCustomProviderConfig,
  getProviderSources,
  removeProviderConfig,
} from './opencodeConfig';

let projectDir: string;

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('custom provider config persistence (vscode)', () => {
  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-vscode-provider-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('validateCustomProviderConfig rejects invalid endpoint and credentials', () => {
    assert.strictEqual(validateCustomProviderConfig('Bad Id', {
      name: 'X',
      options: { baseURL: 'https://api.example.com' },
      models: { m: { name: 'M' } },
    }).ok, false);

    assert.strictEqual(validateCustomProviderConfig('ok', {
      name: 'X',
      options: { baseURL: 'ftp://api.example.com' },
      models: { m: { name: 'M' } },
    }).ok, false);

    assert.strictEqual(validateCustomProviderConfig('ok', {
      name: 'X',
      options: { baseURL: 'https://api.example.com' },
      models: {},
    }).ok, false);
  });

  test('validateCustomProviderConfig rejects missing credentials unless hasStoredAuth or env', () => {
    assert.strictEqual(validateCustomProviderConfig('ok', {
      name: 'X',
      options: { baseURL: 'https://api.example.com' },
      models: { m: { name: 'M' } },
    }).ok, false);

    assert.strictEqual(validateCustomProviderConfig('ok', {
      name: 'X',
      options: { baseURL: 'https://api.example.com' },
      models: { m: { name: 'M' } },
    }, { hasStoredAuth: true }).ok, true);

    assert.strictEqual(validateCustomProviderConfig('ok', {
      name: 'X',
      env: ['MY_KEY'],
      options: { baseURL: 'https://api.example.com' },
      models: { m: { name: 'M' } },
    }).ok, true);
  });

  test('upsertProviderConfig writes and round-trips project config', () => {
    const result = upsertProviderConfig('campus-llm', {
      name: 'Campus LLM',
      npm: '@ai-sdk/openai-compatible',
      options: {
        baseURL: 'https://llm.example.edu/v1',
        headers: { 'X-Campus': '1' },
      },
      models: { 'fast-model': { name: 'Fast' } },
      env: ['CAMPUS_KEY'],
    }, projectDir, 'project');

    assert.strictEqual(result.providerId, 'campus-llm');
    assert.strictEqual(fs.existsSync(result.path), true);
    assert.strictEqual(result.path.startsWith(projectDir), true);

    const written = readJson(result.path);
    assert.ok(written.provider !== undefined);
    assert.deepStrictEqual((written.provider as Record<string, unknown>)['campus-llm'], {
      npm: '@ai-sdk/openai-compatible',
      name: 'Campus LLM',
      env: ['CAMPUS_KEY'],
      options: { baseURL: 'https://llm.example.edu/v1', headers: { 'X-Campus': '1' } },
      models: { 'fast-model': { name: 'Fast' } },
    });

    const sources = getProviderSources('campus-llm', projectDir);
    assert.strictEqual(sources.project.exists, true);
  });

  test('upsertProviderConfig updates existing entry and clears disabled_providers', () => {
    const configPath = path.join(projectDir, 'opencode.json');
    writeJson(configPath, {
      provider: {
        'campus-llm': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Old',
          options: { baseURL: 'https://old.example.edu/v1' },
          models: { a: { name: 'A' } },
        },
      },
      disabled_providers: ['campus-llm', 'other'],
    });

    upsertProviderConfig('campus-llm', {
      name: 'Campus LLM',
      options: { baseURL: 'https://llm.example.edu/v1' },
      models: { b: { name: 'B' } },
      env: ['CAMPUS_KEY'],
    }, projectDir, 'project');

    const written = readJson(configPath);
    const entry = (written.provider as Record<string, Record<string, unknown>>)['campus-llm'];
    assert.strictEqual(entry.name, 'Campus LLM');
    assert.deepStrictEqual(entry.models, { b: { name: 'B' } });
    assert.deepStrictEqual(written.disabled_providers, ['other']);
  });

  test('upsert then remove restores absence', () => {
    upsertProviderConfig('temp-provider', {
      name: 'Temp',
      options: { baseURL: 'https://api.example.com/v1' },
      models: { m: { name: 'M' } },
      env: ['TEMP_KEY'],
    }, projectDir, 'project');

    assert.strictEqual(getProviderSources('temp-provider', projectDir).project.exists, true);
    assert.strictEqual(removeProviderConfig('temp-provider', projectDir, 'project'), true);
    assert.strictEqual(getProviderSources('temp-provider', projectDir).project.exists, false);
  });

  test('failed validation does not write config', () => {
    const configPath = path.join(projectDir, 'opencode.json');
    assert.throws(() => {
      upsertProviderConfig('ok', {
        name: 'X',
        options: { baseURL: 'not-a-url' },
        models: { m: { name: 'M' } },
        env: ['X'],
      }, projectDir, 'project');
    }, /Base URL/);
    assert.strictEqual(fs.existsSync(configPath), false);
  });

  test('hasStoredAuth allows config without env', () => {
    const result = upsertProviderConfig('keyed-provider', {
      name: 'Keyed',
      options: { baseURL: 'https://api.example.com/v1' },
      models: { m: { name: 'M' } },
    }, projectDir, 'project', { hasStoredAuth: true });

    assert.strictEqual(result.providerId, 'keyed-provider');
    assert.strictEqual(result.config.env, undefined);
  });

  test('project-scope edit updates project layer without creating a user entry', () => {
    const providerId = `proj-scope-${Date.now()}`;
    const configPath = path.join(projectDir, 'opencode.json');

    upsertProviderConfig(providerId, {
      name: 'Project Scoped',
      options: { baseURL: 'https://project.example.com/v1' },
      models: { m: { name: 'M' } },
    }, projectDir, 'project', { hasStoredAuth: true });

    upsertProviderConfig(providerId, {
      name: 'Project Scoped Updated',
      options: { baseURL: 'https://project.example.com/v2', headers: { 'X-Project': '1' } },
      models: { m: { name: 'M2' } },
    }, projectDir, 'project', { hasStoredAuth: true });

    const written = readJson(configPath);
    assert.deepStrictEqual((written.provider as Record<string, unknown>)[providerId], {
      npm: '@ai-sdk/openai-compatible',
      name: 'Project Scoped Updated',
      options: { baseURL: 'https://project.example.com/v2', headers: { 'X-Project': '1' } },
      models: { m: { name: 'M2' } },
    });

    const sources = getProviderSources(providerId, projectDir);
    assert.strictEqual(sources.project.exists, true);
    assert.strictEqual(sources.user.exists, false);
    assert.strictEqual(sources.custom.exists, false);
  });

  test('custom-scope edit updates custom layer without creating a user entry', () => {
    const providerId = `custom-scope-${Date.now()}`;
    const customPath = path.join(projectDir, 'custom-opencode.json');
    const previousEnv = process.env.OPENCODE_CONFIG;
    process.env.OPENCODE_CONFIG = customPath;

    try {
      upsertProviderConfig(providerId, {
        name: 'Custom Scoped',
        options: { baseURL: 'https://custom.example.com/v1' },
        models: { m: { name: 'M' } },
      }, projectDir, 'custom', { hasStoredAuth: true });

      upsertProviderConfig(providerId, {
        name: 'Custom Scoped Updated',
        options: { baseURL: 'https://custom.example.com/v2' },
        models: { n: { name: 'N' } },
      }, projectDir, 'custom', { hasStoredAuth: true });

      const written = readJson(customPath);
      assert.strictEqual(
        (written.provider as Record<string, Record<string, unknown>>)[providerId].name,
        'Custom Scoped Updated',
      );

      const sources = getProviderSources(providerId, projectDir);
      assert.strictEqual(sources.custom.exists, true);
      assert.strictEqual(sources.user.exists, false);
      assert.strictEqual(sources.project.exists, false);
    } finally {
      if (previousEnv === undefined) {
        delete process.env.OPENCODE_CONFIG;
      } else {
        process.env.OPENCODE_CONFIG = previousEnv;
      }
    }
  });

  test('provider scope isolation by working directory', () => {
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-vscode-scopeB-'));
    try {
      upsertProviderConfig('scoped-p', {
        name: 'Scoped',
        options: { baseURL: 'https://a.example.com/v1' },
        models: { m: { name: 'M' } },
        env: ['A_KEY'],
      }, projectDir, 'project');

      const inA = getProviderSources('scoped-p', projectDir);
      const inB = getProviderSources('scoped-p', dirB);

      assert.strictEqual(inA.project.exists, true);
      assert.strictEqual(inB.project.exists, false);
      assert.strictEqual(inB.user.exists, false);
    } finally {
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
});

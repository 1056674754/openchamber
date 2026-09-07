import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { projectProviderCatalogResponse, collectReferencedProviderIds } from './provider-catalog-filter';

describe('projectProviderCatalogResponse (live {all, default, connected} shape)', () => {
  const body = JSON.stringify({
    all: [
      { id: 'zhipuai-coding-plan', name: 'Zhipu', models: { 'glm-5.2': {} } },
      { id: 'deepseek', name: 'DeepSeek', models: { 'deepseek-v4': {} } },
      { id: 'openrouter', name: 'OpenRouter', models: Object.fromEntries(Array.from({ length: 360 }, (_, i) => [`m${i}`, {}])) },
      { id: 'nano-gpt', name: 'NanoGPT', models: Object.fromEntries(Array.from({ length: 592 }, (_, i) => [`m${i}`, {}])) },
    ],
    default: { 'zhipuai-coding-plan': 'zhipuai-coding-plan/glm-5.2', openrouter: 'openrouter/x' },
    connected: ['zhipuai-coding-plan', 'opencode'],
  });

  test('keeps configured + connected providers, drops the catalog', () => {
    const result = projectProviderCatalogResponse(body, new Set(['deepseek']));
    assert.equal(result.reason, 'kept');
    assert.equal(result.keptProviders, 2);
    assert.equal(result.totalProviders, 4);
    const parsed = JSON.parse(result.bodyText) as { all: Array<{ id: string }>; connected: string[]; default: Record<string, string> };
    assert.deepEqual(parsed.all.map((e) => e.id).sort(), ['deepseek', 'zhipuai-coding-plan']);
    assert.deepEqual(parsed.connected, ['zhipuai-coding-plan', 'opencode']);
    assert.equal(Object.keys(parsed.default).length, 2);
    assert.ok(result.bodyText.length < body.length / 2);
  });

  test('connected list alone is enough when config is empty', () => {
    const result = projectProviderCatalogResponse(body, new Set());
    assert.equal(result.reason, 'kept');
    assert.equal(result.keptProviders, 1);
  });

  test('passes through when nothing matches', () => {
    const noConnections = JSON.stringify({ all: JSON.parse(body).all, connected: [] });
    const result = projectProviderCatalogResponse(noConnections, new Set(['nonexistent']));
    assert.equal(result.reason, 'passthrough');
    assert.equal(result.bodyText, noConnections);
  });
});

describe('projectProviderCatalogResponse (legacy flat map shape)', () => {
  const body = JSON.stringify({
    'zhipuai-coding-plan': { models: { 'glm-5.2': {} } },
    openrouter: { models: Object.fromEntries(Array.from({ length: 360 }, (_, i) => [`m${i}`, {}])) },
  });

  test('keeps only configured providers', () => {
    const result = projectProviderCatalogResponse(body, new Set(['zhipuai-coding-plan']));
    assert.equal(result.reason, 'kept');
    const parsed = JSON.parse(result.bodyText) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), ['zhipuai-coding-plan']);
  });

  test('passes through non-object payloads untouched', () => {
    assert.equal(projectProviderCatalogResponse('[1,2,3]', new Set(['x'])).bodyText, '[1,2,3]');
    assert.equal(projectProviderCatalogResponse('not json', new Set(['x'])).bodyText, 'not json');
  });
});

describe('collectReferencedProviderIds', () => {
  test('extracts provider prefixes from provider/model strings', () => {
    const into = new Set<string>();
    collectReferencedProviderIds(['zhipuai-coding-plan/glm-5.2', 'deepseek/v4', 'bare', 42, null], into);
    assert.deepEqual([...into].sort(), ['deepseek', 'zhipuai-coding-plan']);
  });
});

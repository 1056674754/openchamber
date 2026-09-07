import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { projectProviderCatalogResponse } from './provider-catalog-filter';

describe('projectProviderCatalogResponse', () => {
  const catalog = {
    'zhipuai-coding-plan': { models: { 'glm-5.2': { name: 'GLM 5.2' } } },
    deepseek: { models: { 'deepseek-v4': { name: 'DeepSeek V4' } } },
    openrouter: { models: Object.fromEntries(Array.from({ length: 360 }, (_, i) => [`m${i}`, {}])) },
    'nano-gpt': { models: Object.fromEntries(Array.from({ length: 592 }, (_, i) => [`m${i}`, {}])) },
  };
  const body = JSON.stringify(catalog);

  test('keeps only configured providers and shrinks the payload', () => {
    const keep = new Set(['zhipuai-coding-plan', 'deepseek']);
    const filtered = JSON.parse(projectProviderCatalogResponse(body, keep)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(filtered).sort(), ['deepseek', 'zhipuai-coding-plan']);
    assert.ok(filtered['zhipuai-coding-plan'] !== undefined);
  });

  test('falls back to the original body when nothing matches', () => {
    const keep = new Set(['not-present']);
    assert.equal(projectProviderCatalogResponse(body, keep), body);
  });

  test('passes through non-object payloads untouched', () => {
    assert.equal(projectProviderCatalogResponse('[1,2,3]', new Set(['x'])), '[1,2,3]');
    assert.equal(projectProviderCatalogResponse('not json', new Set(['x'])), 'not json');
  });
});

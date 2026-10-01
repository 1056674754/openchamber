import { describe, expect, it } from 'vitest';

import { appendManagedPlugin } from './managed-plugin-config.js';

describe('appendManagedPlugin (v2 write track)', () => {
  it('appends a plugin directory to an empty config', () => {
    const merged = JSON.parse(appendManagedPlugin(undefined, '/tools/agent-tool', 'managed tool'));
    expect(merged).toEqual({ plugins: ['/tools/agent-tool'] });
  });

  it('preserves other keys and dedupes by directory, including [dir, options] entries', () => {
    const raw = JSON.stringify({
      model: 'test/model',
      plugins: ['/tools/agent-tool', ['/tools/other', { opt: 1 }]],
    });
    const merged = JSON.parse(appendManagedPlugin(raw, '/tools/agent-tool', 'managed tool'));
    expect(merged).toEqual({
      model: 'test/model',
      plugins: [['/tools/other', { opt: 1 }], '/tools/agent-tool'],
    });
  });

  it('folds a legacy plugin key into plugins and removes it', () => {
    const raw = JSON.stringify({ plugin: ['file:///legacy/plugin.js'] });
    const merged = JSON.parse(appendManagedPlugin(raw, '/tools/agent-tool', 'managed tool'));
    expect(merged).toEqual({
      plugins: ['file:///legacy/plugin.js', '/tools/agent-tool'],
    });
    expect(merged.plugin).toBeUndefined();
  });

  it('rejects a non-array plugin or plugins key', () => {
    expect(() => appendManagedPlugin('{"plugin":"nope"}', '/tools/agent-tool', 'managed tool')).toThrow(
      'OPENCODE_CONFIG_CONTENT plugin must be an array',
    );
    expect(() => appendManagedPlugin('{"plugins":42}', '/tools/agent-tool', 'managed tool')).toThrow(
      'OPENCODE_CONFIG_CONTENT plugins must be an array',
    );
  });

  it('rejects content that is not a JSON object', () => {
    expect(() => appendManagedPlugin('[1,2]', '/tools/agent-tool', 'managed tool')).toThrow(
      'OPENCODE_CONFIG_CONTENT must contain a valid JSON object',
    );
    expect(() => appendManagedPlugin('{oops', '/tools/agent-tool', 'managed tool')).toThrow(
      'OPENCODE_CONFIG_CONTENT must contain a valid JSON object',
    );
  });
});

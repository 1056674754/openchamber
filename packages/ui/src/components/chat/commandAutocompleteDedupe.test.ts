import { describe, expect, test } from 'bun:test';

import { dedupeCommandAutocompleteEntries } from './commandAutocompleteDedupe';

describe('dedupeCommandAutocompleteEntries', () => {
  test('prefers the direct skill entry over a skill-shaped command with the same slash name', () => {
    const entries = dedupeCommandAutocompleteEntries([
      {
        id: 'opencode:user:lark-openapi-explorer:0',
        name: 'lark-openapi-explorer',
        source: 'opencode',
        description: '(user - Skill) Lark OpenAPI explorer',
        isSkill: true,
      },
      {
        id: 'skill:user:agents:lark-openapi-explorer:0',
        name: 'lark-openapi-explorer',
        source: 'skill',
        description: 'Lark OpenAPI explorer',
        isSkill: true,
        scope: 'user',
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('skill:user:agents:lark-openapi-explorer:0');
  });

  test('keeps real commands ahead of same-named skills', () => {
    const entries = dedupeCommandAutocompleteEntries([
      {
        id: 'command:project:deploy',
        name: 'deploy',
        source: 'opencode',
        description: 'Deploy command',
        scope: 'project',
      },
      {
        id: 'skill:user:deploy',
        name: 'deploy',
        source: 'skill',
        description: 'Deploy skill',
        isSkill: true,
        scope: 'user',
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('command:project:deploy');
  });

  test('dedupes names case-insensitively', () => {
    const entries = dedupeCommandAutocompleteEntries([
      { id: 'skill:user:one', name: 'Lark-OpenApi-Explorer', source: 'skill', isSkill: true, scope: 'user' },
      { id: 'skill:project:one', name: 'lark-openapi-explorer', source: 'skill', isSkill: true, scope: 'project' },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('skill:project:one');
  });
});

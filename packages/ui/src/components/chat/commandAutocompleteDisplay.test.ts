import { describe, expect, test } from 'bun:test';

import { getCommandNameDisplayParts } from './commandAutocompleteDisplay';

describe('getCommandNameDisplayParts', () => {
  test('emphasizes the varying suffix for repeated command prefixes', () => {
    expect(getCommandNameDisplayParts('glab-deploy-key', 'glab')).toEqual({
      mutedPrefix: 'glab-',
      emphasis: 'deploy-key',
    });
  });

  test('accepts slash-prefixed queries', () => {
    expect(getCommandNameDisplayParts('glab-gpg-key', '/glab')).toEqual({
      mutedPrefix: 'glab-',
      emphasis: 'gpg-key',
    });
  });

  test('keeps short queries as the full command name', () => {
    expect(getCommandNameDisplayParts('glab-config', 'g')).toEqual({
      mutedPrefix: '',
      emphasis: 'glab-config',
    });
  });

  test('keeps exact matches as the full command name', () => {
    expect(getCommandNameDisplayParts('glab', 'glab')).toEqual({
      mutedPrefix: '',
      emphasis: 'glab',
    });
  });
});

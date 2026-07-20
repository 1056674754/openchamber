import { describe, expect, test } from 'bun:test';

import { createDirectoryListError } from './directory-list-error';

describe('createDirectoryListError', () => {
  test('preserves the failing directory and server detail', () => {
    const error = createDirectoryListError(
      new Error('Directory not found (HTTP 404)'),
      '/repo/deleted-output',
    );

    expect(error.message).toBe(
      'Failed to list directory "/repo/deleted-output": Directory not found (HTTP 404)',
    );
  });
});

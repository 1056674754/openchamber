import { describe, expect, test } from 'bun:test';

import { createDirectoryListError } from './directory-list-error';
import { FilesystemError } from '@/lib/api/files-errors';

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

  test('preserves typed filesystem reasons for recovery actions', () => {
    const source = new FilesystemError('Access to directory denied', {
      reason: 'os-permission',
      status: 403,
    });

    const error = createDirectoryListError(source, '/repo/protected');

    expect(error).toBe(source);
  });
});

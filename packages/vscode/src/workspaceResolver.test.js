import { describe, expect, test } from 'bun:test';

import { resolveWorkspaceFolders } from './workspaceResolver';

describe('resolveWorkspaceFolders', () => {
  test('normalizes, dedupes, and sorts workspace folders', () => {
    expect(resolveWorkspaceFolders([
      { name: 'Zulu', uri: { fsPath: '/workspace/zulu/' } },
      { name: 'alpha', uri: { fsPath: '/workspace/alpha' } },
      { name: 'duplicate', uri: { fsPath: '/workspace/zulu' } },
      { name: 'Windows', uri: { fsPath: 'd:\\work\\project' } },
    ])).toEqual([
      { name: 'alpha', path: '/workspace/alpha' },
      { name: 'Windows', path: 'D:\\work\\project' },
      { name: 'Zulu', path: '/workspace/zulu' },
    ]);
  });
});

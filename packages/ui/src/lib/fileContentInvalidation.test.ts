import { describe, expect, test } from 'bun:test';

import {
  createFileContentScopeKey,
  notifyFileContentInvalidated,
  subscribeToFileContentInvalidation,
} from './fileContentInvalidation';

describe('fileContentInvalidation', () => {
  test('partitions and normalizes invalidations by runtime and server', () => {
    const received: Array<{ scopeKey: string; paths: readonly string[] }> = [];
    const unsubscribe = subscribeToFileContentInvalidation((entry) => received.push(entry));
    const scopeKey = createFileContentScopeKey(' runtime-a ', '/api/remote/dev3/');

    notifyFileContentInvalidated({
      scopeKey,
      paths: [' /repo/a.txt ', '/repo/a.txt', '', '/repo/b.txt'],
    });
    unsubscribe();

    expect(received).toEqual([{
      scopeKey: '["runtime-a","/api/remote/dev3"]',
      paths: ['/repo/a.txt', '/repo/b.txt'],
    }]);
    expect(createFileContentScopeKey('runtime-a', '/api/remote/dev1'))
      .not.toBe(createFileContentScopeKey('runtime-a', '/api/remote/dev3'));
  });

  test('stops publishing after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeToFileContentInvalidation(() => { calls += 1; });
    unsubscribe();

    notifyFileContentInvalidated({ scopeKey: '["runtime-a",""]', paths: ['/repo/a.txt'] });

    expect(calls).toBe(0);
  });
});

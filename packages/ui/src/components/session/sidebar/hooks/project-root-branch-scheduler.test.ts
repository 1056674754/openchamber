import { describe, expect, test } from 'bun:test';
import { createProjectRootBranchScheduler } from './project-root-branch-scheduler';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('createProjectRootBranchScheduler', () => {
  test('starts ready projects immediately and coalesces duplicate syncs', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const starts: string[] = [];
    const resolved: Array<{ id: string; branch: string }> = [];
    const scheduler = createProjectRootBranchScheduler({
      concurrency: 1,
      onResolved: (entry) => resolved.push(entry),
    });

    const firstCandidate = {
      id: 'first',
      inputKey: 'first@main',
      resolve: () => {
        starts.push('first');
        return first.promise;
      },
    };
    const secondCandidate = {
      id: 'second',
      inputKey: 'second@main',
      resolve: () => {
        starts.push('second');
        return second.promise;
      },
    };

    scheduler.sync([firstCandidate]);
    scheduler.sync([firstCandidate, secondCandidate]);
    expect(starts).toEqual(['first']);

    first.resolve('main');
    await flushPromises();
    expect(starts).toEqual(['first', 'second']);
    expect(resolved).toEqual([{ id: 'first', branch: 'main' }]);

    second.resolve('main');
    await flushPromises();
    expect(resolved).toEqual([
      { id: 'first', branch: 'main' },
      { id: 'second', branch: 'main' },
    ]);
  });

  test('discards a stale result when the same project input changes', async () => {
    const stale = deferred<string | null>();
    const current = deferred<string | null>();
    const resolved: Array<{ id: string; branch: string }> = [];
    const scheduler = createProjectRootBranchScheduler({
      concurrency: 1,
      onResolved: (entry) => resolved.push(entry),
    });

    scheduler.sync([{
      id: 'project',
      inputKey: 'project@old',
      resolve: () => stale.promise,
    }]);
    scheduler.sync([{
      id: 'project',
      inputKey: 'project@new',
      resolve: () => current.promise,
    }]);

    stale.resolve('old');
    await flushPromises();
    expect(resolved).toEqual([]);

    current.resolve('new');
    await flushPromises();
    expect(resolved).toEqual([{ id: 'project', branch: 'new' }]);
  });
});

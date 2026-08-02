import { describe, expect, test } from 'bun:test';

import { getBackgroundNetworkState, runBackgroundNetworkTask } from './background-network';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('runBackgroundNetworkTask', () => {
  test('caps concurrency and drains queued work', async () => {
    const { limit } = getBackgroundNetworkState();
    const gates = Array.from({ length: limit + 2 }, () => deferred<number>());
    const started: number[] = [];
    const results = gates.map((gate, index) => runBackgroundNetworkTask(() => {
      started.push(index);
      return gate.promise;
    }));

    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    expect(getBackgroundNetworkState()).toEqual({ active: limit, waiting: 2, limit });

    gates[0].resolve(0);
    await results[0];
    expect(started).toContain(3);

    gates.forEach((gate, index) => gate.resolve(index));
    await Promise.all(results);
    expect(getBackgroundNetworkState()).toEqual({ active: 0, waiting: 0, limit });
  });
});

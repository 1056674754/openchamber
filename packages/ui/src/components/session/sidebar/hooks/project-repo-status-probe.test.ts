import { describe, expect, test } from 'bun:test';
import { retryProjectRepoStatusProbe } from './project-repo-status-probe';

describe('retryProjectRepoStatusProbe', () => {
  test('retries transient failures until the background probe succeeds', async () => {
    const results = [false, false, true];
    const delays: number[] = [];

    const succeeded = await retryProjectRepoStatusProbe(
      async () => results.shift() ?? false,
      {
        retryDelaysMs: [1_000, 2_000, 4_000],
        waitForDelay: async (delayMs) => {
          delays.push(delayMs);
          return true;
        },
      },
    );

    expect(succeeded).toBe(true);
    expect(delays).toEqual([1_000, 2_000]);
  });

  test('stops retrying when the effect is aborted', async () => {
    const controller = new AbortController();
    let attempts = 0;

    const succeeded = await retryProjectRepoStatusProbe(
      async () => {
        attempts += 1;
        controller.abort();
        return false;
      },
      {
        signal: controller.signal,
        retryDelaysMs: [1_000],
      },
    );

    expect(succeeded).toBe(false);
    expect(attempts).toBe(1);
  });
});

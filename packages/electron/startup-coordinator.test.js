import { describe, expect, it, vi } from 'vitest';

import { createSingleFlight } from './startup-coordinator.mjs';

describe('Electron startup coordinator', () => {
  it('starts the local server once when startup requests overlap', async () => {
    let releaseStart;
    const pendingStart = new Promise((resolve) => {
      releaseStart = resolve;
    });
    const start = vi.fn(() => pendingStart);
    const startOnce = createSingleFlight(start);

    const first = startOnce();
    const second = startOnce();
    releaseStart('http://127.0.0.1:57123');

    await expect(Promise.all([first, second])).resolves.toEqual([
      'http://127.0.0.1:57123',
      'http://127.0.0.1:57123',
    ]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('allows a new startup attempt after the previous one fails', async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(new Error('port unavailable'))
      .mockResolvedValueOnce('http://127.0.0.1:57124');
    const startOnce = createSingleFlight(start);

    await expect(startOnce()).rejects.toThrow('port unavailable');
    await expect(startOnce()).resolves.toBe('http://127.0.0.1:57124');
    expect(start).toHaveBeenCalledTimes(2);
  });
});

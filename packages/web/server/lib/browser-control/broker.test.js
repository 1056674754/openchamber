import { describe, expect, it, vi } from 'vitest';
import { BrowserControlError, createBrowserControlBroker } from './broker.js';

describe('browser control broker', () => {
  it('fails immediately when no capable client is listening', async () => {
    const broker = createBrowserControlBroker({ emitRequest: () => 0 });
    await expect(broker.request('browser.snapshot')).rejects.toMatchObject({ status: 503 });
    expect(broker.pendingCount).toBe(0);
  });

  it('allows one claimant and resolves its result', async () => {
    let request;
    const broker = createBrowserControlBroker({
      createId: () => 'browser-1',
      emitRequest: (value) => { request = value; return 2; },
    });
    const pending = broker.request('browser.click', { selector: '#save' });
    expect(request).toEqual({ requestId: 'browser-1', action: 'browser.click', parameters: { selector: '#save' } });
    expect(broker.claim('browser-1')).toBe(true);
    expect(broker.claim('browser-1')).toBe(false);
    expect(broker.resolve('browser-1', { ok: true, data: { clicked: true } })).toBe(true);
    await expect(pending).resolves.toEqual({ clicked: true });
  });

  it('times out a claimed client that never answers', async () => {
    vi.useFakeTimers();
    try {
      const broker = createBrowserControlBroker({ emitRequest: () => 1 });
      const pending = broker.request('browser.snapshot', {}, { timeoutMs: 1000 });
      const expectation = expect(pending).rejects.toBeInstanceOf(BrowserControlError);
      await vi.advanceTimersByTimeAsync(1000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});

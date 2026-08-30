import { describe, expect, test } from 'bun:test';

import { createBrowserControlClient } from './controlClient';
import type { OpenChamberEventEnvelope } from '@/lib/openchamberEvents';

const response = (body: unknown, ok = true): Response => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
} as Response);

const event = (requestId: string, action: string, serverId = 'default', parameters = {}) => ({
  type: 'openchamber:browser-control-request',
  serverId,
  properties: { requestId, action, parameters },
});

describe('Browser control client', () => {
  test('claims before acting and returns the controller result', async () => {
    let listener: (value: OpenChamberEventEnvelope) => void = () => {};
    const calls: Array<{ serverId: string; path: string; body: Record<string, unknown> }> = [];
    const runCalls: Array<{ action: string; parameters: Record<string, unknown> }> = [];
    const run = async (action: string, parameters: Record<string, unknown>) => {
      runCalls.push({ action, parameters });
      return { clicked: '#save' };
    };
    const client = createBrowserControlClient({
      subscribe: (next) => { listener = next; return () => { listener = () => {}; }; },
      fetchServer: async (serverId, path, init) => {
        calls.push({ serverId, path, body: JSON.parse(String(init.body)) });
        return path.endsWith('/claim') ? response({ granted: true }) : response({ matched: true });
      },
    });
    client.registerController('default', { run });

    listener(event('req-1', 'browser.click', 'default', { selector: '#save' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runCalls).toEqual([{ action: 'browser.click', parameters: { selector: '#save' } }]);
    expect(calls.map((entry) => entry.path)).toEqual([
      '/api/browser-control/claim',
      '/api/browser-control/result',
    ]);
    expect(calls[1]?.body).toEqual({ requestId: 'req-1', ok: true, data: { clicked: '#save' } });
  });

  test('does not claim a request from another server', async () => {
    let listener: (value: OpenChamberEventEnvelope) => void = () => {};
    let fetchCount = 0;
    let runCount = 0;
    const client = createBrowserControlClient({
      subscribe: (next) => { listener = next; return () => {}; },
      fetchServer: async () => { fetchCount += 1; return response({ granted: true }); },
    });
    client.registerController('remote-a', { run: async () => { runCount += 1; return {}; } });

    listener(event('req-wrong', 'browser.snapshot', 'remote-b'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchCount).toBe(0);
    expect(runCount).toBe(0);
  });

  test('reports controller failures instead of timing out silently', async () => {
    let listener: (value: OpenChamberEventEnvelope) => void = () => {};
    const outcomes: Record<string, unknown>[] = [];
    const client = createBrowserControlClient({
      subscribe: (next) => { listener = next; return () => {}; },
      fetchServer: async (_serverId, path, init) => {
        if (path.endsWith('/claim')) return response({ granted: true });
        outcomes.push(JSON.parse(String(init.body)));
        return response({ matched: true });
      },
    });
    client.registerController('default', { run: async () => { throw new Error('No element matches #missing'); } });

    listener(event('req-error', 'browser.click', 'default', { selector: '#missing' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(outcomes[0]).toEqual({ requestId: 'req-error', ok: false, error: 'No element matches #missing' });
  });

  test('opens a tab before running browser.open when no controller is mounted', async () => {
    let listener: (value: OpenChamberEventEnvelope) => void = () => {};
    const opened: string[] = [];
    const results: Record<string, unknown>[] = [];
    const client = createBrowserControlClient({
      subscribe: (next) => { listener = next; return () => {}; },
      setTimer: ((callback: () => void) => {
        client.registerController('default', { run: async () => ({ opened: true, url: 'https://example.com/' }) });
        return setTimeout(callback, 0);
      }) as typeof setTimeout,
      fetchServer: async (_serverId, path, init) => {
        if (path.endsWith('/claim')) return response({ granted: true });
        results.push(JSON.parse(String(init.body)));
        return response({ matched: true });
      },
    });
    client.registerOpener('default', (url) => opened.push(url));

    listener(event('req-open', 'browser.open', 'default', { url: 'https://example.com' }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(opened).toEqual(['https://example.com']);
    expect(results[0]).toEqual({
      requestId: 'req-open',
      ok: true,
      data: { opened: true, url: 'https://example.com/' },
    });
  });
});

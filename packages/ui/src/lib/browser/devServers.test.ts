import { describe, expect, test } from 'bun:test';

import { fetchDevServers, parseDevServers } from './devServers';

const jsonResponse = (value: unknown, ok = true): Response => ({
  ok,
  json: async () => value,
} as Response);

describe('Browser dev-server discovery', () => {
  test('validates, deduplicates, and orders server payloads', () => {
    expect(parseDevServers({
      servers: [
        { port: 8000, url: 'http://localhost:8000/', command: 'python' },
        { port: 5173, url: 'http://localhost:5173/', command: 'node' },
        { port: 5173, url: 'http://localhost:5173/duplicate', command: 'node' },
        { port: 0, url: 'http://localhost/', command: 'bad' },
      ],
    })).toEqual([
      { port: 5173, url: 'http://localhost:5173/', command: 'node' },
      { port: 8000, url: 'http://localhost:8000/', command: 'python' },
    ]);
  });

  test('keeps unavailable distinct from a successful empty scan', async () => {
    const empty = await fetchDevServers({
      serverId: 'default',
      defaultFetch: async () => jsonResponse({ servers: [] }),
    });
    const failed = await fetchDevServers({
      serverId: 'default',
      defaultFetch: async () => jsonResponse({ error: 'scan failed' }, false),
    });
    expect(empty).toEqual({ kind: 'ready', servers: [] });
    expect(failed).toEqual({ kind: 'unavailable' });
  });

  test('uses the shared runtime transport for the default server', async () => {
    const calls: string[] = [];
    await fetchDevServers({
      serverId: 'default',
      defaultFetch: async (path) => {
        calls.push(String(path));
        return jsonResponse({ servers: [] });
      },
    });
    expect(calls).toEqual(['/api/dev-servers']);
  });
});

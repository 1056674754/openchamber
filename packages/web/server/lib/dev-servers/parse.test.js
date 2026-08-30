import { describe, expect, test } from 'bun:test';
import { isLocallyReachableHost, parseLsofListeners, parseNetstatListeners, parseProcNetTcpListeners, selectDevServerCandidates } from './parse.js';

describe('dev server listener parsing', () => {
  test('parses and deduplicates lsof loopback/wildcard listeners', () => {
    const output = ['p1234', 'cnode', 'n*:5173', 'n[::1]:5173', 'p5678', 'cpython3', 'n127.0.0.1:8000', 'n192.168.1.2:9000'].join('\n');
    expect(parseLsofListeners(output)).toEqual([
      { port: 5173, pid: 1234, command: 'node' },
      { port: 8000, pid: 5678, command: 'python3' },
    ]);
  });

  test('parses Windows netstat and excludes established/LAN-only sockets', () => {
    const output = [
      'TCP 0.0.0.0:5173 0.0.0.0:0 LISTENING 42',
      'TCP 192.168.1.2:9000 0.0.0.0:0 LISTENING 43',
      'TCP 127.0.0.1:8000 127.0.0.1:50000 ESTABLISHED 44',
    ].join('\n');
    expect(parseNetstatListeners(output)).toEqual([{ port: 5173, pid: 42, command: '' }]);
  });

  test('parses Linux proc tables', () => {
    const output = '0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:0 0 0 0';
    expect(parseProcNetTcpListeners(output)).toEqual([{ port: 3000, pid: null, command: '' }]);
  });

  test('filters own and infrastructure ports without hiding unusual ports', () => {
    const listeners = [
      { port: 3902, pid: 1, command: 'openchamber' },
      { port: 5432, pid: 2, command: 'postgres' },
      { port: 5173, pid: 3, command: 'node' },
      { port: 12345, pid: 4, command: 'bun' },
    ];
    expect(selectDevServerCandidates(listeners, { ownPorts: [3902] }).map((entry) => entry.port)).toEqual([5173, 12345]);
    expect(isLocallyReachableHost('[::1]')).toBe(true);
    expect(isLocallyReachableHost('10.0.0.5')).toBe(false);
  });
});

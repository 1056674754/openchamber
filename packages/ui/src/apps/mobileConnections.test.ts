import { describe, expect, mock, test } from 'bun:test';

import {
  failureReasonMessageKey,
  isExpectedMobileTokenMissing,
  loadMobileConnections,
  mapPairingRedeemFailure,
  migrateLegacyInlineTokenRecords,
  mobileTransportCapability,
  pairingCandidatesToMobile,
  upsertMobileConnection,
  validateMobileConnectionSession,
  type MobileRelayConfig,
} from './mobileConnections';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

const createLocalStorageStub = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
};

const installTestWindow = (native = false) => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: { protocol: 'https:' },
      Capacitor: { isNativePlatform: () => native },
      localStorage: createLocalStorageStub(),
    },
  });
};

const restoreGlobals = () => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
};

const STORAGE_KEY = 'openchamber.mobile.connections.v1';

const testRelay: MobileRelayConfig = {
  relayUrl: 'wss://relay.example/tunnel',
  serverId: 'srv_test123',
  hostEncPubJwk: { kty: 'EC', crv: 'P-256', x: 'eHhY', y: 'eVlZ' },
};

describe('mobile connection storage', () => {
  test('native LAN metadata keeps both instances and their secure-token flags', async () => {
    try {
      installTestWindow(true);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
        {
          id: 'native-a', label: 'Server A', lastUsedAt: 10, hasToken: true,
          candidates: [{ kind: 'direct', url: 'http://192.168.1.10:2606' }],
        },
      ]));
      await upsertMobileConnection({
        label: 'Server B',
        candidates: [{ kind: 'direct', url: 'http://192.168.1.20:2606' }],
      });

      const reloaded = await loadMobileConnections();
      expect(reloaded).toHaveLength(2);
      const nativeA = reloaded.find((connection) => connection.id === 'native-a');
      expect(nativeA?.label).toBe('Server A');
      expect(nativeA?.hasToken).toBe(true);
      expect(nativeA?.candidates).toEqual([{ kind: 'direct', url: 'http://192.168.1.10:2606' }]);
      expect(reloaded.find((connection) => connection.label === 'Server B')?.id).not.toBe('native-a');
      expect(reloaded.every((connection) => connection.clientToken === undefined)).toBe(true);
    } finally {
      restoreGlobals();
    }
  });

  test('LAN servers keep separate identities and credentials after re-pairing and reload', async () => {
    try {
      installTestWindow();
      const first = await upsertMobileConnection({
        label: 'Server A',
        candidates: [{ kind: 'direct', url: 'http://192.168.1.10:2606' }],
        clientToken: 'token-a',
      });
      const firstId = first[0]?.id;
      const second = await upsertMobileConnection({
        label: 'Server B',
        candidates: [{ kind: 'direct', url: 'http://192.168.1.20:2606' }],
        clientToken: 'token-b',
      });
      expect(second).toHaveLength(2);
      const secondId = second[0]?.id;
      expect(secondId).not.toBe(firstId);

      await upsertMobileConnection({
        label: 'Server A paired again',
        candidates: [{ kind: 'direct', url: 'http://192.168.1.10:2606/' }],
        clientToken: 'token-a-new',
      });

      const reloaded = await loadMobileConnections();
      expect(reloaded).toHaveLength(2);
      const repaired = reloaded.find((connection) => connection.id === firstId);
      expect(repaired?.label).toBe('Server A paired again');
      expect(repaired?.clientToken).toBe('token-a-new');
      const serverB = reloaded.find((connection) => connection.id === secondId);
      expect(serverB?.label).toBe('Server B');
      expect(serverB?.clientToken).toBe('token-b');
      expect(serverB?.candidates).toEqual([{ kind: 'direct', url: 'http://192.168.1.20:2606' }]);
    } finally {
      restoreGlobals();
    }
  });

  test('adding a LAN server preserves a legacy saved LAN server', async () => {
    try {
      installTestWindow();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
        { id: 'legacy-a', label: 'Server A', url: 'http://192.168.1.10:2606', lastUsedAt: 10, clientToken: 'token-a' },
      ]));
      await upsertMobileConnection({
        label: 'Server B',
        candidates: [{ kind: 'direct', url: 'http://192.168.1.20:2606' }],
        clientToken: 'token-b',
      });

      const reloaded = await loadMobileConnections();
      expect(reloaded).toHaveLength(2);
      const legacy = reloaded.find((connection) => connection.id === 'legacy-a');
      expect(legacy?.label).toBe('Server A');
      expect(legacy?.clientToken).toBe('token-a');
      expect(legacy?.candidates).toEqual([{ kind: 'direct', url: 'http://192.168.1.10:2606' }]);
    } finally {
      restoreGlobals();
    }
  });

  test('relay servers stay distinct and re-pair by server identity when the LAN address changes', async () => {
    try {
      installTestWindow();
      const first = await upsertMobileConnection({
        label: 'Server A',
        candidates: [
          { kind: 'direct', url: 'http://192.168.1.10:2606' },
          { kind: 'relay', relay: testRelay },
        ],
        clientToken: 'token-a',
      });
      const firstId = first[0]?.id;
      const secondRelay = { ...testRelay, serverId: 'srv_second' };
      const second = await upsertMobileConnection({
        label: 'Server B',
        candidates: [{ kind: 'relay', relay: secondRelay }],
        clientToken: 'token-b',
      });
      const secondId = second[0]?.id;
      expect(second).toHaveLength(2);
      expect(secondId).not.toBe(firstId);

      await upsertMobileConnection({
        label: 'Server A paired again',
        candidates: [
          { kind: 'direct', url: 'http://192.168.1.30:2606' },
          { kind: 'relay', relay: testRelay },
        ],
        clientToken: 'token-a-new',
      });

      const reloaded = await loadMobileConnections();
      expect(reloaded).toHaveLength(2);
      const repaired = reloaded.find((connection) => connection.id === firstId);
      expect(repaired?.label).toBe('Server A paired again');
      expect(repaired?.clientToken).toBe('token-a-new');
      expect(repaired?.candidates).toEqual([
        { kind: 'direct', url: 'http://192.168.1.30:2606' },
        { kind: 'relay', relay: testRelay },
      ]);
      const serverB = reloaded.find((connection) => connection.id === secondId);
      expect(serverB?.label).toBe('Server B');
      expect(serverB?.clientToken).toBe('token-b');
      expect(serverB?.candidates).toEqual([{ kind: 'relay', relay: secondRelay }]);
    } finally {
      restoreGlobals();
    }
  });

  test('distinguishes a valid tokenless connection from a missing expected token', () => {
    expect(isExpectedMobileTokenMissing(false, undefined)).toBe(false);
    expect(isExpectedMobileTokenMissing(undefined, undefined)).toBe(false);
    expect(isExpectedMobileTokenMissing(true, undefined)).toBe(true);
    expect(isExpectedMobileTokenMissing(true, 'token')).toBe(false);
  });

  test('removes inline tokens only after each secure migration succeeds', async () => {
    const result = await migrateLegacyInlineTokenRecords([
      { id: 'ok', url: 'http://ok.example', clientToken: 'token-ok' },
      { id: 'failed', url: 'http://failed.example', clientToken: 'token-failed' },
    ], async (url) => url.includes('ok.example'));

    expect(result.migrated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.records[0]).toEqual({ id: 'ok', url: 'http://ok.example', hasToken: true });
    expect(result.records[1]).toEqual({ id: 'failed', url: 'http://failed.example', clientToken: 'token-failed' });
  });

  test('entries persisted before candidates migrate to a single direct candidate', async () => {
    try {
      installTestWindow();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
        { id: 'a', label: 'Home', url: 'http://192.168.1.10:2606', lastUsedAt: 10, clientToken: 'tok-a' },
        { id: 'b', label: 'Work', url: 'http://work.example', lastUsedAt: 5 },
      ]));

      const connections = await loadMobileConnections();
      expect(connections).toHaveLength(2);
      const home = connections.find((c) => c.id === 'a')!;
      expect(home.candidates).toEqual([{ kind: 'direct', url: 'http://192.168.1.10:2606' }]);
      expect(home.clientToken).toBe('tok-a');
    } finally {
      restoreGlobals();
    }
  });

  test('a relay device round-trips its candidate + token', async () => {
    try {
      installTestWindow();

      await upsertMobileConnection({
        label: 'My Desktop',
        candidates: [{ kind: 'relay', relay: testRelay }],
        clientToken: 'oc_client_secret',
      });

      const connections = await loadMobileConnections();
      expect(connections).toHaveLength(1);
      const saved = connections[0]!;
      expect(saved.candidates).toEqual([{ kind: 'relay', relay: testRelay }]);
      // Web surface: token stays inline like direct connections.
      expect(saved.clientToken).toBe('oc_client_secret');

      // Persisted metadata carries only the three transport fields — no grant/token.
      const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]') as Array<Record<string, unknown>>;
      const rawCandidate = (raw[0]?.candidates as Array<Record<string, unknown>>)[0];
      expect(rawCandidate.kind).toBe('relay');
      expect(Object.keys(rawCandidate.relay as object).sort()).toEqual(['hostEncPubJwk', 'relayUrl', 'serverId']);
    } finally {
      restoreGlobals();
    }
  });

  test('a multi-transport device persists all candidates in order (LAN then relay)', async () => {
    try {
      installTestWindow();
      await upsertMobileConnection({
        label: 'Both',
        candidates: [{ kind: 'direct', url: 'http://192.168.1.5:2606' }, { kind: 'relay', relay: testRelay }],
        clientToken: 'tok',
      });

      const connections = await loadMobileConnections();
      expect(connections[0]?.candidates.map((c) => c.kind)).toEqual(['direct', 'relay']);
    } finally {
      restoreGlobals();
    }
  });

  test('a legacy relay entry with malformed transport config is dropped, direct entries survive', async () => {
    try {
      installTestWindow();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
        { id: 'bad', label: 'Broken', lastUsedAt: 20, mode: 'relay', relay: { relayUrl: 'wss://relay.example' } },
        { id: 'ok', label: 'Home', url: 'http://192.168.1.10:2606', lastUsedAt: 10 },
      ]));

      const connections = await loadMobileConnections();
      expect(connections).toHaveLength(1);
      expect(connections[0]?.id).toBe('ok');
      expect(connections[0]?.candidates[0]?.kind).toBe('direct');
    } finally {
      restoreGlobals();
    }
  });

  test('relay and direct devices dedupe independently by candidate identity', async () => {
    try {
      installTestWindow();
      await upsertMobileConnection({ label: 'Direct', candidates: [{ kind: 'direct', url: 'http://host.example' }] });
      await upsertMobileConnection({ label: 'Relay', candidates: [{ kind: 'relay', relay: testRelay }] });
      await upsertMobileConnection({ label: 'Relay renamed', candidates: [{ kind: 'relay', relay: testRelay }] });

      const connections = await loadMobileConnections();
      expect(connections).toHaveLength(2);
      const relayEntries = connections.filter((c) => c.candidates.some((x) => x.kind === 'relay'));
      expect(relayEntries).toHaveLength(1);
      expect(relayEntries[0]?.label).toBe('Relay renamed');
    } finally {
      restoreGlobals();
    }
  });
});

describe('connect failure mapping', () => {
  test('mapPairingRedeemFailure maps HTTP status to reasons', () => {
    expect(mapPairingRedeemFailure(410)).toBe('pairing-expired');
    expect(mapPairingRedeemFailure(404)).toBe('pairing-expired');
    expect(mapPairingRedeemFailure(400)).toBe('pairing-expired');
    expect(mapPairingRedeemFailure(409)).toBe('pairing-used');
    expect(mapPairingRedeemFailure(401)).toBe('auth-required');
    expect(mapPairingRedeemFailure(500)).toBe('server-error');
    expect(mapPairingRedeemFailure(null)).toBe('unreachable');
  });

  test('failureReasonMessageKey returns stable i18n keys', () => {
    expect(failureReasonMessageKey('relay-timeout')).toBe('mobile.connect.error.relayTimeout');
    expect(failureReasonMessageKey('pairing-expired')).toBe('mobile.connect.error.pairingExpired');
    expect(failureReasonMessageKey('storage-failed')).toBe('mobile.connect.error.storageFailed');
  });

  test('mobileTransportCapability summarizes candidate sets', () => {
    expect(mobileTransportCapability([{ kind: 'relay', relay: testRelay }])).toBe('relay');
    expect(mobileTransportCapability([
      { kind: 'direct', url: 'http://192.168.1.5:2606' },
      { kind: 'relay', relay: testRelay },
    ])).toBe('lan+relay');
    expect(mobileTransportCapability(
      [{ kind: 'direct', url: 'http://192.168.1.5:2606' }, { kind: 'relay', relay: testRelay }],
      'relay',
    )).toBe('relay');
  });
});

describe('pairingCandidatesToMobile', () => {
  const relayCandidate = {
    type: 'relay' as const,
    priority: 10,
    relayUrl: testRelay.relayUrl,
    serverId: testRelay.serverId,
    hostEncPubJwk: testRelay.hostEncPubJwk,
  };

  test('orders by priority with https before http before relay on ties', () => {
    const ordered = pairingCandidatesToMobile([
      { type: 'lan', url: 'http://192.168.1.5:2606', priority: 10 },
      relayCandidate,
      { type: 'tunnel', url: 'https://tunnel.example', priority: 10 },
    ]);
    expect(ordered.map((c) => c.kind === 'relay' ? 'relay' : c.url)).toEqual([
      'https://tunnel.example',
      'http://192.168.1.5:2606',
      'relay',
    ]);
  });

  test('on Capacitor, drops loopback when LAN/relay exist', () => {
    const previous = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        Capacitor: { isNativePlatform: () => true },
        location: { protocol: 'https:' },
        localStorage: createLocalStorageStub(),
      },
    });
    try {
      // Loopback has the best numeric priority but must not be tried at all
      // when a real LAN/relay candidate exists (false local /health).
      const ordered = pairingCandidatesToMobile([
        { type: 'lan', url: 'http://127.0.0.1:2606', priority: 1 },
        { type: 'lan', url: 'http://192.168.1.5:2606', priority: 20 },
        relayCandidate,
      ]);
      expect(ordered.map((c) => c.kind === 'relay' ? 'relay' : c.url)).toEqual([
        'relay',
        'http://192.168.1.5:2606',
      ]);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous });
    }
  });
});

describe('validateMobileConnectionSession', () => {
  test('accepts a reachable authenticated runtime', async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return Response.json({ ok: true });
      if (url.endsWith('/auth/session')) return Response.json({ authenticated: true, scope: 'client' });
      return new Response(null, { status: 404 });
    });
    try {
      installTestWindow();
      globalThis.fetch = fetchMock as typeof fetch;

      const result = await validateMobileConnectionSession({ url: 'https://runtime.example', clientToken: 'token' });
      expect(result).toBe(true);
    } finally {
      restoreGlobals();
    }
  });

  test('rejects unreachable runtimes', async () => {
    try {
      installTestWindow();
      globalThis.fetch = mock(async () => new Response(null, { status: 503 })) as typeof fetch;

      const result = await validateMobileConnectionSession({ url: 'https://runtime.example', clientToken: 'token' });
      expect(result).toBe(false);
    } finally {
      restoreGlobals();
    }
  });

  test('rejects invalid or unauthenticated sessions', async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return Response.json({ ok: true });
      return Response.json({ authenticated: false }, { status: 401 });
    });
    try {
      installTestWindow();
      globalThis.fetch = fetchMock as typeof fetch;

      const result = await validateMobileConnectionSession({ url: 'https://runtime.example', clientToken: 'expired' });
      expect(result).toBe(false);
    } finally {
      restoreGlobals();
    }
  });
});

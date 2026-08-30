import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDesktopDevTunnelAuthority } from './dev-tunnel-authority.mjs';

const ready = { phase: 'ready', localUrl: 'http://127.0.0.1:55123' };
const hosts = [{
  id: 'dev3',
  url: 'http://127.0.0.1:55123/',
  apiUrl: 'http://127.0.0.1:55123/',
  clientToken: 'paired-token',
}];

test('resolves only a ready same-origin SSH authority with a paired token', () => {
  assert.deepEqual(resolveDesktopDevTunnelAuthority({ serverId: 'dev3', status: ready, hosts }), {
    id: 'dev3',
    baseUrl: 'http://127.0.0.1:55123/',
    clientToken: 'paired-token',
  });
});

test('rejects local and disconnected authorities', () => {
  assert.throws(() => resolveDesktopDevTunnelAuthority({ serverId: 'default', status: ready, hosts }));
  assert.throws(() => resolveDesktopDevTunnelAuthority({
    serverId: 'dev3',
    status: { phase: 'error', localUrl: null },
    hosts,
  }));
});

test('rejects stale host ownership and missing paired tokens', () => {
  assert.throws(() => resolveDesktopDevTunnelAuthority({
    serverId: 'dev3',
    status: ready,
    hosts: [{ ...hosts[0], apiUrl: 'http://127.0.0.1:60000/' }],
  }));
  assert.throws(() => resolveDesktopDevTunnelAuthority({
    serverId: 'dev3',
    status: ready,
    hosts: [{ ...hosts[0], clientToken: '' }],
  }));
});

import { describe, expect, it } from 'vitest';

import { createTunnelAuth } from './tunnel-auth.js';

const createRequest = (host, remoteAddress) => ({
  headers: { host },
  hostname: host,
  socket: { remoteAddress },
});

describe('tunnel request scope', () => {
  it('requires both a local host and a private socket address', () => {
    const auth = createTunnelAuth();
    auth.setActiveTunnel({
      tunnelId: 'tunnel-1',
      publicUrl: 'https://relay.example.com',
    });

    expect(auth.classifyRequestScope(createRequest('localhost', '127.0.0.1'))).toBe('local');
    expect(auth.classifyRequestScope(createRequest('192.168.1.20', '192.168.1.30'))).toBe('local');
    expect(auth.classifyRequestScope(createRequest('localhost', '203.0.113.10'))).toBe('unknown-public');
    expect(auth.classifyRequestScope(createRequest('host.docker.internal', '203.0.113.10'))).toBe('unknown-public');
  });

  it('still recognizes the configured public tunnel host', () => {
    const auth = createTunnelAuth();
    auth.setActiveTunnel({
      tunnelId: 'tunnel-1',
      publicUrl: 'https://relay.example.com',
    });

    expect(auth.classifyRequestScope(createRequest('relay.example.com', '203.0.113.10'))).toBe('tunnel');
  });
});

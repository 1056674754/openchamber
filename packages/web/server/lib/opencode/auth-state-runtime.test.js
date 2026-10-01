import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';

import { createOpenCodeAuthStateRuntime } from './auth-state-runtime.js';

const createRuntime = (env) => createOpenCodeAuthStateRuntime({
  crypto,
  process: { env },
  getAuthPassword: () => null,
  setAuthPassword: () => {},
  getAuthSource: () => null,
  setAuthSource: () => {},
  getUserProvidedPassword: () => null,
  syncToHmrState: () => {},
});

const basicAuth = (username, password) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

describe('OpenCode auth state runtime', () => {
  test('uses OPENCODE_SERVER_USERNAME when building auth headers', () => {
    const runtime = createRuntime({
      OPENCODE_SERVER_USERNAME: 'custom-user',
      OPENCODE_SERVER_PASSWORD: 'secret',
    });

    expect(runtime.getOpenCodeAuthHeaders()).toEqual({
      Authorization: basicAuth('custom-user', 'secret'),
    });
  });

  test('falls back to the default username when OPENCODE_SERVER_USERNAME is blank', () => {
    const runtime = createRuntime({
      OPENCODE_SERVER_USERNAME: '   ',
      OPENCODE_SERVER_PASSWORD: 'secret',
    });

    expect(runtime.getOpenCodeAuthHeaders()).toEqual({
      Authorization: basicAuth('opencode', 'secret'),
    });
  });

  test('pins the opencode username on the v2 track, ignoring OPENCODE_SERVER_USERNAME', () => {
    // Upstream 8dd842a3b, mode-gated (spine OC2-S2): OpenCode 2 only accepts
    // `opencode`; the configurable username keeps working on v1 (above).
    const runtime = createRuntime({
      OPENCODE_SERVER_USERNAME: 'custom-user',
      OPENCODE_SERVER_PASSWORD: 'secret',
      OPENCHAMBER_PROTOCOL_MODE: 'v2',
    });

    expect(runtime.getOpenCodeAuthHeaders()).toEqual({
      Authorization: basicAuth('opencode', 'secret'),
    });
  });

  test('ignores an invalid protocol-mode override and keeps the v1 username behavior', () => {
    const runtime = createRuntime({
      OPENCODE_SERVER_USERNAME: 'custom-user',
      OPENCODE_SERVER_PASSWORD: 'secret',
      OPENCHAMBER_PROTOCOL_MODE: 'v3',
    });

    expect(runtime.getOpenCodeAuthHeaders()).toEqual({
      Authorization: basicAuth('custom-user', 'secret'),
    });
  });
});

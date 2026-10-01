import { afterEach, describe, expect, it } from 'vitest';

import { createHmrStateRuntime } from './hmr-state-runtime.js';
import { resetProtocolModes } from './protocol-mode.js';

const originalProtocolMode = process.env.OPENCHAMBER_PROTOCOL_MODE;
const originalServerPassword = process.env.OPENCODE_SERVER_PASSWORD;
const originalPassword = process.env.OPENCODE_PASSWORD;

const createState = () => {
  const globalThisLike = {};
  const runtime = createHmrStateRuntime({
    globalThisLike,
    os: { homedir: () => '/home/test' },
    processLike: { env: process.env },
    stateKey: 'openchamberHmrState',
  });
  return { runtime, hmrState: runtime.getOrCreateHmrState() };
};

afterEach(() => {
  resetProtocolModes();
  const restore = (key, value) => {
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  };
  restore('OPENCHAMBER_PROTOCOL_MODE', originalProtocolMode);
  restore('OPENCODE_SERVER_PASSWORD', originalServerPassword);
  restore('OPENCODE_PASSWORD', originalPassword);
});

describe('hmr state runtime password precedence', () => {
  it('reads only OPENCODE_SERVER_PASSWORD on the v1 default track', () => {
    delete process.env.OPENCHAMBER_PROTOCOL_MODE;
    resetProtocolModes();
    process.env.OPENCODE_SERVER_PASSWORD = 'legacy-secret';
    process.env.OPENCODE_PASSWORD = 'v2-secret';

    const { runtime, hmrState } = createState();
    runtime.ensureUserProvidedOpenCodePassword(hmrState);

    expect(hmrState.userProvidedOpenCodePassword).toBe('legacy-secret');
  });

  it('prefers OPENCODE_PASSWORD over the legacy name on the v2 track', () => {
    process.env.OPENCHAMBER_PROTOCOL_MODE = 'v2';
    resetProtocolModes();
    process.env.OPENCODE_SERVER_PASSWORD = 'legacy-secret';
    process.env.OPENCODE_PASSWORD = 'v2-secret';

    const { runtime, hmrState } = createState();
    runtime.ensureUserProvidedOpenCodePassword(hmrState);

    expect(hmrState.userProvidedOpenCodePassword).toBe('v2-secret');
  });

  it('falls back to the legacy variable when OPENCODE_PASSWORD is blank on the v2 track', () => {
    process.env.OPENCHAMBER_PROTOCOL_MODE = 'v2';
    resetProtocolModes();
    process.env.OPENCODE_SERVER_PASSWORD = 'legacy-secret';
    process.env.OPENCODE_PASSWORD = '   ';

    const { runtime, hmrState } = createState();
    runtime.ensureUserProvidedOpenCodePassword(hmrState);

    expect(hmrState.userProvidedOpenCodePassword).toBe('legacy-secret');
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  resolveDefaultHostBootStatus,
  shouldRetryDefaultHostProbe,
  shouldUseLocalSubstrateForDefaultHost,
} from './relay-default-boot.mjs';

describe('relay-paired default host boot', () => {
  test('uses the local UI substrate while the renderer restores relay transport', () => {
    assert.equal(shouldRetryDefaultHostProbe('unreachable', true), false);
    assert.equal(shouldUseLocalSubstrateForDefaultHost('unreachable', true), true);
    assert.equal(resolveDefaultHostBootStatus('unreachable', true), 'ok');
    assert.equal(resolveDefaultHostBootStatus('wrong-service', true), 'ok');
  });

  test('preserves direct-only recovery behavior', () => {
    assert.equal(shouldRetryDefaultHostProbe('unreachable', false), true);
    assert.equal(shouldUseLocalSubstrateForDefaultHost('unreachable', false), false);
    assert.equal(resolveDefaultHostBootStatus('unreachable', false), 'unreachable');
    assert.equal(resolveDefaultHostBootStatus('wrong-service', false), 'wrong-service');
    assert.equal(resolveDefaultHostBootStatus('auth', false), 'ok');
  });
});

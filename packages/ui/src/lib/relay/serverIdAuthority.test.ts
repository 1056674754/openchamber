import { describe, expect, test } from 'bun:test';

import {
  describePairingTransport,
  isReservedLocalServerId,
  resolvePairingServerId,
} from './serverIdAuthority';

describe('serverIdAuthority', () => {
  test('reserves default and local', () => {
    expect(isReservedLocalServerId('default')).toBe(true);
    expect(isReservedLocalServerId('local')).toBe(true);
    expect(isReservedLocalServerId('abc')).toBe(false);
  });

  test('resolvePairingServerId never returns reserved ids for remote hosts', () => {
    expect(resolvePairingServerId({ preferredServerId: 'default', relayServerId: 'srv_abc' })).toBe('srv_abc');
    expect(resolvePairingServerId({ preferredServerId: 'remote-1' })).toBe('remote-1');
    const generated = resolvePairingServerId({ fallbackPrefix: 'paired' });
    expect(generated.startsWith('paired-')).toBe(true);
    expect(isReservedLocalServerId(generated)).toBe(false);
  });

  test('describePairingTransport summarizes candidates', () => {
    expect(describePairingTransport([{ type: 'lan' }, { type: 'relay' }]).label).toBe('LAN+Relay');
    expect(describePairingTransport([{ type: 'relay' }], 'relay').kind).toBe('relay');
  });
});

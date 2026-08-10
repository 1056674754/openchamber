import { describe, expect, test } from 'bun:test';

import {
  dispatchOpenchamberEventEnvelope,
  subscribeOpenchamberEventEnvelopes,
  type OpenChamberEventEnvelope,
} from './openchamberEvents';

describe('OpenChamber event envelopes', () => {
  test('routes an envelope with the producing server ID', () => {
    const received: OpenChamberEventEnvelope[] = [];
    const unsubscribe = subscribeOpenchamberEventEnvelopes((event) => received.push(event));

    dispatchOpenchamberEventEnvelope({
      type: 'openchamber:pending-config-restart',
      properties: { count: 1 },
    }, 'remote-1');
    unsubscribe();

    expect(received).toEqual([{
      type: 'openchamber:pending-config-restart',
      properties: { count: 1 },
      serverId: 'remote-1',
    }]);
  });
});

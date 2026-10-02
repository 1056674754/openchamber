import { describe, expect, test } from 'bun:test';

import {
  dispatchOpenchamberEventEnvelope,
  subscribeOpenchamberEventEnvelopes,
  subscribeOpenchamberEvents,
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

describe('agent file-open requests', () => {
  test('dispatches an agent file-open request and drops one without a path', () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeOpenchamberEvents((event) => events.push(event));

    dispatchOpenchamberEventEnvelope({
      type: 'openchamber:file-open-request',
      properties: { path: '/repo/out/report.csv', directory: '/repo', sessionId: null },
    });
    dispatchOpenchamberEventEnvelope({
      type: 'openchamber:file-open-request',
      properties: { directory: '/repo', sessionId: 'ses_1' },
    });
    unsubscribe();

    expect(events).toEqual([
      { type: 'file-open-request', path: '/repo/out/report.csv', directory: '/repo', sessionId: null },
    ]);
  });
});

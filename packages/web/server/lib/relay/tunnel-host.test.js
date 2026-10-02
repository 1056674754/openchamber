import { describe, expect, test } from 'bun:test';
import { isAllowedRelayWebSocketPath } from './tunnel-host.js';

describe('relay host WebSocket allowlist', () => {
  test('allows an extension surface socket by path shape only', () => {
    expect(isAllowedRelayWebSocketPath('/api/guests/server-chrome/surface/ws')).toBe(true);
    expect(isAllowedRelayWebSocketPath('/api/guests/Server/surface/ws')).toBe(false);
    expect(isAllowedRelayWebSocketPath('/api/guests/server-chrome/surface/ws/x')).toBe(false);
    expect(isAllowedRelayWebSocketPath('/api/guests/server-chrome/service/request')).toBe(false);
  });
});

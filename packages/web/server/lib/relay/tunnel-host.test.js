import { describe, expect, test } from 'bun:test';
import { isAllowedRelayWebSocketPath } from './tunnel-host.js';

describe('relay host WebSocket allowlist', () => {
  test('allows an extension surface socket by path shape only', () => {
    expect(isAllowedRelayWebSocketPath('/api/guests/server-chrome/surface/ws')).toBe(true);
    expect(isAllowedRelayWebSocketPath('/api/guests/Server/surface/ws')).toBe(false);
    expect(isAllowedRelayWebSocketPath('/api/guests/server-chrome/surface/ws/x')).toBe(false);
    expect(isAllowedRelayWebSocketPath('/api/guests/server-chrome/service/request')).toBe(false);
  });

  test('allows the sockets of an isolated space by path shape only', () => {
    for (const socket of ['terminal/ws', 'dev-tunnel', 'event/ws', 'global/event/ws']) {
      expect(isAllowedRelayWebSocketPath(`/api/spaces/a1b2c3d4e5f6/${socket}`)).toBe(true);
    }
    expect(isAllowedRelayWebSocketPath('/api/spaces/a1b2c3d4e5f6/dictation/ws')).toBe(false);
    expect(isAllowedRelayWebSocketPath('/api/spaces/A1B2C3D4E5F6/terminal/ws')).toBe(false);
    expect(isAllowedRelayWebSocketPath('/api/spaces/a1b2c3d4e5f/terminal/ws')).toBe(false);
    expect(isAllowedRelayWebSocketPath('/api/spaces/a1b2c3d4e5f6/terminal/ws/x')).toBe(false);
    expect(isAllowedRelayWebSocketPath('/api/spaces//terminal/ws')).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';

const { handlePermissionAutoAcceptBridgeMessage } = await import('./bridge-permission-auto-accept-runtime.ts');

const createContext = (initialValue) => {
  const values = new Map();
  if (initialValue !== undefined) {
    values.set('permissionAutoAccept', initialValue);
  }
  return {
    globalState: {
      get: (key) => values.get(key),
      update: async (key, value) => {
        values.set(key, value);
      },
    },
  };
};

describe('VS Code permission auto-accept policy bridge', () => {
  test('persists a session policy and broadcasts the authoritative snapshot', async () => {
    const context = createContext();
    const broadcasts = [];

    const response = await handlePermissionAutoAcceptBridgeMessage({
      id: 'set-root',
      type: 'api:permission-auto-accept:set',
      payload: { sessionId: 'root', enabled: true },
    }, context, {
      broadcast: async (snapshot) => {
        broadcasts.push(snapshot);
      },
    });

    expect(response).toEqual({
      id: 'set-root',
      type: 'api:permission-auto-accept:set',
      success: true,
      data: { sessions: { root: true } },
    });
    expect(broadcasts).toEqual([{ sessions: { root: true } }]);

    const reloaded = await handlePermissionAutoAcceptBridgeMessage({
      id: 'get-root',
      type: 'api:permission-auto-accept:get',
    }, context);

    expect(reloaded?.data).toEqual({ sessions: { root: true } });
  });

  test('normalizes malformed persisted entries without changing valid policies', async () => {
    const context = createContext({
      sessions: { root: true, child: false, invalid: 'yes' },
      ignored: true,
    });

    const response = await handlePermissionAutoAcceptBridgeMessage({
      id: 'get-normalized',
      type: 'api:permission-auto-accept:get',
    }, context);

    expect(response?.data).toEqual({ sessions: { root: true, child: false } });
  });

  test('rejects malformed policy writes without broadcasting', async () => {
    const broadcasts = [];

    const response = await handlePermissionAutoAcceptBridgeMessage({
      id: 'set-invalid',
      type: 'api:permission-auto-accept:set',
      payload: { sessionId: 'root', enabled: 'yes' },
    }, createContext(), {
      broadcast: async (snapshot) => {
        broadcasts.push(snapshot);
      },
    });

    expect(response?.success).toBe(false);
    expect(broadcasts).toEqual([]);
  });
});

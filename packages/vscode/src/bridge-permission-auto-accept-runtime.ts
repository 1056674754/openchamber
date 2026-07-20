const STORAGE_KEY = 'permissionAutoAccept';

type PolicyContext = {
  readonly globalState: {
    readonly get: (key: string) => unknown;
    readonly update: (key: string, value: unknown) => PromiseLike<void>;
  };
};

export type PermissionAutoAcceptSnapshot = {
  readonly sessions: Readonly<Record<string, boolean>>;
};

type PermissionAutoAcceptDependencies = {
  readonly broadcast: (snapshot: PermissionAutoAcceptSnapshot) => PromiseLike<unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const normalizeSnapshot = (value: unknown): PermissionAutoAcceptSnapshot => {
  const snapshot = isRecord(value) ? value : {};
  const entries = isRecord(snapshot.sessions) ? Object.entries(snapshot.sessions) : [];
  const sessions: Record<string, boolean> = {};

  for (const [sessionId, enabled] of entries) {
    if (sessionId && typeof enabled === 'boolean') {
      sessions[sessionId] = enabled;
    }
  }

  return { sessions };
};

const readPermissionAutoAcceptPolicy = (context: PolicyContext): PermissionAutoAcceptSnapshot => (
  normalizeSnapshot(context.globalState.get(STORAGE_KEY))
);

export async function handlePermissionAutoAcceptBridgeMessage(
  message: { readonly id: string; readonly type: string; readonly payload?: unknown },
  context?: PolicyContext,
  dependencies?: PermissionAutoAcceptDependencies,
) {
  if (message.type !== 'api:permission-auto-accept:get' && message.type !== 'api:permission-auto-accept:set') {
    return null;
  }
  if (!context) {
    return { id: message.id, type: message.type, success: false, error: 'Extension context is unavailable' };
  }

  if (message.type === 'api:permission-auto-accept:get') {
    return {
      id: message.id,
      type: message.type,
      success: true,
      data: readPermissionAutoAcceptPolicy(context),
    };
  }

  const payload = isRecord(message.payload) ? message.payload : {};
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
  if (!sessionId) {
    return { id: message.id, type: message.type, success: false, error: 'sessionId is required' };
  }
  if (typeof payload.enabled !== 'boolean') {
    return { id: message.id, type: message.type, success: false, error: 'enabled must be a boolean' };
  }

  const current = readPermissionAutoAcceptPolicy(context);
  const snapshot: PermissionAutoAcceptSnapshot = {
    sessions: { ...current.sessions, [sessionId]: payload.enabled },
  };
  await context.globalState.update(STORAGE_KEY, snapshot);
  await (dependencies?.broadcast(snapshot) ?? Promise.resolve());

  return { id: message.id, type: message.type, success: true, data: snapshot };
}

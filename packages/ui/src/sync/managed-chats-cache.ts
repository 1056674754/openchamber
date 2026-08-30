import type { Session } from '@opencode-ai/sdk/v2';

import { isChatDirectoryPath } from '@/lib/chatDirectories';
import { isVSCodeRuntime } from '@/lib/desktop';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { getSafeStorage } from '@/stores/utils/safeStorage';

const CACHE_VERSION = 1;
const CACHE_LIMIT = 50;

type CachedSession = Session & { openchamberServerId?: string };
type CachePayload = { version: number; sessions: CachedSession[] };

const hash = (value: string): string => {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result).toString(36);
};

const cacheKey = (runtimeKey = getRuntimeKey()): string => `oc.managedChats.v1.${hash(runtimeKey || 'local')}`;

export const readManagedChatSessions = (expectedRuntimeKey = getRuntimeKey()): Session[] => {
  if (isVSCodeRuntime() || expectedRuntimeKey !== getRuntimeKey()) return [];
  try {
    const raw = getSafeStorage().getItem(cacheKey(expectedRuntimeKey));
    if (!raw) return [];
    const payload = JSON.parse(raw) as Partial<CachePayload> | null;
    if (payload?.version !== CACHE_VERSION || !Array.isArray(payload.sessions)) return [];
    return payload.sessions.filter((session) => (
      Boolean(session?.id) && isChatDirectoryPath(session.directory)
    )).slice(0, CACHE_LIMIT).map((session) => {
      if (session.openchamberServerId) {
        serverRegistry.indexSession(session.id, session.openchamberServerId);
      }
      return session;
    });
  } catch {
    return [];
  }
};

export const persistManagedChatSessions = (sessions: Session[]): void => {
  if (isVSCodeRuntime()) return;
  const managed: CachedSession[] = sessions
    .filter((session) => isChatDirectoryPath(session.directory))
    .slice(0, CACHE_LIMIT)
    .map((session) => ({
      ...session,
      openchamberServerId: serverRegistry.getServerForSession(session.id),
    }));
  try {
    getSafeStorage().setItem(cacheKey(), JSON.stringify({ version: CACHE_VERSION, sessions: managed }));
  } catch {
    // Last-known-good cache is optional; server state remains authoritative.
  }
};

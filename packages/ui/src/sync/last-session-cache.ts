import { getDeferredSafeStorage } from '@/stores/utils/safeStorage';

const STORAGE_KEY = 'oc.lastSession.v1';
const MAX_RUNTIME_ENTRIES = 8;

export type PersistedLastSession = {
  readonly sessionId: string;
  readonly serverId: string;
  readonly directory: string | null;
};

type PersistedEntry = PersistedLastSession & {
  readonly updatedAt: number;
};

type PersistedEnvelope = {
  readonly version: 1;
  readonly runtimes: Record<string, PersistedEntry>;
};

const emptyEnvelope = (): PersistedEnvelope => ({ version: 1, runtimes: {} });

const readEnvelope = (storage: Storage): PersistedEnvelope => {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyEnvelope();

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyEnvelope();

    const candidate = parsed as Partial<PersistedEnvelope>;
    if (candidate.version !== 1 || !candidate.runtimes || typeof candidate.runtimes !== 'object') {
      return emptyEnvelope();
    }

    const runtimes: Record<string, PersistedEntry> = {};
    for (const [runtimeKey, entry] of Object.entries(candidate.runtimes)) {
      if (
        !runtimeKey
        || !entry
        || typeof entry.sessionId !== 'string'
        || entry.sessionId.length === 0
        || typeof entry.serverId !== 'string'
        || entry.serverId.length === 0
      ) {
        continue;
      }

      runtimes[runtimeKey] = {
        sessionId: entry.sessionId,
        serverId: entry.serverId,
        directory: typeof entry.directory === 'string' && entry.directory.length > 0
          ? entry.directory
          : null,
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
      };
    }

    return { version: 1, runtimes };
  } catch {
    return emptyEnvelope();
  }
};

const writeEnvelope = (storage: Storage, envelope: PersistedEnvelope): void => {
  const retained = Object.entries(envelope.runtimes)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RUNTIME_ENTRIES);

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      runtimes: Object.fromEntries(retained),
    } satisfies PersistedEnvelope));
  } catch {
    return;
  }
};

export const persistLastActiveSession = (
  runtimeKey: string,
  entry: PersistedLastSession,
  storage: Storage = getDeferredSafeStorage(),
): void => {
  if (!runtimeKey || !entry.sessionId || !entry.serverId) return;

  const envelope = readEnvelope(storage);
  const maxExisting = Object.values(envelope.runtimes).reduce(
    (max, existing) => Math.max(max, existing.updatedAt),
    0,
  );

  envelope.runtimes[runtimeKey] = {
    ...entry,
    updatedAt: Math.max(Date.now(), maxExisting + 1),
  };
  writeEnvelope(storage, envelope);
};

export const readLastActiveSession = (
  runtimeKey: string,
  storage: Storage = getDeferredSafeStorage(),
): PersistedLastSession | null => {
  if (!runtimeKey) return null;
  const entry = readEnvelope(storage).runtimes[runtimeKey];
  if (!entry) return null;
  return {
    sessionId: entry.sessionId,
    serverId: entry.serverId,
    directory: entry.directory,
  };
};

export const clearLastActiveSession = (
  runtimeKey: string,
  storage: Storage = getDeferredSafeStorage(),
): void => {
  if (!runtimeKey) return;

  const envelope = readEnvelope(storage);
  if (!envelope.runtimes[runtimeKey]) return;
  delete envelope.runtimes[runtimeKey];
  writeEnvelope(storage, envelope);
};

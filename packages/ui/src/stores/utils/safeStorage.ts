import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';

// Persistent safe storage.
//
// Backed by an in-memory Map whose source of truth is the host settings file
// (~/.config/openchamber/settings.json) via DesktopSettings.localStore. The
// host file survives origin/port changes — critical for Desktop, which picks
// a fresh loopback port on each launch when the previous one is occupied
// and would otherwise scope `localStorage` to a different origin, losing
// every preference stored here (display mode, locale, sidebar state, ...).
//
// `hydrateLocalStore(record)` is called from `applySettingsAndDispatch`
// with the host's `localStore` field whenever host settings arrive; it
// replaces the in-memory map and notifies subscribers registered via
// `registerSafeStorageRehydrate` so zustand-persist stores that initialized
// with defaults before hydration can re-read.
//
// Writes update the in-memory map synchronously and queue per-key mutations.
// Mutations wait for the initial host snapshot, then flush as patches so one
// renderer cannot replace unrelated preferences written by another client.

const memoryStore = new Map<string, string>();
const rehydrateSubscribers = new Set<() => void>();

type PendingMutation = {
    readonly value: string | null;
    readonly revision: number;
};

const pendingMutations = new Map<string, PendingMutation>();

let flushScheduled = false;
let flushInFlight: Promise<void> | null = null;
let runFlush: (() => void) | null = null;
let hydrationComplete = false;
let nextMutationRevision = 0;

const triggerRehydrateSubscribers = (): void => {
    for (const fn of rehydrateSubscribers) {
        try {
            fn();
        } catch (error) {
            console.error('safeStorage rehydrate subscriber failed', error);
        }
    }
};

const flushToHostSettings = async (): Promise<void> => {
    if (typeof window === 'undefined' || !hydrationComplete || pendingMutations.size === 0) return;

    const batch = new Map(pendingMutations);
    const set: Record<string, string> = {};
    const remove: string[] = [];
    for (const [key, mutation] of batch) {
        if (mutation.value === null) {
            remove.push(key);
        } else {
            set[key] = mutation.value;
        }
    }

    try {
        const { flushPendingSettingsUpdates, updateDesktopSettings } = await import('@/lib/persistence');
        await updateDesktopSettings({
            localStorePatch: {
                ...(Object.keys(set).length > 0 ? { set } : {}),
                ...(remove.length > 0 ? { remove } : {}),
            },
        });
        const flushed = await flushPendingSettingsUpdates();
        if (!flushed) return;

        for (const [key, mutation] of batch) {
            if (pendingMutations.get(key)?.revision === mutation.revision) {
                pendingMutations.delete(key);
            }
        }
    } catch (error) {
        console.error('safeStorage host flush failed', error);
    }
};

const scheduleFlush = (): void => {
    if (
        typeof window === 'undefined'
        || !hydrationComplete
        || pendingMutations.size === 0
        || flushScheduled
        || flushInFlight
    ) return;

    flushScheduled = true;
    let hasRun = false;
    const run = (): void => {
        if (hasRun) return;
        hasRun = true;
        flushScheduled = false;
        if (runFlush === run) runFlush = null;
        const startRevision = nextMutationRevision;
        const promise = flushToHostSettings().finally(() => {
            if (flushInFlight === promise) flushInFlight = null;
            if (nextMutationRevision > startRevision) scheduleFlush();
        });
        flushInFlight = promise;
    };
    runFlush = run;
    setTimeout(run, 0);
};

const deferredFlushers = new Set<() => void>();
let deferredFlushListenersRegistered = false;

const registerDeferredFlusher = (flush: () => void): void => {
    deferredFlushers.add(flush);
    if (deferredFlushListenersRegistered || typeof window === 'undefined') return;

    deferredFlushListenersRegistered = true;
    const flushAll = (): void => {
        for (const flushDeferredStorage of deferredFlushers) {
            flushDeferredStorage();
        }
    };

    try {
        window.addEventListener('pagehide', flushAll, { capture: true });
        window.addEventListener('beforeunload', flushAll, { capture: true });
        window.addEventListener('visibilitychange', () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                flushAll();
            }
        });
        window.addEventListener('freeze', flushAll);
    } catch {
        return;
    }
};

const createPersistentStorage = (): Storage => {
    return {
        getItem: (key: string): string | null => memoryStore.get(key) ?? null,
        setItem: (key: string, value: string): void => {
            const nextValue = String(value);
            if (memoryStore.get(key) === nextValue) return;
            memoryStore.set(key, nextValue);
            nextMutationRevision += 1;
            pendingMutations.set(key, { value: nextValue, revision: nextMutationRevision });
            scheduleFlush();
        },
        removeItem: (key: string): void => {
            if (!memoryStore.has(key)) return;
            memoryStore.delete(key);
            nextMutationRevision += 1;
            pendingMutations.set(key, { value: null, revision: nextMutationRevision });
            scheduleFlush();
        },
        clear: (): void => {
            if (memoryStore.size === 0) return;
            for (const key of memoryStore.keys()) {
                nextMutationRevision += 1;
                pendingMutations.set(key, { value: null, revision: nextMutationRevision });
            }
            memoryStore.clear();
            scheduleFlush();
        },
        key: (index: number): string | null => Array.from(memoryStore.keys())[index] ?? null,
        get length(): number {
            return memoryStore.size;
        },
    } as Storage;
};

let safeStorageInstance: Storage | null = null;
let safeSessionStorageInstance: Storage | null = null;
let deferredSafeStorageInstance: Storage | null = null;

export const getSafeStorage = (): Storage => {
    if (!safeStorageInstance) {
        safeStorageInstance = createPersistentStorage();
    }
    return safeStorageInstance;
};

export const getDeferredSafeStorage = (): Storage => {
    if (!deferredSafeStorageInstance) {
        deferredSafeStorageInstance = createDeferredStorage(getSafeStorage());
    }
    return deferredSafeStorageInstance;
};

/**
 * Replace the in-memory map with the host-file snapshot and notify
 * registered subscribers (typically zustand-persist stores) to rehydrate.
 * Called from `applySettingsAndDispatch` whenever host settings arrive.
 */
export const hydrateLocalStore = (record: Record<string, string> | undefined): void => {
    const nextStore = new Map<string, string>();
    if (record && typeof record === 'object') {
        for (const [key, value] of Object.entries(record)) {
            if (typeof key === 'string' && key.length > 0 && typeof value === 'string') {
                nextStore.set(key, value);
            }
        }
    }

    if (!hydrationComplete) {
        for (const [key, mutation] of pendingMutations) {
            if (nextStore.has(key) || mutation.value === null) {
                pendingMutations.delete(key);
                continue;
            }
            nextStore.set(key, mutation.value);
        }
        hydrationComplete = true;
    } else {
        for (const [key, mutation] of pendingMutations) {
            if (mutation.value === null) {
                nextStore.delete(key);
            } else {
                nextStore.set(key, mutation.value);
            }
        }
    }

    memoryStore.clear();
    for (const [key, value] of nextStore) {
        memoryStore.set(key, value);
    }
    triggerRehydrateSubscribers();
    scheduleFlush();
};

/**
 * Register a callback fired after `hydrateLocalStore` replaces the
 * in-memory state. Persist-backed stores use this to re-read storage and
 * pick up host-file values that arrived after the store initialized.
 */
export const registerSafeStorageRehydrate = (fn: () => void): (() => void) => {
    rehydrateSubscribers.add(fn);
    return () => {
        rehydrateSubscribers.delete(fn);
    };
};

/** Force any scheduled flush to start now and await any in-flight flush. */
export const flushSafeStorage = async (): Promise<void> => {
    for (const flushDeferredStorage of deferredFlushers) {
        flushDeferredStorage();
    }
    scheduleFlush();

    while (runFlush || flushInFlight) {
        const scheduledFlush = runFlush;
        if (scheduledFlush) scheduledFlush();
        const activeFlush = flushInFlight;
        if (activeFlush) await activeFlush;
    }
};

// ---------------------------------------------------------------------------
// zustand-persist JSON storage adapter
// ---------------------------------------------------------------------------

type JsonStorageOptions = {
    reviver?: (key: string, value: unknown) => unknown;
    replacer?: (key: string, value: unknown) => unknown;
};

const createDeferredJSONStorage = <S>(
    getStorage: () => StateStorage,
    options?: JsonStorageOptions,
): PersistStorage<S> | undefined => {
    let storage: StateStorage;
    try {
        storage = getStorage();
    } catch {
        return undefined;
    }

    const pendingWrites = new Map<string, StorageValue<S>>();
    const pendingDeletes = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const flush = (): void => {
        flushTimer = undefined;
        if (pendingWrites.size === 0 && pendingDeletes.size === 0) return;

        const writes = Array.from(pendingWrites.entries());
        const deletes = Array.from(pendingDeletes);
        pendingWrites.clear();
        pendingDeletes.clear();

        for (const [name, value] of writes) {
            try {
                storage.setItem(name, JSON.stringify(value, options?.replacer));
            } catch (error) {
                console.error('Failed to persist deferred storage value', error);
            }
        }
        for (const name of deletes) {
            try {
                storage.removeItem(name);
            } catch (error) {
                console.error('Failed to remove deferred storage value', error);
            }
        }
    };

    const scheduleFlush = (): void => {
        if (flushTimer !== undefined) return;
        flushTimer = setTimeout(flush, 0);
    };

    registerDeferredFlusher(flush);

    return {
        getItem: (name) => {
            if (pendingWrites.has(name)) return pendingWrites.get(name) ?? null;
            if (pendingDeletes.has(name)) return null;

            const parse = (value: string | null): StorageValue<S> | null => {
                if (value === null) return null;
                return JSON.parse(value, options?.reviver) as StorageValue<S>;
            };
            const value = storage.getItem(name);
            return value instanceof Promise ? value.then(parse) : parse(value);
        },
        setItem: (name, value) => {
            pendingWrites.set(name, value);
            pendingDeletes.delete(name);
            scheduleFlush();
        },
        removeItem: (name) => {
            pendingWrites.delete(name);
            pendingDeletes.add(name);
            scheduleFlush();
        },
    };
};

export const createDeferredSafeJSONStorage = <S>(options?: JsonStorageOptions) => (
    createDeferredJSONStorage<S>(() => getSafeStorage(), options)
);

// ---------------------------------------------------------------------------
// Deferred wrapper around a raw Storage (used by getDeferredSafeStorage)
// ---------------------------------------------------------------------------

const createDeferredStorage = (storage: Storage): Storage => {
    const pendingWrites = new Map<string, string>();
    const pendingDeletes = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const flush = (): void => {
        flushTimer = undefined;
        if (pendingWrites.size === 0 && pendingDeletes.size === 0) return;

        const writes = Array.from(pendingWrites.entries());
        const deletes = Array.from(pendingDeletes);
        pendingWrites.clear();
        pendingDeletes.clear();

        for (const [key, value] of writes) {
            try {
                storage.setItem(key, value);
            } catch (error) {
                console.error('Failed to persist deferred storage value', error);
            }
        }
        for (const key of deletes) {
            try {
                storage.removeItem(key);
            } catch (error) {
                console.error('Failed to remove deferred storage value', error);
            }
        }
    };

    const scheduleFlush = (): void => {
        if (flushTimer !== undefined) return;
        flushTimer = setTimeout(flush, 0);
    };

    registerDeferredFlusher(flush);

    return {
        getItem: (key) => {
            if (pendingWrites.has(key)) return pendingWrites.get(key) ?? null;
            if (pendingDeletes.has(key)) return null;
            return storage.getItem(key);
        },
        setItem: (key, value) => {
            pendingWrites.set(key, value);
            pendingDeletes.delete(key);
            scheduleFlush();
        },
        removeItem: (key) => {
            pendingWrites.delete(key);
            pendingDeletes.add(key);
            scheduleFlush();
        },
        clear: () => {
            pendingWrites.clear();
            pendingDeletes.clear();
            if (flushTimer !== undefined) {
                clearTimeout(flushTimer);
                flushTimer = undefined;
            }
            storage.clear();
        },
        key: (index) => storage.key(index),
        get length() {
            return storage.length;
        },
    } as Storage;
};

// ---------------------------------------------------------------------------
// Session storage — ephemeral, per-tab; window.sessionStorage stays correct
// ---------------------------------------------------------------------------

const getWindowStorage = (key: 'localStorage' | 'sessionStorage'): Storage | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        return window[key] ?? null;
    } catch {
        return null;
    }
};

const createInMemoryStorage = (): Storage => {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => {
            store.clear();
        },
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
            return store.size;
        },
    } as Storage;
};

const wrapSafeStorage = (baseStorage: Storage): Storage => {
    const fallback = createInMemoryStorage();

    const safeGet = (key: string): string | null => {
        const fallbackValue = fallback.getItem(key);
        if (fallbackValue !== null) return fallbackValue;
        try {
            return baseStorage.getItem(key);
        } catch {
            return null;
        }
    };

    const safeSet = (key: string, value: string) => {
        try {
            baseStorage.setItem(key, value);
            fallback.removeItem(key);
            return;
        } catch {
            // Preserve existing baseStorage value; keep new value in fallback only.
        }
        fallback.setItem(key, value);
    };

    const safeRemove = (key: string) => {
        try {
            baseStorage.removeItem(key);
        } catch {
            // ignored
        }
        fallback.removeItem(key);
    };

    const safeClear = () => {
        try {
            baseStorage.clear();
        } catch {
            // ignored
        }
        fallback.clear();
    };

    const safeKey = (index: number): string | null => {
        try {
            return baseStorage.key(index);
        } catch {
            return fallback.key(index);
        }
    };

    return {
        getItem: safeGet,
        setItem: safeSet,
        removeItem: safeRemove,
        clear: safeClear,
        key: safeKey,
        get length() {
            try {
                return baseStorage.length + fallback.length;
            } catch {
                return fallback.length;
            }
        },
    } as Storage;
};

const createSafeSessionStorage = (): Storage => {
    const baseStorage = getWindowStorage('sessionStorage');
    if (!baseStorage) return createInMemoryStorage();
    return wrapSafeStorage(baseStorage);
};

export const getSafeSessionStorage = (): Storage => {
    if (!safeSessionStorageInstance) {
        safeSessionStorageInstance = createSafeSessionStorage();
    }
    return safeSessionStorageInstance;
};

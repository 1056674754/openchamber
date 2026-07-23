import { describe, expect, test } from 'bun:test';

const importSafeStorage = async () => {
    return await import(`./safeStorage.ts?test=${Date.now()}-${Math.random()}`) as typeof import('./safeStorage');
};

const createMockBaseStorage = (store: Map<string, string>, shouldThrowOnSet = false): Storage => ({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
        if (shouldThrowOnSet) throw new Error('QuotaExceededError');
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
} as Storage);

describe('safeStorage', () => {
    test('falls back to memory when storage getters throw', async () => {
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        const throwingWindow = {};

        Object.defineProperties(throwingWindow, {
            localStorage: {
                get() {
                    throw new Error('localStorage blocked');
                },
            },
            sessionStorage: {
                get() {
                    throw new Error('sessionStorage blocked');
                },
            },
        });

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: throwingWindow,
        });

        try {
            const { getSafeSessionStorage, getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();
            const sessionStorage = getSafeSessionStorage();

            storage.setItem('local-key', 'local-value');
            sessionStorage.setItem('session-key', 'session-value');

            expect(storage.getItem('local-key')).toBe('local-value');
            expect(sessionStorage.getItem('session-key')).toBe('session-value');
        } finally {
            if (previousWindow) {
                Object.defineProperty(globalThis, 'window', previousWindow);
            } else {
                delete (globalThis as { window?: unknown }).window;
            }
        }
    });

    test('write failure preserves existing value in baseStorage', async () => {
        const baseStore = new Map([['key-1', 'old-value']]);
        const mockWindow = {
            localStorage: createMockBaseStorage(baseStore, true),
            sessionStorage: createMockBaseStorage(new Map()),
        };
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });

        try {
            const { getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();

            storage.setItem('key-1', 'new-value');

            expect(baseStore.get('key-1')).toBe('old-value');
            expect(storage.getItem('key-1')).toBe('new-value');
        } finally {
            if (previousWindow) {
                Object.defineProperty(globalThis, 'window', previousWindow);
            } else {
                delete (globalThis as { window?: unknown }).window;
            }
        }
    });

    test('subsequent writes retry baseStorage after a failure', async () => {
        const baseStore = new Map<string, string>();
        let setThrowing = true;
        const baseStorage: Storage = {
            getItem: (key) => baseStore.get(key) ?? null,
            setItem: (key, value) => {
                if (setThrowing) throw new Error('quota');
                baseStore.set(key, value);
            },
            removeItem: (key) => { baseStore.delete(key); },
            clear: () => { baseStore.clear(); },
            key: (i) => Array.from(baseStore.keys())[i] ?? null,
            get length() { return baseStore.size; },
        } as Storage;

        const mockWindow = { localStorage: baseStorage, sessionStorage: createMockBaseStorage(new Map()) };
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });

        try {
            const { getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();

            storage.setItem('k', 'v1');
            expect(baseStore.has('k')).toBe(false);

            setThrowing = false;
            storage.setItem('k', 'v2');
            expect(baseStore.get('k')).toBe('v2');
        } finally {
            if (previousWindow) {
                Object.defineProperty(globalThis, 'window', previousWindow);
            } else {
                delete (globalThis as { window?: unknown }).window;
            }
        }
    });

    test('fallback value takes read priority over stale baseStorage value', async () => {
        const baseStore = new Map([['k', 'stale']]);
        let setThrowing = true;
        const baseStorage: Storage = {
            getItem: (key) => baseStore.get(key) ?? null,
            setItem: (key, value) => {
                if (setThrowing) throw new Error('quota');
                baseStore.set(key, value);
            },
            removeItem: (key) => { baseStore.delete(key); },
            clear: () => { baseStore.clear(); },
            key: (i) => Array.from(baseStore.keys())[i] ?? null,
            get length() { return baseStore.size; },
        } as Storage;

        const mockWindow = { localStorage: baseStorage, sessionStorage: createMockBaseStorage(new Map()) };
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });

        try {
            const { getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();

            expect(storage.getItem('k')).toBe('stale');

            storage.setItem('k', 'fresh');
            expect(storage.getItem('k')).toBe('fresh');

            setThrowing = false;
            storage.setItem('k', 'persisted');
            expect(baseStore.get('k')).toBe('persisted');
            expect(storage.getItem('k')).toBe('persisted');
        } finally {
            if (previousWindow) {
                Object.defineProperty(globalThis, 'window', previousWindow);
            } else {
                delete (globalThis as { window?: unknown }).window;
            }
        }
    });

    test('removeItem clears both baseStorage and fallback', async () => {
        const baseStore = new Map<string, string>([['a', 'base'], ['b', 'base']]);
        const setThrowing = true;
        const baseStorage: Storage = {
            getItem: (key) => baseStore.get(key) ?? null,
            setItem: (key, value) => {
                if (setThrowing) throw new Error('quota');
                baseStore.set(key, value);
            },
            removeItem: (key) => { baseStore.delete(key); },
            clear: () => { baseStore.clear(); },
            key: (i) => Array.from(baseStore.keys())[i] ?? null,
            get length() { return baseStore.size; },
        } as Storage;

        const mockWindow = { localStorage: baseStorage, sessionStorage: createMockBaseStorage(new Map()) };
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });

        try {
            const { getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();

            storage.setItem('c', 'fallback-only');
            storage.removeItem('a');
            storage.removeItem('c');

            expect(baseStore.has('a')).toBe(false);
            expect(storage.getItem('a')).toBeNull();
            expect(storage.getItem('c')).toBeNull();
            expect(baseStore.has('b')).toBe(true);
        } finally {
            if (previousWindow) {
                Object.defineProperty(globalThis, 'window', previousWindow);
            } else {
                delete (globalThis as { window?: unknown }).window;
            }
        }
    });

    test('defers JSON serialization while preserving read-after-write', async () => {
        const baseStore = new Map<string, string>();
        const mockWindow = {
            localStorage: createMockBaseStorage(baseStore),
            sessionStorage: createMockBaseStorage(new Map()),
            addEventListener: () => {},
        };
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        const previousStringify = JSON.stringify;
        const stringifyCalls: unknown[] = [];
        Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });

        try {
            JSON.stringify = ((value: unknown, replacer?: Parameters<typeof JSON.stringify>[1], space?: Parameters<typeof JSON.stringify>[2]) => {
                stringifyCalls.push(value);
                return previousStringify(value, replacer, space);
            }) as typeof JSON.stringify;

            const { createDeferredSafeJSONStorage } = await importSafeStorage();
            const storage = createDeferredSafeJSONStorage<{ value: string }>();
            if (!storage) throw new Error('storage unavailable');

            storage.setItem('key', { state: { value: 'first' } });
            storage.setItem('key', { state: { value: 'latest' } });

            expect(stringifyCalls).toHaveLength(0);
            expect(baseStore.has('key')).toBe(false);
            expect(storage.getItem('key')).toEqual({ state: { value: 'latest' } });

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(stringifyCalls).toEqual([{ state: { value: 'latest' } }]);
            expect(baseStore.get('key')).toBe('{"state":{"value":"latest"}}');
        } finally {
            JSON.stringify = previousStringify;
            if (previousWindow) {
                Object.defineProperty(globalThis, 'window', previousWindow);
            } else {
                delete (globalThis as { window?: unknown }).window;
            }
        }
    });

    test('flushes deferred direct writes on pagehide', async () => {
        const baseStore = new Map<string, string>();
        const listeners = new Map<string, Array<() => void>>();
        const mockWindow = {
            localStorage: createMockBaseStorage(baseStore),
            sessionStorage: createMockBaseStorage(new Map()),
            addEventListener: (event: string, listener: () => void) => {
                listeners.set(event, [...(listeners.get(event) ?? []), listener]);
            },
        };
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });

        try {
            const { getDeferredSafeStorage } = await importSafeStorage();
            const storage = getDeferredSafeStorage();
            storage.setItem('key', 'value');

            expect(baseStore.has('key')).toBe(false);
            expect(storage.getItem('key')).toBe('value');

            for (const listener of listeners.get('pagehide') ?? []) listener();
            expect(baseStore.get('key')).toBe('value');
        } finally {
            if (previousWindow) {
                Object.defineProperty(globalThis, 'window', previousWindow);
            } else {
                delete (globalThis as { window?: unknown }).window;
            }
        }
    });
});

import { describe, expect, test, mock } from 'bun:test';

const importSafeStorage = async (): Promise<typeof import('./safeStorage')> => {
    return await import(`./safeStorage.ts?test=${Date.now()}-${Math.random()}`) as typeof import('./safeStorage');
};

const createMockBaseStorage = (store: Map<string, string>): Storage => ({
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
} as Storage);

const withMockWindow = <T>(
    mockWindow: Partial<Window> & { addEventListener?: typeof window.addEventListener },
    fn: () => Promise<T>,
): Promise<T> => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });
    return fn().finally(() => {
        if (previousWindow) {
            Object.defineProperty(globalThis, 'window', previousWindow);
        } else {
            delete (globalThis as { window?: unknown }).window;
        }
    });
};

describe('safeStorage', () => {
    test('reads return null on a fresh module instance', async () => {
        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();
            expect(storage.getItem('missing')).toBeNull();
            expect(storage.length).toBe(0);
        });
    });

    test('writes are visible synchronously to subsequent reads', async () => {
        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();

            storage.setItem('a', '1');
            storage.setItem('b', '2');
            expect(storage.getItem('a')).toBe('1');
            expect(storage.getItem('b')).toBe('2');
            expect(storage.length).toBe(2);
            const keys = [storage.key(0), storage.key(1)].sort();
            expect(keys).toEqual(['a', 'b']);
            expect(storage.key(2)).toBeNull();
        });
    });

    test('removeItem clears the in-memory entry', async () => {
        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();
            storage.setItem('a', '1');
            storage.setItem('b', '2');

            storage.removeItem('a');

            expect(storage.getItem('a')).toBeNull();
            expect(storage.getItem('b')).toBe('2');
            expect(storage.length).toBe(1);
        });
    });

    test('clear empties the in-memory map', async () => {
        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { getSafeStorage } = await importSafeStorage();
            const storage = getSafeStorage();
            storage.setItem('a', '1');
            storage.setItem('b', '2');

            storage.clear();

            expect(storage.length).toBe(0);
            expect(storage.getItem('a')).toBeNull();
        });
    });

    test('hydrateLocalStore replaces the in-memory state and notifies subscribers', async () => {
        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { getSafeStorage, hydrateLocalStore, registerSafeStorageRehydrate } = await importSafeStorage();
            const storage = getSafeStorage();
            hydrateLocalStore({ stale: 'value' });

            let rehydrated = 0;
            registerSafeStorageRehydrate(() => { rehydrated += 1; });

            hydrateLocalStore({ fresh: 'host', multi: 'yes' });

            expect(storage.getItem('stale')).toBeNull();
            expect(storage.getItem('fresh')).toBe('host');
            expect(storage.getItem('multi')).toBe('yes');
            expect(rehydrated).toBe(1);
        });
    });

    test('hydrateLocalStore ignores non-string values and empty keys', async () => {
        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { getSafeStorage, hydrateLocalStore } = await importSafeStorage();
            const storage = getSafeStorage();

            hydrateLocalStore({
                good: 'value',
                '': 'empty-key',
                bad: 123 as unknown as string,
            } as Record<string, string>);

            expect(storage.getItem('good')).toBe('value');
            expect(storage.length).toBe(1);
        });
    });

    test('does not flush startup defaults before host hydration and keeps the host value', async () => {
        const calls: Array<{ localStore?: Record<string, string> }> = [];
        const updateDesktopSettings = (changes: { localStore?: Record<string, string> }): Promise<void> => {
            calls.push(changes);
            return Promise.resolve();
        };
        await mock.module('@/lib/persistence', () => ({
            updateDesktopSettings: mock(updateDesktopSettings),
            flushPendingSettingsUpdates: () => Promise.resolve(true),
        }));

        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { flushSafeStorage, getSafeStorage, hydrateLocalStore } = await importSafeStorage();
            const storage = getSafeStorage();

            await new Promise((resolve) => setTimeout(resolve, 0));
            calls.length = 0;

            storage.setItem('session-display-mode', 'default');
            await flushSafeStorage();

            expect(calls).toEqual([]);

            hydrateLocalStore({
                'session-display-mode': 'minimal',
                'openchamber.i18n.v1': 'zh-CN',
            });
            await flushSafeStorage();

            expect(storage.getItem('session-display-mode')).toBe('minimal');
            expect(storage.getItem('openchamber.i18n.v1')).toBe('zh-CN');
            expect(calls).toEqual([]);
        });
    });

    test('flushes a new startup key as a patch after host hydration', async () => {
        const calls: Array<{
            localStorePatch?: { set?: Record<string, string>; remove?: string[] };
        }> = [];
        const updateDesktopSettings = (changes: {
            localStorePatch?: { set?: Record<string, string>; remove?: string[] };
        }): Promise<void> => {
            calls.push(changes);
            return Promise.resolve();
        };
        await mock.module('@/lib/persistence', () => ({
            updateDesktopSettings: mock(updateDesktopSettings),
            flushPendingSettingsUpdates: () => Promise.resolve(true),
        }));

        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { flushSafeStorage, getSafeStorage, hydrateLocalStore } = await importSafeStorage();
            const storage = getSafeStorage();

            await new Promise((resolve) => setTimeout(resolve, 0));
            calls.length = 0;

            storage.setItem('new.preference', 'created-at-startup');
            await flushSafeStorage();
            expect(calls).toEqual([]);

            hydrateLocalStore({ 'existing.preference': 'host-value' });
            await flushSafeStorage();

            expect(storage.getItem('existing.preference')).toBe('host-value');
            expect(storage.getItem('new.preference')).toBe('created-at-startup');
            expect(calls).toEqual([{
                localStorePatch: {
                    set: { 'new.preference': 'created-at-startup' },
                },
            }]);
        });
    });

    test('writes schedule a coalesced flush that forwards a key patch to updateDesktopSettings', async () => {
        const calls: Array<{
            localStorePatch?: { set?: Record<string, string>; remove?: string[] };
        }> = [];
        const updateDesktopSettings = (changes: {
            localStorePatch?: { set?: Record<string, string>; remove?: string[] };
        }): Promise<void> => {
            calls.push(changes);
            return Promise.resolve();
        };
        await mock.module('@/lib/persistence', () => ({
            updateDesktopSettings: mock(updateDesktopSettings),
            flushPendingSettingsUpdates: () => Promise.resolve(true),
            invalidateSettingsCache: () => {},
        }));

        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { flushSafeStorage, getSafeStorage, hydrateLocalStore } = await importSafeStorage();
            const storage = getSafeStorage();
            hydrateLocalStore({});

            storage.setItem('a', '1');
            storage.setItem('b', '2');
            storage.setItem('a', '3');

            await flushSafeStorage();
        });

        expect(calls.length).toBeGreaterThan(0);
        const lastCall = calls[calls.length - 1];
        expect(lastCall?.localStorePatch).toEqual({ set: { a: '3', b: '2' } });
    });

    test('retries a retained patch on a later explicit flush', async () => {
        const calls: Array<{
            localStorePatch?: { set?: Record<string, string>; remove?: string[] };
        }> = [];
        let flushAttempts = 0;
        await mock.module('@/lib/persistence', () => ({
            updateDesktopSettings: mock((changes: {
                localStorePatch?: { set?: Record<string, string>; remove?: string[] };
            }): Promise<void> => {
                calls.push(changes);
                return Promise.resolve();
            }),
            flushPendingSettingsUpdates: () => {
                flushAttempts += 1;
                return Promise.resolve(flushAttempts > 1);
            },
        }));

        await withMockWindow({ addEventListener: () => {} }, async () => {
            const { flushSafeStorage, getSafeStorage, hydrateLocalStore } = await importSafeStorage();
            const storage = getSafeStorage();

            await new Promise((resolve) => setTimeout(resolve, 0));
            calls.length = 0;
            hydrateLocalStore({});
            storage.setItem('retry.preference', 'pending');

            await flushSafeStorage();
            await flushSafeStorage();
        });

        expect(calls).toEqual([
            { localStorePatch: { set: { 'retry.preference': 'pending' } } },
            { localStorePatch: { set: { 'retry.preference': 'pending' } } },
        ]);
    });

    test('createDeferredSafeJSONStorage preserves read-after-write and batches serialization', async () => {
        const calls: Array<{
            localStorePatch?: { set?: Record<string, string>; remove?: string[] };
        }> = [];
        const updateDesktopSettings = (changes: {
            localStorePatch?: { set?: Record<string, string>; remove?: string[] };
        }): Promise<void> => {
            calls.push(changes);
            return Promise.resolve();
        };
        const stringifyCalls: unknown[] = [];
        const previousStringify = JSON.stringify;
        await mock.module('@/lib/persistence', () => ({
            updateDesktopSettings: mock(updateDesktopSettings),
            flushPendingSettingsUpdates: () => Promise.resolve(true),
        }));

        await withMockWindow({ addEventListener: () => {} }, async () => {
            JSON.stringify = ((value: unknown, replacer?: Parameters<typeof JSON.stringify>[1], space?: Parameters<typeof JSON.stringify>[2]) => {
                stringifyCalls.push(value);
                return previousStringify(value, replacer, space);
            }) as typeof JSON.stringify;

            const { createDeferredSafeJSONStorage, flushSafeStorage, hydrateLocalStore } = await importSafeStorage();
            const storage = createDeferredSafeJSONStorage<{ value: string }>();
            if (!storage) throw new Error('storage unavailable');
            hydrateLocalStore({});

            storage.setItem('key', { state: { value: 'first' } });
            storage.setItem('key', { state: { value: 'latest' } });

            const before = calls.length;
            expect(storage.getItem('key')).toEqual({ state: { value: 'latest' } });

            await new Promise((resolve) => setTimeout(resolve, 10));
            await flushSafeStorage();

            expect(calls.length).toBeGreaterThan(before);
            expect(stringifyCalls.filter((v) => v && typeof v === 'object' && 'state' in (v as object))).toEqual([{ state: { value: 'latest' } }]);
        });

        JSON.stringify = previousStringify;
    });

    test('session storage still wraps window.sessionStorage with fallback', async () => {
        const sessionStore = new Map<string, string>();
        const mockWindow = {
            sessionStorage: createMockBaseStorage(sessionStore),
            addEventListener: () => {},
        };
        await withMockWindow(mockWindow, async () => {
            const { getSafeSessionStorage } = await importSafeStorage();
            const storage = getSafeSessionStorage();

            storage.setItem('k', 'v');
            expect(sessionStore.get('k')).toBe('v');
            expect(storage.getItem('k')).toBe('v');
        });
    });
});

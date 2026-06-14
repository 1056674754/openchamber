let safeStorageInstance: Storage | null = null;
let safeSessionStorageInstance: Storage | null = null;

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

const createSafeStorage = (): Storage => {
    const baseStorage = getWindowStorage('localStorage');
    if (!baseStorage) return createInMemoryStorage();
    return wrapSafeStorage(baseStorage);
};

export const getSafeStorage = (): Storage => {
    if (!safeStorageInstance) {
        safeStorageInstance = createSafeStorage();
    }
    return safeStorageInstance;
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

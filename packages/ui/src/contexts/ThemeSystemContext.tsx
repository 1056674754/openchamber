import React, {
  useEffect,
  useMemo,
  useCallback,
  useState,
  useRef,
} from 'react';
import { flushSync } from 'react-dom';
import { z } from 'zod';
import type { Theme, ThemeMode } from '@/types/theme';
import type { DesktopSettings } from '@/lib/desktop';
import { isDesktopLocalOriginActive, isDesktopShell, isVSCodeRuntime } from '@/lib/desktop';
import { setDesktopWindowTheme } from '@/lib/desktopNative';
import { CSSVariableGenerator } from '@/lib/theme/cssGenerator';
import { updateDesktopSettings } from '@/lib/persistence';
import {
  themes,
  getThemeById,
  getDefaultTheme,
  DEFAULT_LIGHT_THEME_ID,
  DEFAULT_DARK_THEME_ID,
} from '@/lib/theme/themes';
import {
  adoptThemePreferencesForRuntime,
  resolveThemePreferencesForRuntime,
  resolveThemePreferencesFromStorageEvent,
  writeThemePreferencesForRuntime,
} from './theme-storage';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { ThemeSystemContext, type ThemeContextValue } from './theme-system-context';
import { themeListSchema, themeSchema, type ThemeDefinition } from '@/lib/theme/definition';
import { ThemeImportError } from '@/lib/theme/importErrors';
import type { VSCodeThemePayload } from '@/lib/theme/vscode/adapter';

type ThemePreferences = {
  themeMode: ThemeMode;
  lightThemeId: string;
  darkThemeId: string;
};

type ThemeSyncPayload = {
  themeMode?: unknown;
  lightThemeId?: unknown;
  darkThemeId?: unknown;
};

const DEFAULT_LIGHT_ID = DEFAULT_LIGHT_THEME_ID;
const DEFAULT_DARK_ID = DEFAULT_DARK_THEME_ID;

const getSystemPreference = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const fallbackThemeForVariant = (variant: 'light' | 'dark'): Theme =>
  getDefaultTheme(variant === 'dark');

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

const suppressTransitionsForThemeSwitch = () => {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  root.classList.add('oc-theme-switching');

  const frame = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      root.classList.remove('oc-theme-switching');
    });
  });

  return () => {
    window.cancelAnimationFrame(frame);
    root.classList.remove('oc-theme-switching');
  };
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const getNested = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), value);


const buildInitialPreferences = (defaultThemeId?: string): ThemePreferences => {
  let lightThemeId: string = DEFAULT_LIGHT_ID;
  let darkThemeId: string = DEFAULT_DARK_ID;
  let themeMode: ThemeMode = 'system';

  if (typeof window !== 'undefined') {
    // Scoped per-runtime entry when present; otherwise a one-time seed from
    // the superseded global keys (see resolveThemePreferencesForRuntime), so
    // the first scoped write carries the last-known theme instead of defaults
    // and windows pointing at different instances never adopt each other's
    // theme through shared localStorage.
    const resolvedPreferences = resolveThemePreferencesForRuntime(getRuntimeKey());
    themeMode = resolvedPreferences.themeMode;
    lightThemeId = resolvedPreferences.lightThemeId;
    darkThemeId = resolvedPreferences.darkThemeId;
  }

  if (defaultThemeId) {
    const defaultTheme = getThemeById(defaultThemeId);
    if (defaultTheme) {
      if (defaultTheme.metadata.variant === 'light') {
        lightThemeId = defaultTheme.metadata.id;
      } else {
        darkThemeId = defaultTheme.metadata.id;
      }
    }
  }

  return {
    themeMode,
    lightThemeId,
    darkThemeId,
  };
};

interface ThemeSystemProviderProps {
  children: React.ReactNode;
  defaultThemeId?: string;
}

export function ThemeSystemProvider({ children, defaultThemeId }: ThemeSystemProviderProps) {
  const cssGenerator = useMemo(() => new CSSVariableGenerator(), []);
  const [preferences, setPreferences] = useState<ThemePreferences>(() => buildInitialPreferences(defaultThemeId));
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemPreference());
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [customThemesLoading, setCustomThemesLoading] = useState(false);
  const customThemesRequestRef = useRef(0);
  const themeImportRequestRef = useRef(0);
  const themeRuntimeGenerationRef = useRef(0);
  const missingThemeReloadRef = useRef('');
  const [vscodeTheme, setVSCodeTheme] = useState<Theme | null>(() => {
    if (typeof window === 'undefined' || !isVSCodeRuntime()) {
      return null;
    }
    const existing = (window as unknown as { __OPENCHAMBER_VSCODE_THEME__?: Theme }).__OPENCHAMBER_VSCODE_THEME__;
    return existing || null;
  });
  const isVSCode = useMemo(() => isVSCodeRuntime(), []);
  const isLocalDesktopOrigin = useMemo(() => isDesktopLocalOriginActive(), []);
  const isDesktop = useMemo(() => isDesktopShell(), []);

  const availableThemes = useMemo(() => {
    const merged: Theme[] = [];
    const seen = new Set<string>();

    const add = (theme: Theme) => {
      const id = theme.metadata.id;
      if (seen.has(id)) return;
      seen.add(id);
      merged.push(theme);
    };

    if (isVSCode && vscodeTheme) {
      add(vscodeTheme);
    }

    // Custom themes first so they can override built-ins with the same id.
    customThemes.forEach(add);
    themes.forEach(add);

    return merged;
  }, [customThemes, isVSCode, vscodeTheme]);

  const getThemeByIdFromAvailable = useCallback(
    (themeId: string): Theme | undefined => availableThemes.find((theme) => theme.metadata.id === themeId),
    [availableThemes],
  );

  const ensureThemeById = useCallback(
    (themeId: string, variant: 'light' | 'dark'): Theme => {
      const theme = getThemeByIdFromAvailable(themeId);
      if (theme && theme.metadata.variant === variant) {
        return theme;
      }

      const fallback = availableThemes.find((candidate) => candidate.metadata.variant === variant);
      return fallback ?? fallbackThemeForVariant(variant);
    },
    [availableThemes, getThemeByIdFromAvailable],
  );

  const currentTheme = useMemo(() => {
    if (isVSCode && vscodeTheme) {
      return vscodeTheme;
    }
    if (preferences.themeMode === 'light') {
      return ensureThemeById(preferences.lightThemeId, 'light');
    }
    if (preferences.themeMode === 'dark') {
      return ensureThemeById(preferences.darkThemeId, 'dark');
    }
    return systemPrefersDark
      ? ensureThemeById(preferences.darkThemeId, 'dark')
      : ensureThemeById(preferences.lightThemeId, 'light');
  }, [ensureThemeById, isVSCode, preferences, systemPrefersDark, vscodeTheme]);

  const reloadCustomThemes = useCallback(async () => {
    if (typeof window === 'undefined' || isVSCode) {
      return;
    }

    // Both a request generation and a runtime-key check: a reload started for
    // one instance must not populate custom themes after the endpoint has
    // already switched to another.
    const runtimeKey = getRuntimeKey();
    const request = ++customThemesRequestRef.current;
    setCustomThemesLoading(true);
    try {
      const res = await fetch('/api/config/themes', {
        method: 'GET',
        credentials: isLocalDesktopOrigin ? 'omit' : 'include',
        headers: {
          Accept: 'application/json',
        },
      });

      if (res.status === 401) {
        // UI auth gate will handle prompting; avoid noisy retries here.
        return;
      }

      if (!res.ok) {
        return;
      }

      const payload = await res.json();
      if (request !== customThemesRequestRef.current || runtimeKey !== getRuntimeKey()) return;
      const normalized = themeListSchema.parse(payload?.themes);
      setCustomThemes(normalized);
    } catch {
      // ignore
    } finally {
      if (request === customThemesRequestRef.current && runtimeKey === getRuntimeKey()) {
        setCustomThemesLoading(false);
      }
    }
  }, [isLocalDesktopOrigin, isVSCode]);

  useEffect(() => subscribeRuntimeEndpointChanged((detail) => {
    if (detail.runtimeKey === detail.previousRuntimeKey || isVSCode) return;
    themeRuntimeGenerationRef.current += 1;
    customThemesRequestRef.current += 1;
    setCustomThemes([]);
    setCustomThemesLoading(false);
    // Adopt the new instance's last-known theme immediately; the incoming
    // settings sync refines it with the server's authoritative value.
    setPreferences((prev) => adoptThemePreferencesForRuntime(detail.runtimeKey, prev));
    void reloadCustomThemes();
  }), [isVSCode, reloadCustomThemes]);

  useEffect(() => {
    void reloadCustomThemes();
  }, [reloadCustomThemes]);

  useEffect(() => {
    if (isVSCode || customThemesLoading) return;
    const missing = [preferences.lightThemeId, preferences.darkThemeId]
      .filter((id) => !availableThemes.some((theme) => theme.metadata.id === id));
    if (!missing.length) {
      missingThemeReloadRef.current = '';
      return;
    }
    // Another window may select a newly imported server theme. Fetch once per
    // missing selection, without polling forever for a deleted or invalid ID.
    const key = JSON.stringify([getRuntimeKey(), missing]);
    if (missingThemeReloadRef.current === key) return;
    missingThemeReloadRef.current = key;
    void reloadCustomThemes();
  }, [availableThemes, customThemesLoading, isVSCode, preferences.lightThemeId, preferences.darkThemeId, reloadCustomThemes]);

  useEffect(() => {
    if (!isVSCode) {
      return;
    }

    const applyVSCodeTheme = (theme: Theme) => {
      setVSCodeTheme(theme);
    };

    const handleThemeEvent = (event: Event) => {
      const detail = (event as CustomEvent<VSCodeThemePayload>).detail;
      if (detail?.theme) {
        applyVSCodeTheme(detail.theme);
      }
    };

    const existing = (window as unknown as { __OPENCHAMBER_VSCODE_THEME__?: Theme }).__OPENCHAMBER_VSCODE_THEME__;
    if (existing) {
      applyVSCodeTheme(existing);
    }

    window.addEventListener('openchamber:vscode-theme', handleThemeEvent as EventListener);
    return () => window.removeEventListener('openchamber:vscode-theme', handleThemeEvent as EventListener);
  }, [isVSCode]);

  const updateBrowserChrome = useCallback((theme: Theme) => {
    if (typeof document === 'undefined') {
      return;
    }
    const chromeColor = theme.colors.surface.background;

    document.body.style.backgroundColor = chromeColor;

    let metaThemeColor = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', chromeColor);

    const mediaQuery =
      theme.metadata.variant === 'dark'
        ? '(prefers-color-scheme: dark)'
        : '(prefers-color-scheme: light)';
    let metaThemeColorMedia = document.querySelector(
      `meta[name="theme-color"][media="${mediaQuery}"]`,
    ) as HTMLMetaElement;
    if (!metaThemeColorMedia) {
      metaThemeColorMedia = document.createElement('meta');
      metaThemeColorMedia.setAttribute('name', 'theme-color');
      metaThemeColorMedia.setAttribute('media', mediaQuery);
      document.head.appendChild(metaThemeColorMedia);
    }
    metaThemeColorMedia.setAttribute('content', chromeColor);
  }, []);

  const applyVSCodeRuntimeClass = useCallback((enabled: boolean) => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.classList.toggle('vscode-runtime', enabled);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const restoreTransitions = suppressTransitionsForThemeSwitch();
    cssGenerator.apply(currentTheme);
    applyVSCodeRuntimeClass(isVSCode);
    updateBrowserChrome(currentTheme);

    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(currentTheme.metadata.variant);

    return restoreTransitions;
  }, [applyVSCodeRuntimeClass, cssGenerator, currentTheme, isVSCode, updateBrowserChrome]);

  useEffect(() => {
    if (preferences.themeMode !== 'system' || typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [preferences.themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // Scoped entry is the per-instance authority; the global keys below are
    // cosmetic last-writer-wins hints for the pre-React splash shells and the
    // Android status bar, which run before the scoped key can be read.
    writeThemePreferencesForRuntime(getRuntimeKey(), {
      themeMode: preferences.themeMode,
      lightThemeId: preferences.lightThemeId,
      darkThemeId: preferences.darkThemeId,
    });

    localStorage.setItem('themeMode', preferences.themeMode);
    localStorage.setItem('lightThemeId', preferences.lightThemeId);
    localStorage.setItem('darkThemeId', preferences.darkThemeId);
    localStorage.setItem('useSystemTheme', String(preferences.themeMode === 'system'));
    localStorage.setItem('selectedThemeId', currentTheme.metadata.id);
    localStorage.setItem(
      'selectedThemeVariant',
      currentTheme.metadata.variant === 'light' ? 'light' : 'dark',
    );

    // Splash screen (packages/web/index.html) runs before the theme CSS vars load.
    // Persist just enough to theme it on next boot.
    const lightTheme = ensureThemeById(preferences.lightThemeId, 'light');
    const darkTheme = ensureThemeById(preferences.darkThemeId, 'dark');

    localStorage.setItem('splashBgLight', lightTheme.colors.surface.background);
    localStorage.setItem('splashFgLight', lightTheme.colors.surface.foreground);
    localStorage.setItem('splashBgDark', darkTheme.colors.surface.background);
    localStorage.setItem('splashFgDark', darkTheme.colors.surface.foreground);
  }, [preferences, currentTheme, ensureThemeById]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) {
        return;
      }

      setPreferences((prev) => resolveThemePreferencesFromStorageEvent(event.key, getRuntimeKey(), prev) ?? prev);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const applyIncomingThemeSync = useCallback((payload: ThemeSyncPayload) => {
    const mode = payload.themeMode;
    const light = payload.lightThemeId;
    const dark = payload.darkThemeId;

    if ((mode !== 'light' && mode !== 'dark' && mode !== 'system') || typeof light !== 'string' || typeof dark !== 'string') {
      return;
    }

    const normalizedLight = light.trim();
    const normalizedDark = dark.trim();
    if (!normalizedLight || !normalizedDark) {
      return;
    }

    suppressTransitionsForThemeSwitch();
    flushSync(() => {
      setPreferences((prev) => {
        if (prev.themeMode === mode && prev.lightThemeId === normalizedLight && prev.darkThemeId === normalizedDark) {
          return prev;
        }

        return {
          themeMode: mode,
          lightThemeId: normalizedLight,
          darkThemeId: normalizedDark,
        };
      });
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const scopedWindow = window as unknown as {
      __openchamberApplyThemeSync?: (payload: ThemeSyncPayload) => void;
    };

    scopedWindow.__openchamberApplyThemeSync = applyIncomingThemeSync;

    return () => {
      if (scopedWindow.__openchamberApplyThemeSync === applyIncomingThemeSync) {
        delete scopedWindow.__openchamberApplyThemeSync;
      }
    };
  }, [applyIncomingThemeSync]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as {
        type?: unknown;
        payload?: ThemeSyncPayload;
      };

      if (data?.type !== 'openchamber:theme-sync' || !data.payload) {
        return;
      }

      applyIncomingThemeSync(data.payload);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [applyIncomingThemeSync]);

  useEffect(() => {
    const lightTheme = ensureThemeById(preferences.lightThemeId, 'light');
    const darkTheme = ensureThemeById(preferences.darkThemeId, 'dark');

    void updateDesktopSettings({
      themeId: currentTheme.metadata.id,
      themeVariant: currentTheme.metadata.variant === 'light' ? 'light' : 'dark',
      useSystemTheme: preferences.themeMode === 'system',
      lightThemeId: preferences.lightThemeId,
      darkThemeId: preferences.darkThemeId,
      splashBgLight: lightTheme.colors.surface.background,
      splashFgLight: lightTheme.colors.surface.foreground,
      splashBgDark: darkTheme.colors.surface.background,
      splashFgDark: darkTheme.colors.surface.foreground,
    });
  }, [currentTheme.metadata.id, currentTheme.metadata.variant, ensureThemeById, preferences.themeMode, preferences.lightThemeId, preferences.darkThemeId]);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    void (async () => {
      await setDesktopWindowTheme(preferences.themeMode, currentTheme.metadata.variant);
    })();
  }, [currentTheme.metadata.variant, isDesktop, preferences.themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleSettingsSynced = (event: Event) => {
      const detail = (event as CustomEvent<DesktopSettings>).detail;
      if (!detail) {
        return;
      }

      setPreferences((prev) => {
        let nextMode = prev.themeMode;
        if (detail.useSystemTheme === true) {
          nextMode = 'system';
        } else if (detail.useSystemTheme === false) {
          if (detail.themeVariant === 'dark' || detail.themeVariant === 'light') {
            nextMode = detail.themeVariant;
          }
        }

        let nextLight = prev.lightThemeId;
        if (typeof detail.lightThemeId === 'string' && detail.lightThemeId.length > 0) {
          nextLight = detail.lightThemeId.trim();
        }

        let nextDark = prev.darkThemeId;
        if (typeof detail.darkThemeId === 'string' && detail.darkThemeId.length > 0) {
          nextDark = detail.darkThemeId.trim();
        }

        const same =
          nextMode === prev.themeMode &&
          nextLight === prev.lightThemeId &&
          nextDark === prev.darkThemeId;

        if (same) {
          return prev;
        }

        return {
          themeMode: nextMode,
          lightThemeId: nextLight,
          darkThemeId: nextDark,
        };
      });
    };

    window.addEventListener('openchamber:settings-synced', handleSettingsSynced);
    return () => window.removeEventListener('openchamber:settings-synced', handleSettingsSynced);
  }, []);

  const setTheme = useCallback(
    (themeId: string) => {
      const theme = availableThemes.find((candidate) => candidate.metadata.id === themeId);
      if (!theme) {
        return;
      }

      setPreferences((prev) => {
        if (theme.metadata.variant === 'dark') {
          if (prev.darkThemeId === theme.metadata.id && prev.themeMode === 'dark') {
            return prev;
          }
          return {
            ...prev,
            darkThemeId: theme.metadata.id,
            themeMode: 'dark',
          };
        }

        if (prev.lightThemeId === theme.metadata.id && prev.themeMode === 'light') {
          return prev;
        }

        return {
          ...prev,
          lightThemeId: theme.metadata.id,
          themeMode: 'light',
        };
      });
    },
    [availableThemes],
  );

  const setThemeModeHandler = useCallback((mode: ThemeMode) => {
    setPreferences((prev) => {
      if (prev.themeMode === mode) {
        return prev;
      }
      return {
        ...prev,
        themeMode: mode,
      };
    });
  }, []);

  const setSystemPreferenceHandler = useCallback(
    (use: boolean) => {
      if (use) {
        setPreferences((prev) => {
          if (prev.themeMode === 'system') {
            return prev;
          }
          return {
            ...prev,
            themeMode: 'system',
          };
        });
        return;
      }

      const fallbackMode: ThemeMode =
        currentTheme.metadata.variant === 'dark' ? 'dark' : 'light';
      setPreferences((prev) => {
        if (prev.themeMode === fallbackMode) {
          return prev;
        }
        return {
          ...prev,
          themeMode: fallbackMode,
        };
      });
    },
    [currentTheme.metadata.variant],
  );

  const setLightThemePreference = useCallback(
    (themeId: string) => {
      const theme = availableThemes.find(
        (candidate) =>
          candidate.metadata.id === themeId && candidate.metadata.variant === 'light',
      );
      if (!theme) {
        return;
      }

      setPreferences((prev) => {
        if (prev.lightThemeId === theme.metadata.id) {
          return prev;
        }
        return {
          ...prev,
          lightThemeId: theme.metadata.id,
        };
      });
    },
    [availableThemes],
  );

  const setDarkThemePreference = useCallback(
    (themeId: string) => {
      const theme = availableThemes.find(
        (candidate) =>
          candidate.metadata.id === themeId && candidate.metadata.variant === 'dark',
      );
      if (!theme) {
        return;
      }

      setPreferences((prev) => {
        if (prev.darkThemeId === theme.metadata.id) {
          return prev;
        }
        return {
          ...prev,
          darkThemeId: theme.metadata.id,
        };
      });
    },
    [availableThemes],
  );

  const importTheme = useCallback(async (definition: ThemeDefinition, { activate = true }: { activate?: boolean } = {}): Promise<Theme> => {
    if (isVSCode) throw new ThemeImportError('unsupported');
    const runtimeKey = getRuntimeKey();
    const initialPreferences = preferences;
    const runtimeGeneration = themeRuntimeGenerationRef.current;
    const importRequest = ++themeImportRequestRef.current;
    let theme: Theme;
    try {
      const response = await fetch('/api/config/themes', {
        method: 'POST',
        credentials: isLocalDesktopOrigin ? 'omit' : 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ theme: definition }),
      });
      if (!response.ok) throw new ThemeImportError(response.status === 409 ? 'conflict' : response.status === 413 ? 'size' : 'save');
      const payload = await response.json();
      theme = themeSchema.parse(payload?.theme);
    } catch (error) {
      if (error instanceof ThemeImportError) throw error;
      throw new ThemeImportError('save');
    }
    if (runtimeKey !== getRuntimeKey() || runtimeGeneration !== themeRuntimeGenerationRef.current) throw new ThemeImportError('connection');
    // A reload started before the save must not erase the new authoritative item.
    customThemesRequestRef.current += 1;
    setCustomThemesLoading(false);
    setCustomThemes((current) => [...current.filter((item) => item.metadata.id !== theme.metadata.id), theme]);
    setPreferences((current) => {
      // A choice made while the upload was pending takes precedence.
      if (!activate || current !== initialPreferences || importRequest !== themeImportRequestRef.current) return current;
      return {
        ...current,
        themeMode: theme.metadata.variant,
        ...(theme.metadata.variant === 'dark' ? { darkThemeId: theme.metadata.id } : { lightThemeId: theme.metadata.id }),
      };
    });
    return theme;
  }, [isLocalDesktopOrigin, isVSCode, preferences]);

  const deleteImportedTheme = useCallback(async (themeId: string): Promise<void> => {
    if (isVSCode || !customThemes.some((theme) => theme.metadata.id === themeId)) throw new Error('unsupported');
    const runtimeKey = getRuntimeKey();
    const runtimeGeneration = themeRuntimeGenerationRef.current;
    const response = await fetch(`/api/config/themes/${encodeURIComponent(themeId)}`, {
      method: 'DELETE',
      credentials: isLocalDesktopOrigin ? 'omit' : 'include',
    });
    if (!response.ok) throw new Error('delete');
    z.object({ success: z.literal(true) }).parse(await response.json());
    if (runtimeKey !== getRuntimeKey() || runtimeGeneration !== themeRuntimeGenerationRef.current) throw new ThemeImportError('connection');
    customThemesRequestRef.current += 1;
    setCustomThemesLoading(false);
    setCustomThemes((current) => current.filter((theme) => theme.metadata.id !== themeId));
    setPreferences((current) => {
      if (current.lightThemeId !== themeId && current.darkThemeId !== themeId) return current;
      return {
        ...current,
        lightThemeId: current.lightThemeId === themeId ? fallbackThemeForVariant('light').metadata.id : current.lightThemeId,
        darkThemeId: current.darkThemeId === themeId ? fallbackThemeForVariant('dark').metadata.id : current.darkThemeId,
      };
    });
  }, [customThemes, isLocalDesktopOrigin, isVSCode]);

  const value: ThemeContextValue = {
    currentTheme,
    availableThemes,
    customThemeIds: customThemes.map((theme) => theme.metadata.id),
    setTheme,
    customThemesLoading,
    reloadCustomThemes,
    importTheme,
    deleteImportedTheme,
    isSystemPreference: preferences.themeMode === 'system',
    setSystemPreference: setSystemPreferenceHandler,
    themeMode: preferences.themeMode,
    setThemeMode: setThemeModeHandler,
    lightThemeId: preferences.lightThemeId,
    darkThemeId: preferences.darkThemeId,
    setLightThemePreference,
    setDarkThemePreference,
  };

  return (
    <ThemeSystemContext.Provider value={value}>
      {children}
    </ThemeSystemContext.Provider>
  );
}

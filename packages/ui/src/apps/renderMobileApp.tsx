import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/fonts';
import '@/index.css';
import '@/lib/debug';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ThemeSystemProvider } from '@/contexts/ThemeSystemContext';
import type { RuntimeAPIs } from '@/lib/api/types';
import { startAppearanceAutoSave } from '@/lib/appearanceAutoSave';
import { applyPersistedDirectoryPreferences } from '@/lib/directoryPersistence';
import { initializeLocale, I18nProvider } from '@/lib/i18n';
import { initializeAppearancePreferences, syncDesktopSettings } from '@/lib/persistence';
import { startModelPrefsAutoSave } from '@/lib/modelPrefsAutoSave';
import { startTypographyWatcher } from '@/lib/typographyWatcher';
import { MobileApp } from '@/apps/MobileApp';
import { markAppBootReady } from '@/apps/appBootReady';
import { RuntimeAPIProvider } from '@/contexts/RuntimeAPIProvider';
import { applyCapacitorRootClass, applyOhosRootClass } from '@/hooks/nativeMobileChrome';
import { isNativeShellApp, isOhosApp } from '@/lib/platform';
import { setContextPanelSessionIdProvider } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

const initializeSharedPreferences = () => {
  initializeLocale();

  // Context-panel session scope resolves the active conversation at call time
  // (kept as an injected provider to avoid an import cycle into useUIStore).
  setContextPanelSessionIdProvider(() => useSessionUIStore.getState().currentSessionId);

  void initializeAppearancePreferences().then(() => {
    void Promise.all([
      syncDesktopSettings(),
      applyPersistedDirectoryPreferences(),
    ]).catch((err) => {
      console.error('[mobile-main] settings init failed:', err);
    });

    startAppearanceAutoSave();
    startModelPrefsAutoSave();
    startTypographyWatcher();
  }).catch((err) => {
    console.error('[mobile-main] appearance init failed:', err);
  }).finally(() => {
    markAppBootReady();
  });
};

export const renderMobileApp = (apis: RuntimeAPIs): void => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Mobile root element #root not found');
  }

  // Ensure density/safe-area CSS hooks exist even if mobile.html pre-paint missed the shell.
  if (typeof document !== 'undefined') {
    applyCapacitorRootClass(document.documentElement, isNativeShellApp());
    applyOhosRootClass(document.documentElement, isOhosApp());
  }

  initializeSharedPreferences();

  createRoot(rootElement).render(
    <StrictMode>
      <I18nProvider>
        <ThemeProvider>
          <ThemeSystemProvider>
            {/* DiffWorkerProvider lives in MainLayout and warms on first use (Capacitor). */}
            <RuntimeAPIProvider apis={apis}>
              <MobileApp apis={apis} />
            </RuntimeAPIProvider>
          </ThemeSystemProvider>
        </ThemeProvider>
      </I18nProvider>
    </StrictMode>,
  );
};

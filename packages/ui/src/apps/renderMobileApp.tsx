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
import { applyCapacitorRootClass } from '@/hooks/nativeMobileChrome';
import { isCapacitorApp } from '@/lib/platform';

const initializeSharedPreferences = () => {
  initializeLocale();

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

  // Ensure density/safe-area CSS hooks exist even if mobile.html pre-paint missed Capacitor.
  if (typeof document !== 'undefined') {
    applyCapacitorRootClass(document.documentElement, isCapacitorApp());
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

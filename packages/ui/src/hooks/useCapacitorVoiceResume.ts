import { App } from '@capacitor/app';
import React from 'react';

import { isCapacitorApp } from '@/lib/platform';

/**
 * M9 minimal: listen for Capacitor foreground resume.
 * ComposerDictation / streaming dictation is not wired yet (#11 main track);
 * this hook only emits a DOM event so a future voice owner can resume without
 * inventing a second app-state listener.
 */
export function useCapacitorVoiceResume(): void {
  React.useEffect(() => {
    if (!isCapacitorApp()) return;

    let remove: (() => void) | undefined;
    let disposed = false;

    void App.addListener('appStateChange', (state) => {
      if (!state.isActive || typeof document === 'undefined') return;
      document.dispatchEvent(new CustomEvent('openchamber:capacitor-resume'));
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      remove = () => {
        void handle.remove();
      };
    }).catch(() => {
      // App plugin unavailable in some shells.
    });

    return () => {
      disposed = true;
      remove?.();
    };
  }, []);
}

import { App } from '@capacitor/app';
import React from 'react';

import { isCapacitorApp } from '@/lib/platform';

/**
 * Emit the shared foreground-resume event consumed by useBrowserVoice so an
 * active dictation session can reacquire its selected STT provider.
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

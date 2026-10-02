import React from 'react';

import { subscribeShellAppState } from '@/apps/nativeShell';
import { isNativeShellApp } from '@/lib/platform';

/**
 * Emit the shared foreground-resume event consumed by useBrowserVoice so an
 * active dictation session can reacquire its selected STT provider. Works on
 * every packaged native shell (Capacitor iOS/Android, HarmonyOS ArkWeb).
 */
export function useCapacitorVoiceResume(): void {
  React.useEffect(() => {
    if (!isNativeShellApp()) return;

    return subscribeShellAppState((state) => {
      if (!state.isActive || typeof document === 'undefined') return;
      document.dispatchEvent(new CustomEvent('openchamber:capacitor-resume'));
    });
  }, []);
}

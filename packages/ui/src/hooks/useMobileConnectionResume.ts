import { App } from '@capacitor/app';
import React from 'react';

import { reprobeActiveConnection, type ReprobeOutcome } from '@/apps/mobileConnections';
import { isCapacitorApp } from '@/lib/platform';

type UseMobileConnectionResumeOptions = {
  /** Only probe when a runtime session is currently bound. */
  enabled: boolean;
  onOutcome: (outcome: ReprobeOutcome) => void;
};

/**
 * On Capacitor foreground resume, re-select LAN vs relay for the active
 * saved device. Unreachable / no-connection outcomes must send the user back
 * to the connect screen — the main shell must not keep a dead runtime.
 */
export function useMobileConnectionResume(options: UseMobileConnectionResumeOptions): void {
  const { enabled, onOutcome } = options;
  const onOutcomeRef = React.useRef(onOutcome);
  onOutcomeRef.current = onOutcome;
  const inFlightRef = React.useRef(false);

  React.useEffect(() => {
    if (!isCapacitorApp() || !enabled) return;

    let remove: (() => void) | undefined;
    let disposed = false;

    void App.addListener('appStateChange', (state) => {
      if (!state.isActive || inFlightRef.current) return;
      inFlightRef.current = true;
      void reprobeActiveConnection()
        .then((outcome) => {
          if (!disposed) onOutcomeRef.current(outcome);
        })
        .catch(() => {
          if (!disposed) onOutcomeRef.current('unreachable');
        })
        .finally(() => {
          inFlightRef.current = false;
        });
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
  }, [enabled]);
}

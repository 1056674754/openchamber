import { App } from '@capacitor/app';
import React from 'react';

import { reprobeActiveConnection, type ReprobeOutcome } from '@/apps/mobileConnections';
import { isCapacitorApp } from '@/lib/platform';

type UseMobileConnectionResumeOptions = {
  /** Only probe when a runtime session is currently bound. */
  enabled: boolean;
  onOutcome: (outcome: ReprobeOutcome) => void;
};

export const MOBILE_RESUME_RETRY_DELAYS_MS = [4_000, 10_000] as const;

export const runMobileResumeProbeLadder = async ({
  probe,
  wait,
  isCancelled = () => false,
}: {
  probe: (options: { fast: boolean }) => Promise<ReprobeOutcome>;
  wait: (delayMs: number) => Promise<void>;
  isCancelled?: () => boolean;
}): Promise<ReprobeOutcome | null> => {
  let outcome = await probe({ fast: true });
  if (outcome !== 'unreachable') return outcome;

  for (let index = 0; index < MOBILE_RESUME_RETRY_DELAYS_MS.length; index += 1) {
    await wait(MOBILE_RESUME_RETRY_DELAYS_MS[index]);
    if (isCancelled()) return null;
    const isLast = index === MOBILE_RESUME_RETRY_DELAYS_MS.length - 1;
    outcome = await probe({ fast: !isLast });
    if (outcome !== 'unreachable') return outcome;
  }
  return outcome;
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
      void runMobileResumeProbeLadder({
        probe: reprobeActiveConnection,
        wait: (delayMs) => new Promise((resolve) => window.setTimeout(resolve, delayMs)),
        isCancelled: () => disposed,
      })
        .then((outcome) => {
          if (!disposed && outcome) onOutcomeRef.current(outcome);
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

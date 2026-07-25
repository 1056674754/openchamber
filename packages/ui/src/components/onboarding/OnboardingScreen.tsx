import React from 'react';
import { ChooserScreen } from './ChooserScreen';
import { LocalSetupScreen } from './LocalSetupScreen';
import { RecoveryScreen } from './RecoveryScreen';
import type { RecoveryVariant } from './DesktopConnectionRecovery';

export type OnboardingScreenMode = 'first-launch' | 'local-setup' | 'recovery';

type OnboardingScreenProps = {
  /** Callback when user goes back from local-setup */
  onBack?: () => void;
  /** Callback when CLI becomes available */
  onCliAvailable?: () => void;
  /** Screen mode to render */
  mode?: OnboardingScreenMode;
  /** Recovery variant (only used when mode is 'recovery') */
  recoveryVariant?: RecoveryVariant;
  /** Host URL for recovery context */
  recoveryHostUrl?: string;
  /** Host label for recovery context */
  recoveryHostLabel?: string;
  /** Callback when user enters local setup from recovery */
  onEnterLocalSetup?: () => void;
  /** Callback when user wants to switch to remote (first-launch only) */
  onChooseRemote?: () => void;
  /** When false, remote-only chooser/recovery (no local OpenCode actions) */
  localOpenCodeAvailable?: boolean;
};

export function OnboardingScreen({
  onBack,
  onCliAvailable,
  mode = 'first-launch',
  recoveryVariant = 'missing-default-host',
  recoveryHostUrl,
  recoveryHostLabel,
  onEnterLocalSetup,
  localOpenCodeAvailable = true,
}: OnboardingScreenProps) {
  const [showRecoveryRemoteForm, setShowRecoveryRemoteForm] = React.useState(false);
  const [recoveryEnteredLocalSetup, setRecoveryEnteredLocalSetup] = React.useState(false);

  // Reset transient recovery subflow state when the flow identity changes, so
  // stale local-setup or remote-form views don't bleed across prop updates.
  React.useEffect(() => {
    setRecoveryEnteredLocalSetup(false);
    setShowRecoveryRemoteForm(false);
  }, [mode, recoveryVariant, recoveryHostUrl, recoveryHostLabel]);

  // Derive the effective mode: recovery → local-setup can fall through to the
  // existing local-setup branch instead of getting stuck behind the early return.
  const effectiveMode = recoveryEnteredLocalSetup ? 'local-setup' : mode;

  // Recovery mode
  if (effectiveMode === 'recovery') {
    return (
      <RecoveryScreen
        variant={recoveryVariant}
        hostUrl={recoveryHostUrl}
        hostLabel={recoveryHostLabel}
        showRemoteForm={showRecoveryRemoteForm}
        localOpenCodeAvailable={localOpenCodeAvailable}
        onCloseRemoteForm={() => setShowRecoveryRemoteForm(false)}
        onSwitchToLocalFromRemote={localOpenCodeAvailable === false
          ? undefined
          : () => {
            setShowRecoveryRemoteForm(false);
            setRecoveryEnteredLocalSetup(true);
          }}
        onEnterLocalSetup={localOpenCodeAvailable === false
          ? undefined
          : () => {
            setRecoveryEnteredLocalSetup(true);
            onEnterLocalSetup?.();
          }}
      />
    );
  }

  // Local-setup mode (blocked under remote-only policy)
  if (effectiveMode === 'local-setup' && localOpenCodeAvailable !== false) {
    return (
      <LocalSetupScreen
        onBack={() => {
          if (recoveryEnteredLocalSetup) {
            setRecoveryEnteredLocalSetup(false);
          } else {
            onBack?.();
          }
        }}
        onCliAvailable={onCliAvailable}
        isFromRecovery={recoveryEnteredLocalSetup}
        onSwitchToRemote={() => setShowRecoveryRemoteForm(true)}
      />
    );
  }

  // First-launch mode (default) — also remote-only fallback when local setup is disabled
  return (
    <ChooserScreen
      onCliAvailable={onCliAvailable}
      localOpenCodeAvailable={localOpenCodeAvailable}
    />
  );
}

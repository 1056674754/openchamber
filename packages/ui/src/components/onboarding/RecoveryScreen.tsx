import React from 'react';
import { hasDesktopInvoke, restartDesktopApp } from '@/lib/desktop';
import { DesktopConnectionRecovery, type RecoveryVariant } from './DesktopConnectionRecovery';
import { RemoteConnectionForm } from './RemoteConnectionForm';
import { resolveRecoveryNextStep } from './desktopRecoveryRouting';
import { desktopHostsGet, desktopHostsSet } from '@/lib/desktopHosts';

type RecoveryScreenProps = {
  /** Recovery variant */
  variant: RecoveryVariant;
  /** Host URL for recovery context */
  hostUrl?: string;
  /** Host label for recovery context */
  hostLabel?: string;
  /** Callback when user wants to retry */
  onRetry?: () => void;
  /** Callback when user chooses remote */
  onChooseRemote?: () => void;
  /** Whether to show the remote connection form */
  showRemoteForm?: boolean;
  /** Callback when closing remote form */
  onCloseRemoteForm?: () => void;
  /** Callback when switching to local from remote form */
  onSwitchToLocalFromRemote?: () => void;
  /** Callback when entering local setup */
  onEnterLocalSetup?: () => void;
  /** Whether retry action is in progress */
  isRetrying?: boolean;
  /** When false, hide local OpenCode recovery actions */
  localOpenCodeAvailable?: boolean;
};

export function RecoveryScreen({
  variant,
  hostUrl,
  hostLabel,
  onRetry,
  onChooseRemote,
  showRemoteForm = false,
  onCloseRemoteForm,
  onSwitchToLocalFromRemote,
  onEnterLocalSetup,
  isRetrying = false,
  localOpenCodeAvailable = true,
}: RecoveryScreenProps) {
  // Persist the user's first choice (local or remote)
  const persistFirstChoice = React.useCallback(async (choice: 'local' | 'remote') => {
    if (!hasDesktopInvoke()) return;

    const config = await desktopHostsGet();
    await desktopHostsSet({
      ...config,
      // Only change defaultHostId when switching to local; remote keeps
      // whatever was there (or null) until a successful connect.
      ...(choice === 'local' ? { defaultHostId: 'local' } : {}),
      initialHostChoiceCompleted: true,
    });
  }, []);

  const handleRecoveryRetry = React.useCallback(async () => {
    // In desktop boot flow, restart the app so startup
    // can re-evaluate the boot outcome.
    if (hasDesktopInvoke()) {
      await restartDesktopApp();
      return;
    }

    await fetch('/api/config/reload', { method: 'POST' });
    onRetry?.();
  }, [onRetry]);

  const handleRecoveryUseLocal = React.useCallback(async () => {
    if (localOpenCodeAvailable === false) return;
    const step = resolveRecoveryNextStep(variant, 'use-local');
    if (step.kind === 'local-setup') {
      // local-unavailable + local → enter local-setup subflow without reload
      onEnterLocalSetup?.();
      return;
    }
    // switch-default-to-local → persist local choice and restart
    await persistFirstChoice('local');

    if (hasDesktopInvoke()) {
      await restartDesktopApp();
      return;
    }

    window.location.reload();
  }, [variant, persistFirstChoice, onEnterLocalSetup, localOpenCodeAvailable]);

  const handleRecoveryUseRemote = React.useCallback(() => {
    const step = resolveRecoveryNextStep(variant, 'use-remote');
    if (step.kind === 'remote-form') {
      onChooseRemote?.();
    }
  }, [variant, onChooseRemote]);

  // Recovery mode — show recovery component first; only switch to remote form on explicit user action
  if (showRemoteForm) {
    // For remote-wrong-service, do NOT auto-populate the known bad URL
    const prefillUrl = variant === 'remote-wrong-service' ? '' : (hostUrl || '');
    const prefillLabel = variant === 'remote-wrong-service' ? '' : (hostLabel || '');
    return (
      <RemoteConnectionForm
        onBack={onCloseRemoteForm || (() => onChooseRemote?.())}
        initialUrl={prefillUrl}
        initialLabel={prefillLabel}
        isRecoveryMode={true}
        onSwitchToLocal={localOpenCodeAvailable === false
          ? undefined
          : (onSwitchToLocalFromRemote || (() => {
            persistFirstChoice('local').then(() => {
              if (hasDesktopInvoke()) {
                restartDesktopApp();
              } else {
                onEnterLocalSetup?.();
              }
            });
          }))}
      />
    );
  }

  return (
    <DesktopConnectionRecovery
      variant={variant}
      hostLabel={hostLabel}
      hostUrl={hostUrl}
      localOpenCodeAvailable={localOpenCodeAvailable}
      onRetry={handleRecoveryRetry}
      onUseLocal={localOpenCodeAvailable === false ? undefined : handleRecoveryUseLocal}
      onUseRemote={handleRecoveryUseRemote}
      isRetrying={isRetrying}
    />
  );
}

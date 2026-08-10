import * as React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui';
import { useSettingsServerBaseUrl } from '@/hooks/useSettingsServerBaseUrl';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import {
  applyPendingRestart,
  EMPTY_PENDING_RESTART,
  fetchPendingRestart,
  parsePendingRestartSnapshot,
  type PendingRestartSession,
  type PendingRestartSnapshot,
} from '@/lib/opencode/pendingRestart';
import { subscribeOpenchamberEventEnvelopes } from '@/lib/openchamberEvents';
import { finishConfigUpdate, startConfigUpdate } from '@/lib/configUpdate';
import { useInstanceContextStore } from '@/stores/useInstanceContextStore';
import { refreshAfterOpenCodeRestart, reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { useAllLiveSessions } from '@/sync/sync-context';

type RestartConfirmationProps = {
  readonly open: boolean;
  readonly sessions: readonly PendingRestartSession[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
};

const RestartConfirmation: React.FC<RestartConfirmationProps> = ({
  open,
  sessions,
  onOpenChange,
  onConfirm,
}) => {
  const { t } = useI18n();
  const liveSessions = useAllLiveSessions();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-md gap-5">
        <DialogHeader>
          <DialogTitle>{t('settings.view.pendingRestart.confirm.title')}</DialogTitle>
          <DialogDescription>
            {sessions.length > 0
              ? t('settings.view.pendingRestart.confirm.descriptionActive')
              : t('settings.view.pendingRestart.confirm.description')}
          </DialogDescription>
        </DialogHeader>

        {sessions.length > 0 && (
          <div className="space-y-1 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] p-2">
            {sessions.map((affected) => {
              const session = liveSessions.find((candidate) => candidate.id === affected.sessionId);
              return (
                <div key={affected.sessionId} className="flex min-w-0 items-center justify-between gap-3 typography-ui-label">
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {session?.title || affected.sessionId}
                  </span>
                  <span className="shrink-0 text-[var(--status-warning)]">
                    {affected.status === 'retry'
                      ? t('settings.view.pendingRestart.session.retrying')
                      : t('settings.view.pendingRestart.session.running')}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex w-full items-stretch justify-center gap-3">
          <div className="min-w-0 shrink-0" style={{ width: '40%' }}>
            <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
              {t('settings.view.pendingRestart.confirm.cancel')}
            </Button>
          </div>
          <div className="min-w-0 shrink-0" style={{ width: '40%' }}>
            <Button type="button" className="w-full" onClick={onConfirm}>
              {t('settings.view.actions.applyAndRestartOpenCode')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const OpenCodeReloadFooterAction: React.FC = () => {
  const { t } = useI18n();
  const currentInstance = useInstanceContextStore((state) => state.currentInstance);
  const serverId = currentInstance?.type === 'remote' ? currentInstance.id : DEFAULT_SERVER_ID;
  const serverBase = useSettingsServerBaseUrl();
  const [pending, setPending] = React.useState<PendingRestartSnapshot>(EMPTY_PENDING_RESTART);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [isApplying, setIsApplying] = React.useState(false);

  React.useEffect(() => {
    if (serverBase.status !== 'ready') return;
    const controller = new AbortController();
    void fetchPendingRestart(serverBase.baseUrl)
      .then((snapshot) => {
        if (!controller.signal.aborted) setPending(snapshot);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      });
    return () => controller.abort();
  }, [serverBase.baseUrl, serverBase.status]);

  React.useEffect(() => subscribeOpenchamberEventEnvelopes((event) => {
    if (event.type !== 'openchamber:pending-config-restart' || event.serverId !== serverId) return;
    const snapshot = parsePendingRestartSnapshot(event.properties);
    if (snapshot) setPending(snapshot);
  }), [serverId]);

  const handleApply = React.useCallback(async () => {
    setConfirmOpen(false);
    setIsApplying(true);
    startConfigUpdate(t('settings.view.pendingRestart.applying'));
    try {
      const result = await applyPendingRestart(serverBase.baseUrl);
      setPending(result.pending);
      if (result.requiresManualRestart) {
        toast.warning(t('settings.view.pendingRestart.manualRestartRequired'));
        return;
      }
      if (result.requiresReload) {
        await refreshAfterOpenCodeRestart({
          message: t('settings.view.pendingRestart.applying'),
          delayMs: result.reloadDelayMs,
          mode: 'projects',
          scopes: ['all'],
        });
      }
      toast.success(t('settings.view.pendingRestart.applied'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      finishConfigUpdate();
      setIsApplying(false);
    }
  }, [serverBase.baseUrl, t]);

  const handleManualReload = React.useCallback(async () => {
    try {
      await reloadOpenCodeConfiguration({
        message: t('settings.view.pendingRestart.applying'),
        mode: 'projects',
        scopes: ['all'],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  const hasPending = pending.count > 0;
  const label = hasPending
    ? t('settings.view.actions.applyAndRestartCount', { count: pending.count })
    : t('settings.view.actions.reloadOpenCode');
  const tooltip = hasPending
    ? t('settings.view.actions.applyAndRestartOpenCodeTooltip', { count: pending.count })
    : t('settings.view.actions.reloadOpenCodeTooltip');

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={hasPending ? 'default' : 'ghost'}
        className="w-full justify-start gap-2"
        disabled={serverBase.status !== 'ready' || isApplying || pending.isApplying}
        title={tooltip}
        aria-label={tooltip}
        onClick={() => {
          if (hasPending) {
            setConfirmOpen(true);
          } else {
            void handleManualReload();
          }
        }}
      >
        {hasPending ? (
          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-background px-1.5 typography-micro font-semibold tabular-nums text-foreground">
            {pending.count}
          </span>
        ) : (
          <Icon name="restart" className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">{isApplying ? t('settings.view.pendingRestart.applying') : label}</span>
      </Button>

      {confirmOpen && (
        <RestartConfirmation
          open
          sessions={pending.affectedSessions}
          onOpenChange={setConfirmOpen}
          onConfirm={() => void handleApply()}
        />
      )}
    </>
  );
};

import React from 'react';

import {
  connectToMobileServer,
  disconnectMobileServer,
  isSameConnectionUrl,
  listMobileConnections,
  removeMobileConnection,
  useMobileConnections,
  type MobileSavedConnection,
} from '@/apps/mobileConnections';
import {
  closeMobileInstancesSheet,
  useMobileInstancesSheetOpen,
} from '@/apps/mobileInstancesUi';
import { Button } from '@/components/ui/button';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { useI18n } from '@/lib/i18n';
import { getRuntimeApiBaseUrl } from '@/lib/runtime-switch';

type MobileInstancesSheetProps = {
  onDisconnected?: () => void;
};

export const MobileInstancesSheet: React.FC<MobileInstancesSheetProps> = ({
  onDisconnected,
}) => {
  const open = useMobileInstancesSheetOpen();
  const { t } = useI18n();
  const { connections, refresh } = useMobileConnections();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const activeUrl = getRuntimeApiBaseUrl();

  React.useEffect(() => {
    if (open) {
      refresh();
      setError(null);
    }
  }, [open, refresh]);

  const onClose = React.useCallback(() => {
    closeMobileInstancesSheet();
  }, []);

  const onDisconnect = React.useCallback(() => {
    disconnectMobileServer();
    onDisconnected?.();
    closeMobileInstancesSheet();
  }, [onDisconnected]);

  const onSelect = React.useCallback(async (connection: MobileSavedConnection) => {
    if (activeUrl && isSameConnectionUrl(connection.url, activeUrl)) {
      closeMobileInstancesSheet();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connectToMobileServer({ url: connection.url });
      refresh();
      closeMobileInstancesSheet();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message === 'PASSWORD_REQUIRED'
        ? t('mobile.instances.passwordRequired')
        : (message || t('mobile.instances.connectFailed')));
    } finally {
      setBusy(false);
    }
  }, [activeUrl, refresh, t]);

  const onRemove = React.useCallback(async (connection: MobileSavedConnection) => {
    setBusy(true);
    try {
      await removeMobileConnection(connection.url);
      refresh();
      if (listMobileConnections().length === 0 && activeUrl && isSameConnectionUrl(connection.url, activeUrl)) {
        onDisconnect();
      }
    } finally {
      setBusy(false);
    }
  }, [activeUrl, onDisconnect, refresh]);

  return (
    <MobileOverlayPanel
      open={open}
      title={t('mobile.instances.title')}
      onClose={onClose}
      footer={(
        <div className="flex gap-2 px-3 pb-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-9 w-full"
            disabled={busy || !activeUrl}
            onClick={onDisconnect}
          >
            {t('mobile.instances.disconnect')}
          </Button>
        </div>
      )}
    >
      <div className="space-y-2 px-3 py-2">
        {error ? (
          <p className="typography-meta text-[var(--status-error)]">{error}</p>
        ) : null}
        {connections.length === 0 ? (
          <p className="typography-meta text-muted-foreground">
            {t('mobile.instances.empty')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {connections.map((connection) => {
              const isActive = Boolean(activeUrl && isSameConnectionUrl(connection.url, activeUrl));
              return (
                <li key={connection.id} className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant={isActive ? 'secondary' : 'outline'}
                    size="sm"
                    className="min-w-0 flex-1 justify-start h-8"
                    disabled={busy}
                    onClick={() => { void onSelect(connection); }}
                  >
                    <span className="truncate typography-ui-label">
                      {connection.label}
                      {isActive ? ` · ${t('mobile.instances.current')}` : ''}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    disabled={busy}
                    onClick={() => { void onRemove(connection); }}
                  >
                    {t('mobile.instances.remove')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </MobileOverlayPanel>
  );
};

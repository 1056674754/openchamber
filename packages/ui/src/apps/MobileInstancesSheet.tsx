import React from 'react';

import {
  connectionDisplayUrl,
  isActiveRuntimeConnection,
  type MobileSavedConnection,
} from '@/apps/mobileConnections';
import {
  closeMobileInstancesSheet,
  useMobileInstancesSheetOpen,
} from '@/apps/mobileInstancesUi';
import { Button } from '@/components/ui/button';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { useI18n } from '@/lib/i18n';
import { describePairingTransport } from '@/lib/relay/serverIdAuthority';
import { isRelayModeActive } from '@/lib/relay/runtime-tunnel';

type MobileInstancesSheetProps = {
  connections: MobileSavedConnection[];
  busy?: boolean;
  onSelect: (connection: MobileSavedConnection) => void;
  onRemove: (connection: MobileSavedConnection) => void;
  onDisconnected?: () => void;
};

export const MobileInstancesSheet: React.FC<MobileInstancesSheetProps> = ({
  connections,
  busy = false,
  onSelect,
  onRemove,
  onDisconnected,
}) => {
  const open = useMobileInstancesSheetOpen();
  const { t } = useI18n();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const onClose = React.useCallback(() => {
    closeMobileInstancesSheet();
  }, []);

  const onDisconnect = React.useCallback(() => {
    onDisconnected?.();
    closeMobileInstancesSheet();
  }, [onDisconnected]);

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
            disabled={busy}
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
              const isActive = isActiveRuntimeConnection(connection);
              const transport = describePairingTransport(
                connection.candidates.map((c) => (c.kind === 'relay' ? { type: 'relay' } : { type: 'lan' })),
                isActive && isRelayModeActive() ? 'relay' : 'lan',
              );
              return (
                <li key={connection.id} className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant={isActive ? 'secondary' : 'outline'}
                    size="sm"
                    className="min-w-0 flex-1 justify-start h-8"
                    disabled={busy}
                    onClick={() => {
                      if (isActive) {
                        closeMobileInstancesSheet();
                        return;
                      }
                      try {
                        onSelect(connection);
                        closeMobileInstancesSheet();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : t('mobile.instances.connectFailed'));
                      }
                    }}
                  >
                    <span className="truncate typography-ui-label">
                      {connection.label || connectionDisplayUrl(connection)}
                      {` · ${transport.label}`}
                      {isActive ? ` · ${t('mobile.instances.current')}` : ''}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    disabled={busy}
                    onClick={() => { onRemove(connection); }}
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

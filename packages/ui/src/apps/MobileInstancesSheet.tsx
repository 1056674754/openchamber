import React from 'react';

import {
  connectionDisplayUrl,
  isActiveRuntimeConnection,
  mobileTransportCapability,
  type MobileSavedConnection,
  type MobileTransportCapability,
} from '@/apps/mobileConnections';
import {
  closeMobileInstancesSheet,
  useMobileInstancesSheetOpen,
} from '@/apps/mobileInstancesUi';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { isRelayModeActive } from '@/lib/relay/runtime-tunnel';

type SelectResult =
  | { ok: true }
  | { ok: false; needsPassword?: boolean; error?: string | null };

type MobileInstancesSheetProps = {
  connections: MobileSavedConnection[];
  busy?: boolean;
  error?: string | null;
  onSelect: (connection: MobileSavedConnection) => Promise<SelectResult>;
  onRemove: (connection: MobileSavedConnection) => void | Promise<void>;
  onDisconnected?: () => void;
  onOpenDiagnostics?: () => void;
};

const transportLabelKey = (capability: MobileTransportCapability): I18nKey => {
  switch (capability) {
    case 'relay':
      return 'mobile.transport.relay';
    case 'tunnel':
      return 'mobile.transport.tunnel';
    case 'lan+relay':
      return 'mobile.transport.lanRelay';
    case 'lan':
      return 'mobile.transport.lan';
    default:
      return 'mobile.transport.unknown';
  }
};

export const MobileInstancesSheet: React.FC<MobileInstancesSheetProps> = ({
  connections,
  busy = false,
  error: externalError = null,
  onSelect,
  onRemove,
  onDisconnected,
  onOpenDiagnostics,
}) => {
  const open = useMobileInstancesSheetOpen();
  const { t } = useI18n();
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [switchingId, setSwitchingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setLocalError(null);
  }, [open]);

  const error = localError || externalError;

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
          {onOpenDiagnostics ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label={t('mobile.connectionDebug.title')}
              title={t('mobile.connectionDebug.title')}
              onClick={onOpenDiagnostics}
            >
              <Icon name="information" className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-9 w-full"
            disabled={busy || Boolean(switchingId)}
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
              const livePath = isActive
                ? (isRelayModeActive() ? 'relay' as const : 'lan' as const)
                : null;
              const capability = mobileTransportCapability(connection.candidates, livePath);
              const switching = switchingId === connection.id;
              return (
                <li key={connection.id} className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant={isActive ? 'secondary' : 'outline'}
                    size="sm"
                    className="min-w-0 flex-1 justify-start h-8"
                    disabled={busy || Boolean(switchingId)}
                    onClick={() => {
                      if (isActive) {
                        closeMobileInstancesSheet();
                        return;
                      }
                      setLocalError(null);
                      setSwitchingId(connection.id);
                      void onSelect(connection)
                        .then((result) => {
                          if (result.ok) {
                            closeMobileInstancesSheet();
                            return;
                          }
                          if (result.needsPassword) {
                            closeMobileInstancesSheet();
                            return;
                          }
                          setLocalError(result.error || t('mobile.instances.connectFailed'));
                        })
                        .catch(() => {
                          setLocalError(t('mobile.instances.connectFailed'));
                        })
                        .finally(() => {
                          setSwitchingId(null);
                        });
                    }}
                  >
                    <span className="truncate typography-ui-label">
                      {connection.label || connectionDisplayUrl(connection)}
                      {' · '}
                      {isActive
                        ? t(livePath === 'relay' ? 'mobile.transport.relay' : 'mobile.transport.lan')
                        : t(transportLabelKey(capability))}
                      {isActive ? ` · ${t('mobile.instances.current')}` : ''}
                      {switching ? ` · ${t('mobile.connect.connecting')}` : ''}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    disabled={busy || Boolean(switchingId)}
                    onClick={() => {
                      const label = connection.label || connectionDisplayUrl(connection);
                      if (!window.confirm(t('mobile.instances.confirmRemove', { label }))) return;
                      void Promise.resolve(onRemove(connection)).catch(() => {
                        setLocalError(t('mobile.instances.connectFailed'));
                      });
                    }}
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

import React from 'react';
import { App as CapApp } from '@capacitor/app';

import App from '@/App';
import { MobileInstancesSheet } from '@/apps/MobileInstancesSheet';
import { SessionAuthGate } from '@/components/auth/SessionAuthGate';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { Input } from '@/components/ui/input';
import { RuntimeAPIProvider } from '@/contexts/RuntimeAPIProvider';
import type { RuntimeAPIs } from '@/lib/api/types';
import { markAppBootReady } from '@/apps/appBootReady';
import {
  autoConnectLastInstance,
  connectionDisplayUrl,
  failureReasonMessageKey,
  getAutoConnectTargetLabel,
  isActiveRuntimeConnection,
  mobileTransportCapability,
  useMobileConnection,
  type MobileConnectPhase,
  type MobileSavedConnection,
  type MobileTransportCapability,
} from '@/apps/mobileConnections';
import { cancelActiveQrScan, scanConnectionQr } from '@/apps/mobileQrScan';
import { parsePairingConnectionPayload } from '@/lib/connectionPayload';
import { isCapacitorApp } from '@/lib/platform';
import { useCapacitorVoiceResume } from '@/hooks/useCapacitorVoiceResume';
import { useMobileConnectionResume } from '@/hooks/useMobileConnectionResume';
import { useNativeMobileChrome } from '@/hooks/useNativeMobileChrome';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { isRelayModeActive } from '@/lib/relay/runtime-tunnel';
import { getRuntimeApiBaseUrl, subscribeRuntimeEndpointChanged, switchRuntimeEndpoint } from '@/lib/runtime-switch';

type MobileAppProps = {
  apis: RuntimeAPIs;
};

const disconnectRuntime = (): void => {
  switchRuntimeEndpoint({ apiBaseUrl: '', clientToken: null, runtimeKey: 'mobile-disconnected' });
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

const phaseMessageKey = (phase: MobileConnectPhase): I18nKey | null => {
  switch (phase) {
    case 'auto-connecting':
      return 'mobile.connect.phase.autoConnecting';
    case 'scanning':
      return 'mobile.connect.phase.scanning';
    case 'establishing':
      return 'mobile.connect.phase.establishing';
    case 'redeeming':
      return 'mobile.connect.phase.redeeming';
    case 'authenticating':
      return 'mobile.connect.phase.authenticating';
    default:
      return null;
  }
};

const formatLastUsed = (timestamp: number, t: (key: I18nKey, vars?: Record<string, string | number>) => string): string => {
  const deltaMs = Date.now() - timestamp;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return t('mobile.instances.lastUsedUnknown');
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return t('mobile.instances.lastUsedJustNow');
  if (minutes < 60) return t('mobile.instances.lastUsedMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('mobile.instances.lastUsedHours', { count: hours });
  const days = Math.floor(hours / 24);
  return t('mobile.instances.lastUsedDays', { count: days });
};

export const MobileApp: React.FC<MobileAppProps> = ({ apis }) => {
  useNativeMobileChrome();
  useCapacitorVoiceResume();
  const { t } = useI18n();
  const [url, setUrl] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [scanBusy, setScanBusy] = React.useState(false);
  const [runtimeUrl, setRuntimeUrl] = React.useState(() => getRuntimeApiBaseUrl());
  const [autoConnectTried, setAutoConnectTried] = React.useState(false);
  const [autoConnectLabel, setAutoConnectLabel] = React.useState<string | null>(null);

  const onConnected = React.useCallback(() => {
    setRuntimeUrl(getRuntimeApiBaseUrl());
    markAppBootReady();
  }, []);

  const conn = useMobileConnection(onConnected);
  const setPhaseRef = React.useRef(conn.setPhase);
  const setFailureRef = React.useRef(conn.setFailure);
  const redeemRef = React.useRef(conn.redeemPairingConnection);
  setPhaseRef.current = conn.setPhase;
  setFailureRef.current = conn.setFailure;
  redeemRef.current = conn.redeemPairingConnection;

  useMobileConnectionResume({
    enabled: Boolean(runtimeUrl),
    onOutcome: (outcome) => {
      if (outcome === 'unreachable' || outcome === 'no-connection') {
        disconnectRuntime();
        setRuntimeUrl('');
        setFailureRef.current('unreachable');
      }
    },
  });

  React.useEffect(() => {
    markAppBootReady();
    return subscribeRuntimeEndpointChanged((detail) => {
      setRuntimeUrl(detail.apiBaseUrl);
    });
  }, []);

  React.useEffect(() => {
    if (autoConnectTried || runtimeUrl) return;
    setAutoConnectTried(true);
    const label = getAutoConnectTargetLabel();
    if (!label) {
      markAppBootReady();
      return;
    }
    setAutoConnectLabel(label);
    setPhaseRef.current('auto-connecting');
    void autoConnectLastInstance().then((ok) => {
      if (ok) {
        setRuntimeUrl(getRuntimeApiBaseUrl());
        setPhaseRef.current('connected');
      } else {
        setPhaseRef.current('idle');
        setFailureRef.current('unreachable');
      }
    }).catch(() => {
      setPhaseRef.current('idle');
      setFailureRef.current('unreachable');
    }).finally(() => {
      setAutoConnectLabel(null);
      markAppBootReady();
    });
  }, [autoConnectTried, runtimeUrl]);

  React.useEffect(() => {
    if (!isCapacitorApp()) return;
    let cancelled = false;
    const handleUrl = (raw: string | undefined) => {
      if (!raw || cancelled) return;
      const payload = parsePairingConnectionPayload(raw);
      if (!payload) {
        setFailureRef.current('invalid-payload');
        return;
      }
      void redeemRef.current(payload).catch(() => undefined);
    };
    void CapApp.getLaunchUrl().then((result) => {
      handleUrl(result?.url);
    }).catch(() => undefined);
    const sub = CapApp.addListener('appUrlOpen', (event) => {
      handleUrl(event.url);
    });
    return () => {
      cancelled = true;
      void sub.then((handle) => handle.remove()).catch(() => undefined);
    };
  }, []);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const pairing = parsePairingConnectionPayload(url);
    if (pairing) {
      void conn.redeemPairingConnection(pairing);
      return;
    }
    if (conn.pendingConnection) {
      void conn.submitPassword(password);
      return;
    }
    void conn.connect({ url });
  };

  const onSelectSaved = (saved: MobileSavedConnection) => {
    setUrl(connectionDisplayUrl(saved));
    void conn.connect({ id: saved.id, candidates: saved.candidates, label: saved.label });
  };

  const onScan = async () => {
    setScanBusy(true);
    conn.setError(null);
    conn.setPhase('scanning');
    try {
      const result = await scanConnectionQr();
      // Dismiss the scan chrome before redeem/connect. Leaving the overlay up
      // while pairing runs looks like a stuck black viewfinder on top of
      // "connecting…", and on some devices delaying stopScan/cleanup also
      // stalls WebSocket work for the relay tunnel.
      setScanBusy(false);
      if (result.status === 'pairing') {
        await conn.redeemPairingConnection(result.pairing);
        return;
      }
      if (result.status === 'ok') {
        setUrl(result.url);
        await conn.connect({
          url: result.url,
          label: result.label,
          clientToken: result.clientToken,
        });
        return;
      }
      if (result.status === 'cancelled') return;
      if (result.status === 'unsupported') {
        conn.setError(t('mobile.connect.scanUnsupported'));
        return;
      }
      if (result.status === 'permission-denied') {
        conn.setError(t('mobile.connect.scanPermissionDenied'));
        return;
      }
      if (result.status === 'invalid') {
        conn.setError(t('mobile.connect.scanInvalid'));
        return;
      }
      conn.setError(t('mobile.connect.scanFailed'));
    } finally {
      setScanBusy(false);
      if (conn.phase === 'scanning') conn.setPhase('idle');
    }
  };

  const onCancelScan = () => {
    void cancelActiveQrScan().finally(() => {
      setScanBusy(false);
      conn.setPhase('idle');
    });
  };

  const onDisconnected = React.useCallback(() => {
    disconnectRuntime();
    setRuntimeUrl('');
    conn.cancelPassword();
    setPassword('');
  }, [conn]);

  const onSelectInstance = React.useCallback(async (saved: MobileSavedConnection) => {
    const result = await conn.connect({
      id: saved.id,
      candidates: saved.candidates,
      label: saved.label,
    });
    if (result.status === 'needs-password') {
      disconnectRuntime();
      setRuntimeUrl('');
      setUrl(connectionDisplayUrl(saved));
      return { ok: false as const, needsPassword: true as const };
    }
    if (result.status === 'connected') {
      return { ok: true as const };
    }
    const error = result.status === 'failed'
      ? t(failureReasonMessageKey(result.reason))
      : t('mobile.instances.connectFailed');
    return { ok: false as const, needsPassword: false as const, error };
  }, [conn, t]);

  const phaseKey = phaseMessageKey(conn.phase);
  const showAutoSplash = conn.phase === 'auto-connecting' && Boolean(autoConnectLabel);

  if (runtimeUrl) {
    return (
      <div className="relative h-[100dvh] w-full">
        <SessionAuthGate>
          <App apis={apis} />
        </SessionAuthGate>
        <MobileInstancesSheet
          connections={conn.connections}
          busy={conn.isBusy}
          error={conn.error}
          onSelect={onSelectInstance}
          onRemove={async (saved) => {
            await conn.removeConnection(saved.id);
          }}
          onDisconnected={onDisconnected}
        />
      </div>
    );
  }

  return (
    <RuntimeAPIProvider apis={apis}>
      {scanBusy ? (
        <div className="barcode-scanner-modal" role="dialog" aria-label={t('mobile.connect.scanning')}>
          <div className="barcode-scanner-frame" aria-hidden="true" />
          <p className="barcode-scanner-hint typography-meta">{t('mobile.connect.scanningHint')}</p>
          <Button type="button" variant="secondary" className="h-11 min-w-[10rem]" onClick={onCancelScan}>
            {t('mobile.connect.scanCancel')}
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-[100dvh] flex-col bg-background text-foreground header-safe-area">
        <header className="flex items-center px-3 py-3">
          <span className="typography-ui-label font-semibold tracking-tight">OpenChamber</span>
        </header>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-3 pb-4 bottom-safe-area">
          {conn.connections.length > 0 ? (
            <div className="space-y-1.5">
              <h2 className="typography-micro font-medium uppercase tracking-wide text-muted-foreground">
                {t('mobile.instances.saved')}
              </h2>
              <ul className="space-y-1.5">
                {conn.connections.map((saved) => {
                  const capability = mobileTransportCapability(
                    saved.candidates,
                    isActiveRuntimeConnection(saved) && isRelayModeActive() ? 'relay' : null,
                  );
                  return (
                    <li key={saved.id} className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-w-0 flex-1 justify-start h-auto min-h-9 py-1.5"
                        disabled={conn.isBusy || scanBusy}
                        onClick={() => onSelectSaved(saved)}
                      >
                        <span className="flex min-w-0 flex-col items-start gap-0.5">
                          <span className="truncate typography-ui-label w-full text-left">
                            {saved.label}
                            {' · '}
                            {t(transportLabelKey(capability))}
                          </span>
                          <span className="typography-meta text-muted-foreground">
                            {formatLastUsed(saved.lastUsedAt, t)}
                          </span>
                        </span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        disabled={conn.isBusy}
                        onClick={() => {
                          if (window.confirm(t('mobile.instances.confirmRemove', { label: saved.label }))) {
                            void conn.removeConnection(saved.id);
                          }
                        }}
                      >
                        {t('mobile.instances.remove')}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Icon name="server" className="size-10 text-muted-foreground/50" />
              <p className="typography-meta leading-snug text-muted-foreground">
                {t('mobile.connect.desktopQrHint')}
              </p>
            </div>
          )}

          {showAutoSplash ? (
            <p className="typography-ui-label text-muted-foreground">
              {t('mobile.connect.connectingTo', { label: autoConnectLabel ?? '' })}
            </p>
          ) : null}

          <div className="mt-auto space-y-2 pt-2">
            <Button
              type="button"
              className="h-11 w-full"
              disabled={conn.isBusy || scanBusy}
              onClick={() => { void onScan(); }}
            >
              {scanBusy ? t('mobile.connect.scanning') : t('mobile.connect.scanQr')}
            </Button>

            {phaseKey && !scanBusy && conn.isBusy ? (
              <p className="typography-meta text-center text-muted-foreground">{t(phaseKey)}</p>
            ) : null}

            <form className="space-y-2" onSubmit={onSubmit}>
              {conn.pendingConnection ? (
                <p className="typography-meta text-muted-foreground">
                  {t('mobile.connect.passwordRequired')}
                  {conn.pendingConnection.label ? ` · ${conn.pendingConnection.label}` : ''}
                </p>
              ) : null}
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('mobile.connect.urlPlaceholder')}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={conn.isBusy || Boolean(conn.pendingConnection)}
                className="h-9 typography-ui-label"
              />
              {conn.pendingConnection || password ? (
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('mobile.connect.passwordPlaceholder')}
                  disabled={conn.isBusy}
                  autoFocus={Boolean(conn.pendingConnection)}
                  className="h-9 typography-ui-label"
                />
              ) : null}
              {conn.error ? (
                <p className="typography-meta text-[var(--status-error)]">{conn.error}</p>
              ) : null}
              <Button
                type="submit"
                size="sm"
                className="h-9 w-full"
                disabled={conn.isBusy || (!url.trim() && !conn.pendingConnection)}
              >
                {conn.isBusy
                  ? (phaseKey ? t(phaseKey) : t('mobile.connect.connecting'))
                  : t('mobile.connect.submit')}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </RuntimeAPIProvider>
  );
};

import React from 'react';
import { App as CapApp } from '@capacitor/app';

import App from '@/App';
import { MobileInstancesSheet } from '@/apps/MobileInstancesSheet';
import { SessionAuthGate } from '@/components/auth/SessionAuthGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RuntimeAPIProvider } from '@/contexts/RuntimeAPIProvider';
import type { RuntimeAPIs } from '@/lib/api/types';
import { markAppBootReady } from '@/apps/appBootReady';
import {
  autoConnectLastInstance,
  connectionDisplayUrl,
  isActiveRuntimeConnection,
  useMobileConnection,
  type MobileSavedConnection,
} from '@/apps/mobileConnections';
import { scanConnectionQr } from '@/apps/mobileQrScan';
import { parsePairingConnectionPayload } from '@/lib/connectionPayload';
import { isCapacitorApp } from '@/lib/platform';
import { useCapacitorVoiceResume } from '@/hooks/useCapacitorVoiceResume';
import { useNativeMobileChrome } from '@/hooks/useNativeMobileChrome';
import { useI18n } from '@/lib/i18n';
import { describePairingTransport } from '@/lib/relay/serverIdAuthority';
import { isRelayModeActive } from '@/lib/relay/runtime-tunnel';
import { getRuntimeApiBaseUrl, subscribeRuntimeEndpointChanged, switchRuntimeEndpoint } from '@/lib/runtime-switch';

type MobileAppProps = {
  apis: RuntimeAPIs;
};

const disconnectRuntime = (): void => {
  switchRuntimeEndpoint({ apiBaseUrl: '', clientToken: null, runtimeKey: 'mobile-disconnected' });
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

  const onConnected = React.useCallback(() => {
    setRuntimeUrl(getRuntimeApiBaseUrl());
    markAppBootReady();
  }, []);

  const conn = useMobileConnection(onConnected);

  React.useEffect(() => {
    markAppBootReady();
    return subscribeRuntimeEndpointChanged((detail) => {
      setRuntimeUrl(detail.apiBaseUrl);
    });
  }, []);

  React.useEffect(() => {
    if (autoConnectTried || runtimeUrl) return;
    setAutoConnectTried(true);
    void autoConnectLastInstance().then((ok) => {
      if (ok) setRuntimeUrl(getRuntimeApiBaseUrl());
    }).catch(() => undefined);
  }, [autoConnectTried, runtimeUrl]);

  React.useEffect(() => {
    if (!isCapacitorApp()) return;
    let cancelled = false;
    const handleUrl = (raw: string | undefined) => {
      if (!raw || cancelled) return;
      const payload = parsePairingConnectionPayload(raw);
      if (!payload) return;
      void conn.redeemPairingConnection(payload).catch(() => undefined);
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
  }, [conn]);

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

  const onSelect = (saved: MobileSavedConnection) => {
    setUrl(connectionDisplayUrl(saved));
    void conn.connect({ id: saved.id, candidates: saved.candidates, label: saved.label });
  };

  const onScan = async () => {
    setScanBusy(true);
    try {
      const result = await scanConnectionQr();
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
      }
    } finally {
      setScanBusy(false);
    }
  };

  const onDisconnected = React.useCallback(() => {
    disconnectRuntime();
    setRuntimeUrl('');
    conn.cancelPassword();
    setPassword('');
  }, [conn]);

  if (runtimeUrl) {
    return (
      <div className="relative h-[100dvh] w-full">
        <SessionAuthGate>
          <App apis={apis} />
        </SessionAuthGate>
        <MobileInstancesSheet
          connections={conn.connections}
          busy={conn.isBusy}
          onSelect={(saved) => { void conn.connect({ id: saved.id, candidates: saved.candidates, label: saved.label }); }}
          onRemove={(saved) => { void conn.removeConnection(saved.id); }}
          onDisconnected={onDisconnected}
        />
      </div>
    );
  }

  return (
    <RuntimeAPIProvider apis={apis}>
      <div className="flex min-h-[100dvh] flex-col bg-background px-3 py-3 text-foreground header-safe-area bottom-safe-area">
        <div className="mx-auto w-full max-w-md space-y-3">
          <div className="space-y-0.5">
            <h1 className="typography-ui-header font-semibold tracking-tight">OpenChamber</h1>
            <p className="typography-meta leading-snug text-muted-foreground">
              {t('mobile.connect.subtitle')}
            </p>
          </div>

          <Button
            type="button"
            size="sm"
            className="h-9 w-full"
            disabled={conn.isBusy || scanBusy}
            onClick={() => { void onScan(); }}
          >
            {scanBusy ? t('mobile.connect.connecting') : t('mobile.connect.scanQr')}
          </Button>

          <p className="typography-meta text-muted-foreground text-center">{t('mobile.connect.orUrl')}</p>

          <form className="space-y-2" onSubmit={onSubmit}>
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://192.168.1.10:3000"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={conn.isBusy}
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
            <Button type="submit" size="sm" className="h-9 w-full" disabled={conn.isBusy || !url.trim()}>
              {conn.isBusy ? t('mobile.connect.connecting') : t('mobile.connect.submit')}
            </Button>
          </form>

          {conn.connections.length > 0 ? (
            <div className="space-y-1.5">
              <h2 className="typography-meta font-medium text-muted-foreground">{t('mobile.instances.saved')}</h2>
              <ul className="space-y-1.5">
                {conn.connections.map((saved) => {
                  const transport = describePairingTransport(
                    saved.candidates.map((c) => (c.kind === 'relay' ? { type: 'relay' } : { type: 'lan' })),
                    isActiveRuntimeConnection(saved) && isRelayModeActive() ? 'relay' : 'lan',
                  );
                  return (
                    <li key={saved.id} className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-w-0 flex-1 justify-start h-8"
                        disabled={conn.isBusy}
                        onClick={() => onSelect(saved)}
                      >
                        <span className="truncate typography-ui-label">
                          {saved.label}
                          {` · ${transport.label}`}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        disabled={conn.isBusy}
                        onClick={() => { void conn.removeConnection(saved.id); }}
                      >
                        {t('mobile.instances.remove')}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </RuntimeAPIProvider>
  );
};

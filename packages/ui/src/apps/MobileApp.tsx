import React from 'react';

import App from '@/App';
import { MobileInstancesSheet } from '@/apps/MobileInstancesSheet';
import { SessionAuthGate } from '@/components/auth/SessionAuthGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RuntimeAPIProvider } from '@/contexts/RuntimeAPIProvider';
import type { RuntimeAPIs } from '@/lib/api/types';
import { markAppBootReady } from '@/apps/appBootReady';
import {
  connectToMobileServer,
  disconnectMobileServer,
  listMobileConnections,
  removeMobileConnection,
  type MobileSavedConnection,
  useMobileConnections,
} from '@/apps/mobileConnections';
import { getRuntimeApiBaseUrl, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { useCapacitorVoiceResume } from '@/hooks/useCapacitorVoiceResume';
import { useNativeMobileChrome } from '@/hooks/useNativeMobileChrome';
import { useI18n } from '@/lib/i18n';

type MobileAppProps = {
  apis: RuntimeAPIs;
};

export const MobileApp: React.FC<MobileAppProps> = ({ apis }) => {
  useNativeMobileChrome();
  useCapacitorVoiceResume();
  const { t } = useI18n();
  const { connections, refresh } = useMobileConnections();
  const [url, setUrl] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [needsPassword, setNeedsPassword] = React.useState(false);
  const [connectedUrl, setConnectedUrl] = React.useState(() => getRuntimeApiBaseUrl());

  React.useEffect(() => {
    markAppBootReady();
    return subscribeRuntimeEndpointChanged((detail) => {
      setConnectedUrl(detail.apiBaseUrl);
    });
  }, []);

  const connect = React.useCallback(async (targetUrl: string, targetPassword?: string) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await connectToMobileServer({
        url: targetUrl,
        password: targetPassword,
      });
      setConnectedUrl(saved.url);
      setNeedsPassword(false);
      setPassword('');
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PASSWORD_REQUIRED') {
        setNeedsPassword(true);
        setError(t('mobile.connect.passwordRequired'));
      } else {
        setError(message || t('mobile.connect.failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void connect(url, password);
  };

  const onSelect = (connection: MobileSavedConnection) => {
    setUrl(connection.url);
    void connect(connection.url);
  };

  const onDisconnected = React.useCallback(() => {
    disconnectMobileServer();
    setConnectedUrl('');
    setNeedsPassword(false);
    setPassword('');
  }, []);

  if (connectedUrl) {
    return (
      <div className="relative h-[100dvh] w-full">
        <SessionAuthGate>
          <App apis={apis} />
        </SessionAuthGate>
        <MobileInstancesSheet onDisconnected={onDisconnected} />
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

          <form className="space-y-2" onSubmit={onSubmit}>
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://192.168.1.10:3000"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              className="h-9 typography-ui-label"
            />
            {needsPassword ? (
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('mobile.connect.passwordPlaceholder')}
                disabled={busy}
                autoFocus
                className="h-9 typography-ui-label"
              />
            ) : null}
            {error ? <p className="typography-meta text-[var(--status-error)]">{error}</p> : null}
            <Button type="submit" size="sm" className="h-9 w-full" disabled={busy || !url.trim()}>
              {busy ? t('mobile.connect.connecting') : t('mobile.connect.submit')}
            </Button>
          </form>

          {connections.length > 0 ? (
            <div className="space-y-1.5">
              <h2 className="typography-meta font-medium text-muted-foreground">{t('mobile.instances.saved')}</h2>
              <ul className="space-y-1.5">
                {connections.map((connection) => (
                  <li key={connection.id} className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-w-0 flex-1 justify-start h-8"
                      disabled={busy}
                      onClick={() => onSelect(connection)}
                    >
                      <span className="truncate typography-ui-label">{connection.label}</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      disabled={busy}
                      onClick={() => {
                        void removeMobileConnection(connection.url).then(() => {
                          refresh();
                          if (listMobileConnections().length === 0) setUrl('');
                        });
                      }}
                    >
                      {t('mobile.instances.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </RuntimeAPIProvider>
  );
};

import React from 'react';
import QRCode from 'qrcode';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  buildPairingConnectionPayload,
  encodePairingConnectionPayload,
  parsePairingConnectionPayload,
} from '@/lib/connectionPayload';
import { desktopHostsGet, desktopHostsSet, importDesktopHostPairing } from '@/lib/desktopHosts';
import { hasDesktopInvoke } from '@/lib/desktop';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';

type PairingClient = {
  id: string;
  label: string;
  usesRelay?: boolean;
  lastTransport?: 'relay' | 'direct' | null;
  revokedAt?: string | null;
};

type PendingSession = {
  id: string;
  label: string;
  usesRelay?: boolean;
  fingerprint?: string | null;
};

type RelayStatus = {
  enabled: boolean;
  state: string;
  serverId?: string;
  connectedClients?: number;
  relayUrl?: string;
  lastError?: string;
};

type TransportChoice = 'lan' | 'relay' | 'relay-only';

/**
 * Pairing v2 + private-relay management for this OpenChamber host.
 * Redeem/import on desktop adds a desktop host entry (never replaces local default).
 */
export const PairingDevicesPanel: React.FC = () => {
  const { t } = useI18n();
  const [relayStatus, setRelayStatus] = React.useState<RelayStatus | null>(null);
  const [clients, setClients] = React.useState<PairingClient[]>([]);
  const [pending, setPending] = React.useState<PendingSession[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = React.useState('');
  const [transport, setTransport] = React.useState<TransportChoice>('relay');
  const [pairingLink, setPairingLink] = React.useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [importLink, setImportLink] = React.useState('');
  const [lanUrl, setLanUrl] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const [statusRes, clientsRes, pendingRes, transportsRes] = await Promise.all([
      runtimeFetch('/api/openchamber/relay/status').catch(() => null),
      runtimeFetch('/api/client-auth/clients').catch(() => null),
      runtimeFetch('/api/client-auth/pairing/sessions').catch(() => null),
      runtimeFetch('/api/client-auth/pairing/transports').catch(() => null),
    ]);
    if (statusRes?.ok) {
      const body = await statusRes.json().catch(() => null) as RelayStatus | null;
      if (body) setRelayStatus(body);
    }
    if (clientsRes?.ok) {
      const body = await clientsRes.json().catch(() => null) as { clients?: PairingClient[] } | null;
      setClients(Array.isArray(body?.clients) ? body.clients.filter((c) => !c.revokedAt) : []);
    }
    if (pendingRes?.ok) {
      const body = await pendingRes.json().catch(() => null) as { pending?: PendingSession[] } | null;
      setPending(Array.isArray(body?.pending) ? body.pending : []);
    }
    if (transportsRes?.ok) {
      const body = await transportsRes.json().catch(() => null) as { lan?: string | null } | null;
      setLanUrl(typeof body?.lan === 'string' ? body.lan : null);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 8_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const createPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      const includeRelay = transport === 'relay' || transport === 'relay-only';
      const includeDirect = transport !== 'relay-only';
      const response = await runtimeFetch('/api/client-auth/pairing/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: deviceLabel.trim() || undefined,
          includeRelay,
          includeDirect,
          serverUrl: lanUrl || undefined,
          allowedClientKinds: ['mobile', 'desktop'],
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      // Server shape: { pairing: { id, secret, fingerprint, expiresAt }, server: { candidates } }
      const body = await response.json() as {
        pairing?: {
          id?: string;
          secret?: string;
          fingerprint?: string;
          expiresAt?: string;
        };
        server?: { label?: string; candidates?: unknown[] };
      };
      const pairingId = typeof body.pairing?.id === 'string' ? body.pairing.id.trim() : '';
      const secret = typeof body.pairing?.secret === 'string' ? body.pairing.secret.trim() : '';
      const candidates = Array.isArray(body.server?.candidates) ? body.server.candidates : null;
      if (!pairingId || !secret || !candidates) {
        throw new Error(t('settings.pairing.invalidResponse'));
      }
      if (candidates.length === 0) {
        throw new Error(t('settings.pairing.noCandidates'));
      }
      // Payload label is what the paired device names THIS connection (server
      // hostname). The typed deviceLabel already went to createPairingSession
      // as the per-device row name on this host.
      const payload = buildPairingConnectionPayload({
        pairingId,
        secret,
        fingerprint: body.pairing?.fingerprint,
        expiresAt: body.pairing?.expiresAt,
        label: (typeof body.server?.label === 'string' && body.server.label.trim()) || undefined,
        candidates: candidates as never,
      });
      const link = encodePairingConnectionPayload(payload);
      setPairingLink(link);
      // Dense pairing payloads (relay key + candidates) need high-res / low ECC.
      setQrDataUrl(await QRCode.toDataURL(link, { width: 1024, margin: 2, errorCorrectionLevel: 'L' }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const setRelayEnabled = async (enabled: boolean) => {
    setBusy(true);
    try {
      const path = enabled ? '/api/openchamber/relay/enable' : '/api/openchamber/relay/disable';
      const response = await runtimeFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const revokeClient = async (id: string) => {
    setBusy(true);
    try {
      await runtimeFetch(`/api/client-auth/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onImportPairingLink = async () => {
    if (!parsePairingConnectionPayload(importLink)) {
      setError(t('settings.pairing.invalidLink'));
      return;
    }
    if (!hasDesktopInvoke()) {
      setError(t('settings.pairing.importDesktopOnly'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const current = await desktopHostsGet().catch(() => null);
      const hosts = current?.hosts || [];
      const result = await importDesktopHostPairing(importLink.trim(), hosts);
      await desktopHostsSet({
        hosts: result.hosts,
        defaultHostId: current?.defaultHostId ?? result.hostId,
        initialHostChoiceCompleted: current?.initialHostChoiceCompleted ?? true,
      });
      toast.success(t('settings.pairing.importSuccess'));
      setImportLink('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 typography-meta">
        <span>
          {t('settings.pairing.relayStatus')}: {relayStatus?.state || '…'}
          {relayStatus?.connectedClients != null ? ` · ${relayStatus.connectedClients}` : ''}
        </span>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void setRelayEnabled(true); }}>
          {t('settings.pairing.enableRelay')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { void setRelayEnabled(false); }}>
          {t('settings.pairing.disableRelay')}
        </Button>
      </div>

      <div className="space-y-2">
        <Input
          value={deviceLabel}
          onChange={(event) => setDeviceLabel(event.target.value)}
          placeholder={t('settings.pairing.deviceNamePlaceholder')}
          className="h-9"
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2">
          {([
            ['lan', 'settings.pairing.transportLan'],
            ['relay', 'settings.pairing.transportAnywhere'],
            ['relay-only', 'settings.pairing.transportRelayOnly'],
          ] as const).map(([value, key]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={transport === value ? 'secondary' : 'outline'}
              disabled={busy}
              onClick={() => setTransport(value)}
            >
              {t(key)}
            </Button>
          ))}
        </div>
        <Button type="button" size="sm" disabled={busy} onClick={() => { void createPairing(); }}>
          {t('settings.pairing.addDevice')}
        </Button>
      </div>

      {pairingLink && qrDataUrl ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <img src={qrDataUrl} alt="Pairing QR" className="mx-auto h-48 w-48" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => {
              void copyTextToClipboard(pairingLink).then(() => toast.success(t('settings.pairing.linkCopied')));
            }}
          >
            {t('settings.pairing.copyLink')}
          </Button>
        </div>
      ) : null}

      {error ? <p className="typography-meta text-[var(--status-error)]">{error}</p> : null}

      <div className="space-y-1.5">
        <h4 className="typography-meta font-medium text-muted-foreground">{t('settings.pairing.pairedDevices')}</h4>
        {clients.length === 0 ? (
          <p className="typography-meta text-muted-foreground">{t('settings.pairing.noDevices')}</p>
        ) : (
          <ul className="space-y-1">
            {clients.map((client) => (
              <li key={client.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate typography-ui-label">
                  {client.label}
                  {client.lastTransport ? ` · ${client.lastTransport}` : ''}
                  {client.usesRelay ? ' · relay' : ''}
                </span>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { void revokeClient(client.id); }}>
                  {t('settings.pairing.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {pending.length > 0 ? (
          <p className="typography-meta text-muted-foreground">
            {t('settings.pairing.pendingCount', { count: pending.length })}
          </p>
        ) : null}
      </div>

      {hasDesktopInvoke() ? (
        <div className="space-y-2 border-t border-border pt-3">
          <h4 className="typography-meta font-medium text-muted-foreground">{t('settings.pairing.importTitle')}</h4>
          <Input
            value={importLink}
            onChange={(event) => setImportLink(event.target.value)}
            placeholder="openchamber://connect?v=2&p=…"
            className="h-9"
            disabled={busy}
          />
          <Button type="button" size="sm" disabled={busy || !importLink.trim()} onClick={() => { void onImportPairingLink(); }}>
            {t('settings.pairing.importSubmit')}
          </Button>
        </div>
      ) : null}
    </section>
  );
};

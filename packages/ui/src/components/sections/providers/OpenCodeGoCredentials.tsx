import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { resolveApiUrl } from '@/lib/api/serverUrl';

interface CredentialStatus {
  configured: boolean;
  workspaceId?: string;
  secretMasked?: string;
}

interface OpenCodeGoCredentialsProps {
  serverBaseUrl?: string;
}

export const OpenCodeGoCredentials: React.FC<OpenCodeGoCredentialsProps> = ({ serverBaseUrl }) => {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<CredentialStatus | null>(null);
  const [workspaceId, setWorkspaceId] = React.useState('');
  const [authCookie, setAuthCookie] = React.useState('');
  const [busy, setBusy] = React.useState<'save' | 'validate' | 'delete' | null>(null);
  const route = resolveApiUrl('/api/quota/credentials/opencode-go', serverBaseUrl);

  React.useEffect(() => {
    let active = true;
    void fetch(route)
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load credential status');
        const next = await response.json() as CredentialStatus;
        if (!active) return;
        setStatus(next);
        setWorkspaceId(next.workspaceId ?? '');
      })
      .catch(() => {
        if (active) setStatus({ configured: false });
      });
    return () => {
      active = false;
    };
  }, [route]);

  const save = async () => {
    setBusy('save');
    try {
      const response = await fetch(route, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceId.trim(), authCookie: authCookie.trim() }),
      });
      const payload = await response.json().catch(() => null) as CredentialStatus & { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error);
      setStatus(payload);
      setWorkspaceId(payload?.workspaceId ?? workspaceId.trim());
      setAuthCookie('');
      toast.success(t('settings.providers.page.openCodeGo.saved'));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('settings.providers.page.openCodeGo.saveFailed'),
      );
    } finally {
      setBusy(null);
    }
  };

  const validate = async () => {
    setBusy('validate');
    try {
      const response = await fetch(`${route}/validate`, { method: 'POST' });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error);
      toast.success(t('settings.providers.page.openCodeGo.valid'));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('settings.providers.page.openCodeGo.invalid'),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      const response = await fetch(route, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete credentials');
      setStatus({ configured: false });
      setWorkspaceId('');
      setAuthCookie('');
      toast.success(t('settings.providers.page.openCodeGo.deleted'));
    } catch {
      toast.error(t('settings.providers.page.openCodeGo.deleteFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-settings-item="providers.opencode-go-credentials" className="mb-8">
      <div className="mb-1 px-1">
        <h3 className="typography-ui-header font-medium text-foreground">
          {t('settings.providers.page.openCodeGo.title')}
        </h3>
        <p className="typography-meta text-muted-foreground">
          {t('settings.providers.page.openCodeGo.description')}
        </p>
      </div>
      <section className="space-y-3 px-2 pb-2 pt-0">
        <label className="block typography-ui-label text-foreground">
          {t('settings.providers.page.openCodeGo.workspaceId')}
          <Input
            className="mt-1 font-mono text-xs"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            placeholder="wrk_..."
          />
        </label>
        <label className="block typography-ui-label text-foreground">
          {t('settings.providers.page.openCodeGo.authCookie')}
          <Input
            className="mt-1 font-mono text-xs"
            type="password"
            autoComplete="off"
            value={authCookie}
            onChange={(event) => setAuthCookie(event.target.value)}
            placeholder={status?.secretMasked ?? 'auth=...'}
          />
        </label>
        <p className="typography-meta text-muted-foreground">
          {t('settings.providers.page.openCodeGo.help')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" onClick={() => void save()} disabled={Boolean(busy) || status === null}>
            {status?.configured
              ? t('settings.providers.page.openCodeGo.replace')
              : t('settings.providers.page.openCodeGo.save')}
          </Button>
          {status?.configured && (
            <Button variant="outline" size="xs" onClick={() => void validate()} disabled={Boolean(busy)}>
              {t('settings.providers.page.openCodeGo.validate')}
            </Button>
          )}
          {status?.configured && (
            <Button variant="destructive" size="xs" onClick={() => void remove()} disabled={Boolean(busy)}>
              {t('settings.providers.page.openCodeGo.delete')}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
};

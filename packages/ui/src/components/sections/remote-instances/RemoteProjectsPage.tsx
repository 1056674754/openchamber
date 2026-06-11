import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';

export function RemoteProjectsPage() {
  const { t } = useI18n();

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <h1 className="typography-ui-header font-semibold text-foreground">
          {t('settings.page.remoteProjects.title')}
        </h1>

        <div className="rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-6">
          <div className="text-center">
            <Icon name="folder" className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="typography-ui text-muted-foreground mb-3">
              Remote project browsing is available when connected to a remote instance via SSH.
            </p>
            <p className="typography-small text-muted-foreground/70">
              Projects are discovered from the remote machine&apos;s filesystem. Connect to a remote instance to see available projects.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

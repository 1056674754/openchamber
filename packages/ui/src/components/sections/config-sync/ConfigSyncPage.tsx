import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useConfigSyncStore } from '@/stores/useConfigSyncStore';
import { useInstanceContextStore } from '@/stores/useInstanceContextStore';
import { cn } from '@/lib/utils';

export function ConfigSyncPage() {
  const { t } = useI18n();
  const currentInstance = useInstanceContextStore((s) => s.currentInstance);
  const cs = useConfigSyncStore();

  useEffect(() => {
    cs.loadDiff('default', currentInstance?.id ?? '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCount = cs.differences.filter((d) => d.selected).length;

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="typography-ui-header font-semibold text-foreground mb-1">
            {t('settings.page.configSync.title')}
          </h1>
          <p className="typography-ui text-muted-foreground">
            Sync OpenCode configuration between your default instance and this remote.
          </p>
        </div>

        {cs.loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Icon name="loader-4" className="h-5 w-5 animate-spin" />
            <span>Loading config differences...</span>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="typography-ui-label text-foreground">
                  {cs.differences.length} config entries
                </span>
                <Button variant="ghost" size="xs" onClick={cs.selectAll}>
                  Select All
                </Button>
              </div>

              {cs.differences.length === 0 ? (
                <p className="typography-small text-muted-foreground py-4">
                  Configurations are in sync.
                </p>
              ) : (
                <div className="space-y-1">
                  {cs.differences.slice(0, 20).map((diff, i) => (
                    <label
                      key={diff.key}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer transition-colors',
                        diff.selected
                          ? 'bg-[var(--interactive-selection)] text-[var(--interactive-selectionForeground)]'
                          : 'hover:bg-[var(--interactive-hover)]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={diff.selected}
                        onChange={() => cs.toggleSelect(i)}
                        className="h-4 w-4 rounded accent-[var(--primary-base)]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="typography-ui-label text-sm truncate">{diff.key}</div>
                        <div className="typography-micro text-muted-foreground truncate">
                          {diff.source}
                        </div>
                      </div>
                    </label>
                  ))}
                  {cs.differences.length > 20 && (
                    <p className="typography-small text-muted-foreground px-3 py-1">
                      +{cs.differences.length - 20} more entries
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--interactive-border)] pt-4">
              <Button
                variant="default"
                size="sm"
                disabled={selectedCount === 0 || cs.pushing}
                onClick={() => void cs.pushSelected()}
              >
                {cs.pushing ? (
                  <Icon name="loader-4" className="h-4 w-4 animate-spin mr-1" />
                ) : null}
                Push Selected ({selectedCount})
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={cs.differences.length === 0 || cs.pushing}
                onClick={() => void cs.pushAll()}
              >
                Push All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={cs.pulling}
                onClick={() => void cs.pullFromRemote()}
              >
                {cs.pulling ? (
                  <Icon name="loader-4" className="h-4 w-4 animate-spin mr-1" />
                ) : null}
                Pull from Remote
              </Button>
            </div>
          </>
        )}

        {cs.error && (
          <div className="rounded-lg border border-[var(--status-errorBorder)] bg-[var(--status-errorBackground)] p-3">
            <span className="typography-small text-[var(--status-error)]">{cs.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { usePresetsStore } from '@/stores/usePresetsStore';

export function PresetsPage() {
  const { t } = useI18n();
  const presets = usePresetsStore((s) => s.presets);
  const applying = usePresetsStore((s) => s.applying);
  const applyingId = usePresetsStore((s) => s.applyingId);
  const previewData = usePresetsStore((s) => s.previewData);
  const previewPreset = usePresetsStore((s) => s.previewPreset);
  const applyPreset = usePresetsStore((s) => s.applyPreset);
  const closePreview = usePresetsStore((s) => s.closePreview);
  const saveAsPreset = usePresetsStore((s) => s.saveAsPreset);
  const error = usePresetsStore((s) => s.error);

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="typography-ui-header font-semibold text-foreground mb-1">
            {t('settings.page.configPresets.title')}
          </h1>
          <p className="typography-ui text-muted-foreground">
            One-click config templates. Apply a preset to set up providers, agents, plugins, and preferences at once.
          </p>
        </div>

        <div className="space-y-3">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="typography-ui-label font-medium text-foreground">{preset.name}</h3>
                  <p className="typography-small text-muted-foreground mt-1">{preset.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {preset.changes.map((change) => (
                      <span
                        key={change}
                        className="typography-micro px-1.5 py-0.5 rounded bg-[var(--surface-muted)] text-muted-foreground"
                      >
                        {change}
                      </span>
                    ))}
                  </div>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  disabled={applying}
                  onClick={() => previewPreset(preset, 'user')}
                >
                  {applying && applyingId === preset.id ? (
                    <Icon name="loader-4" className="h-4 w-4 animate-spin" />
                  ) : (
                    'Preview & Apply'
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--interactive-border)] pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="typography-ui-label font-medium text-foreground">Export</h3>
              <p className="typography-small text-muted-foreground">
                Save your current config as a reusable preset file.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={saveAsPreset}>
              <Icon name="download" className="h-4 w-4 mr-1" />
              Export Config
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-[var(--status-errorBorder)] bg-[var(--status-errorBackground)] p-3">
            <span className="typography-small text-[var(--status-error)]">{error}</span>
          </div>
        )}
      </div>

      {/* Preview dialog */}
      {previewData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-[var(--surface-elevated)] rounded-xl border border-[var(--interactive-border)] w-full max-w-lg max-h-[80vh] overflow-y-auto p-6 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="typography-ui-header font-semibold text-foreground">
                  Apply Preset: {previewData.preset.name}
                </h2>
                <p className="typography-small text-muted-foreground mt-1">
                  The following changes will be written to your config.
                </p>
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="p-1 text-muted-foreground hover:text-foreground"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 mb-6">
              {previewData.preset.changes.map((change) => (
                <div
                  key={change}
                  className="flex items-center gap-2 typography-ui-label text-sm"
                >
                  <span className="text-[var(--status-info)]">+</span>
                  <code className="bg-[var(--surface-muted)] px-1.5 py-0.5 rounded text-xs">{change}</code>
                </div>
              ))}
              <div className="typography-small text-muted-foreground mt-2 pt-2 border-t border-[var(--interactive-border)]">
                Scope: {previewData.scope === 'user' ? 'Global (~/.config/opencode/)' : previewData.scope}
              </div>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={closePreview}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={applying}
                onClick={() => void applyPreset()}
              >
                {applying ? (
                  <Icon name="loader-4" className="h-4 w-4 animate-spin mr-1" />
                ) : null}
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { usePermissionsStore, type ToolPermissionValue } from '@/stores/usePermissionsStore';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { cn } from '@/lib/utils';

const ACTIONS: { value: ToolPermissionValue; label: string; color: string }[] = [
  { value: 'ask', label: 'Ask', color: 'var(--status-warning)' },
  { value: 'allow', label: 'Allow', color: 'var(--status-success)' },
  { value: 'deny', label: 'Deny', color: 'var(--status-error)' },
];

export function PermissionsPage({
  selectedTool: initialTool,
}: {
  selectedTool?: string;
}) {
  const { t } = useI18n();
  const store = usePermissionsStore();
  const [selectedTool, setSelectedTool] = useState<string>(initialTool ?? 'bash');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialTool) setSelectedTool(initialTool);
  }, [initialTool]);

  useEffect(() => {
    store.loadPermissions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentRule = store.global[selectedTool];

  const handleSetRule = async (rule: ToolPermissionValue) => {
    setSaving(true);
    try {
      await store.setToolPermission(selectedTool, rule);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await store.setBulkPermissions(store.global, store.agents);
    setSaving(false);
    toast.success('Permissions saved');
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 max-w-2xl">
          <h1 className="typography-ui-header font-semibold text-foreground mb-1">
            {t('settings.page.permissions.title')}
          </h1>
          <p className="typography-ui text-muted-foreground mb-6">
            Configure which tools the agent can use and whether they require confirmation.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="typography-ui-label text-foreground w-24 shrink-0">
                Rule for {selectedTool}
              </span>
              <div className="flex items-center gap-1">
                {ACTIONS.map((action) => (
                  <button
                    key={action.value}
                    type="button"
                    onClick={() => handleSetRule(action.value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                      currentRule === action.value
                        ? 'bg-[var(--interactive-selection)] text-[var(--interactive-selectionForeground)]'
                        : 'text-muted-foreground hover:bg-[var(--interactive-hover)] hover:text-foreground',
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: action.color }}
                    />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            {currentRule === 'ask' && (
              <div className="rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-3">
                <div className="flex items-center gap-2">
                  <Icon name="information" className="h-4 w-4 text-[var(--status-info)]" />
                  <span className="typography-small text-muted-foreground">
                    The agent will ask for permission before using this tool.
                  </span>
                </div>
              </div>
            )}

            {currentRule === 'deny' && (
              <div className="rounded-lg border border-[var(--status-errorBorder)] bg-[var(--status-errorBackground)] p-3">
                <div className="flex items-center gap-2">
                  <Icon name="error-warning" className="h-4 w-4 text-[var(--status-error)]" />
                  <span className="typography-small text-[var(--status-errorForeground)]">
                    The agent will not be able to use this tool.
                  </span>
                </div>
              </div>
            )}

            {currentRule === 'allow' && (
              <div className="rounded-lg border border-[var(--status-successBorder)] bg-[var(--status-successBackground)] p-3">
                <div className="flex items-center gap-2">
                  <Icon name="check" className="h-4 w-4 text-[var(--status-success)]" />
                  <span className="typography-small text-[var(--status-successForeground)]">
                    The agent can use this tool without confirmation.
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--interactive-border)] mt-8 pt-4">
            <div className="flex items-center justify-between">
              <span className="typography-ui-label text-foreground">Agent Overrides</span>
              <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Icon name="loader-4" className="h-4 w-4 animate-spin mr-1" />
                    Saving…
                  </>
                ) : (
                  'Save All'
                )}
              </Button>
            </div>

            <div className="mt-3 space-y-1">
              {Object.entries(store.agents).length === 0 ? (
                <p className="typography-small text-muted-foreground py-2">
                  No agent-specific overrides configured. All agents use global rules.
                </p>
              ) : (
                Object.entries(store.agents).map(([agentName, rules]) => (
                  <div
                    key={agentName}
                    className="flex items-center gap-3 rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-2"
                  >
                    <span className="typography-ui-label text-foreground w-24 truncate">{agentName}</span>
                    <div className="flex-1 flex items-center gap-1 flex-wrap">
                      {Object.entries(rules).slice(0, 4).map(([tool, rule]) => (
                        <span
                          key={tool}
                          className="typography-micro px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor:
                              rule === 'allow'
                                ? 'var(--status-successBackground)'
                                : rule === 'deny'
                                  ? 'var(--status-errorBackground)'
                                  : 'var(--status-warningBackground)',
                            color:
                              rule === 'allow'
                                ? 'var(--status-successForeground)'
                                : rule === 'deny'
                                  ? 'var(--status-errorForeground)'
                                  : 'var(--status-warningForeground)',
                          }}
                        >
                          {tool}: {rule}
                        </span>
                      ))}
                      {Object.keys(rules).length > 4 && (
                        <span className="typography-micro text-muted-foreground">
                          +{Object.keys(rules).length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

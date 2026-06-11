import { useState, useCallback } from 'react';
import { SettingsSidebarLayout } from '@/components/sections/shared/SettingsSidebarLayout';
import { SettingsSidebarItem } from '@/components/sections/shared/SettingsSidebarItem';
import { usePermissionsStore, type ToolPermissionValue } from '@/stores/usePermissionsStore';

const TOOLS: { slug: string; label: string }[] = [
  { slug: 'read', label: 'Read' },
  { slug: 'edit', label: 'Edit' },
  { slug: 'glob', label: 'Glob' },
  { slug: 'grep', label: 'Grep' },
  { slug: 'list', label: 'List' },
  { slug: 'bash', label: 'Bash' },
  { slug: 'task', label: 'Task' },
  { slug: 'external_directory', label: 'External Dir' },
  { slug: 'todowrite', label: 'Todo Write' },
  { slug: 'question', label: 'Question' },
  { slug: 'webfetch', label: 'Web Fetch' },
  { slug: 'websearch', label: 'Web Search' },
  { slug: 'repo_clone', label: 'Repo Clone' },
  { slug: 'repo_overview', label: 'Repo Overview' },
  { slug: 'lsp', label: 'LSP' },
  { slug: 'doom_loop', label: 'Doom Loop' },
  { slug: 'skill', label: 'Skill' },
];

function ruleLabel(rule: ToolPermissionValue | undefined): string {
  switch (rule) {
    case 'allow': return 'Allow';
    case 'deny': return 'Deny';
    case 'ask': return 'Ask';
    default: return '—';
  }
}

function ruleDot(rule: ToolPermissionValue | undefined): string {
  switch (rule) {
    case 'allow': return 'var(--status-success)';
    case 'deny': return 'var(--status-error)';
    case 'ask': return 'var(--status-warning)';
    default: return 'var(--surface-mutedForeground)';
  }
}

export function PermissionsSidebar({ onItemSelect }: { onItemSelect?: () => void }) {
  const globalRules = usePermissionsStore((s) => s.global);
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = useCallback((slug: string) => {
    setSelected(slug);
    onItemSelect?.();
  }, [onItemSelect]);

  return (
    <SettingsSidebarLayout
      header={
        <div className="px-2">
          <span className="typography-ui-label font-medium text-foreground">Tools</span>
        </div>
      }
    >
      {TOOLS.map((tool) => (
        <SettingsSidebarItem
          key={tool.slug}
          icon={
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: ruleDot(globalRules[tool.slug]) }}
            />
          }
          title={tool.label}
          metadata={ruleLabel(globalRules[tool.slug])}
          selected={selected === tool.slug}
          onSelect={() => handleSelect(tool.slug)}
        />
      ))}
    </SettingsSidebarLayout>
  );
}

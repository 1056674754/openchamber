import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { AgentMemoryEntry, AgentMemoryScope, AgentMemoryType } from '@/lib/agentMemoryApi';
import type { ProjectRef } from '@/lib/projectContextApi';
import { cn } from '@/lib/utils';
import {
  EMPTY_AGENT_MEMORY_STORE_ENTRY,
  useAgentMemoryStore,
} from '@/stores/useAgentMemoryStore';

interface AgentMemorySectionProps {
  projectRef: ProjectRef;
  projectKey: string;
  query: string;
}

interface EditingMemory {
  scope: AgentMemoryScope;
  id: string;
  title: string;
  body: string;
  type: AgentMemoryType;
}

const matchesQuery = (entry: AgentMemoryEntry, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.title}\n${entry.body}\n${entry.type}`.toLowerCase().includes(needle);
};

const MemoryCard: React.FC<{
  entry: AgentMemoryEntry;
  scope: AgentMemoryScope;
  editing: EditingMemory | null;
  pendingDelete: string | null;
  saving: boolean;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onEditChange: (value: EditingMemory) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}> = ({
  entry,
  scope,
  editing,
  pendingDelete,
  saving,
  onBeginEdit,
  onCancelEdit,
  onEditChange,
  onSave,
  onDelete,
  onCancelDelete,
}) => {
  const { t } = useI18n();
  const isEditing = editing?.id === entry.id && editing.scope === scope;
  const deleteKey = `${scope}:${entry.id}`;
  const isConfirmingDelete = pendingDelete === deleteKey;

  if (isEditing && editing) {
    return (
      <div className="space-y-2 rounded-md border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-2">
        <Input
          value={editing.title}
          onChange={(event) => onEditChange({ ...editing, title: event.target.value })}
          maxLength={60}
          aria-label={t('rightSidebar.agentMemory.field.title')}
        />
        <Textarea
          value={editing.body}
          onChange={(event) => onEditChange({ ...editing, body: event.target.value })}
          maxLength={2000}
          className="min-h-24"
          aria-label={t('rightSidebar.agentMemory.field.body')}
        />
        <div className="flex items-center justify-between gap-2">
          <Select
            value={editing.type}
            onValueChange={(value) => onEditChange({ ...editing, type: value as AgentMemoryType })}
          >
            <SelectTrigger className="h-7 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['fact', 'preference', 'reference'] as const).map((type) => (
                <SelectItem key={type} value={type}>{t(`rightSidebar.agentMemory.type.${type}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button size="xs" variant="ghost" onClick={onCancelEdit} disabled={saving}>
              {t('settings.common.actions.cancel')}
            </Button>
            <Button
              size="xs"
              onClick={onSave}
              disabled={saving || !editing.title.trim() || !editing.body.trim()}
            >
              {saving ? t('settings.common.actions.saving') : t('settings.common.actions.saveChanges')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-md border p-2',
      entry.flagged
        ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)]'
        : 'border-[var(--interactive-border)] bg-[var(--surface-elevated)]',
    )}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate typography-ui-label font-medium text-foreground">{entry.title}</span>
            <span className="shrink-0 typography-micro text-muted-foreground">
              {t(`rightSidebar.agentMemory.type.${entry.type}`)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words typography-meta text-muted-foreground">{entry.body}</p>
          {entry.flagged ? (
            <p className="mt-1 typography-micro text-[var(--status-warning-foreground)]">
              {t('rightSidebar.agentMemory.flagged')}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={onBeginEdit}
            aria-label={t('rightSidebar.agentMemory.actions.edit')}
            title={t('rightSidebar.agentMemory.actions.edit')}
          >
            <Icon name="edit" className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant={isConfirmingDelete ? 'destructive' : 'ghost'}
            className="size-6"
            onClick={onDelete}
            aria-label={isConfirmingDelete
              ? t('rightSidebar.agentMemory.actions.confirmDelete')
              : t('rightSidebar.agentMemory.actions.delete')}
            title={isConfirmingDelete
              ? t('rightSidebar.agentMemory.actions.confirmDelete')
              : t('rightSidebar.agentMemory.actions.delete')}
          >
            <Icon name={isConfirmingDelete ? 'check' : 'delete-bin'} className="size-3.5" />
          </Button>
          {isConfirmingDelete ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={onCancelDelete}
              aria-label={t('settings.common.actions.cancel')}
              title={t('settings.common.actions.cancel')}
            >
              <Icon name="close" className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const AgentMemorySection: React.FC<AgentMemorySectionProps> = ({ projectRef, projectKey, query }) => {
  const { t } = useI18n();
  const state = useAgentMemoryStore((store) => store.entries[projectKey] ?? EMPTY_AGENT_MEMORY_STORE_ENTRY);
  const load = useAgentMemoryStore((store) => store.load);
  const update = useAgentMemoryStore((store) => store.update);
  const remove = useAgentMemoryStore((store) => store.remove);
  const [editing, setEditing] = React.useState<EditingMemory | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const sections = ([
    { scope: 'project' as const, label: t('rightSidebar.agentMemory.scope.project'), entries: state.project, failed: state.projectFailed },
    { scope: 'global' as const, label: t('rightSidebar.agentMemory.scope.global'), entries: state.global, failed: state.globalFailed },
  ]).map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => matchesQuery(entry, query)),
  }));

  const handleSave = React.useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    const ok = await update(projectRef, editing.scope, editing.id, {
      title: editing.title.trim(),
      body: editing.body.trim(),
      type: editing.type,
    });
    setSaving(false);
    if (ok) setEditing(null);
    else toast.error(t('rightSidebar.agentMemory.toast.updateFailed'));
  }, [editing, projectRef, t, update]);

  const handleDelete = React.useCallback(async (scope: AgentMemoryScope, memoryId: string) => {
    const key = `${scope}:${memoryId}`;
    if (pendingDelete !== key) {
      setPendingDelete(key);
      return;
    }
    setSaving(true);
    const ok = await remove(projectRef, scope, memoryId);
    setSaving(false);
    setPendingDelete(null);
    if (!ok) toast.error(t('rightSidebar.agentMemory.toast.deleteFailed'));
  }, [pendingDelete, projectRef, remove, t]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="typography-meta text-muted-foreground">{t('rightSidebar.agentMemory.description')}</p>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => void load(projectRef, { force: true })}
          disabled={state.loading}
          aria-label={t('rightSidebar.agentMemory.actions.refresh')}
          title={t('rightSidebar.agentMemory.actions.refresh')}
        >
          <Icon name="refresh" className={cn('size-3.5', state.loading && 'animate-spin')} />
        </Button>
      </div>
      {state.error ? (
        <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-2 typography-meta text-[var(--status-error-foreground)]">
          {state.error}
        </div>
      ) : null}
      {sections.map((section) => (
        <section key={section.scope} className="space-y-2">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--interactive-border)] pb-1">
            <h4 className="typography-ui-label font-medium text-foreground">{section.label}</h4>
            <span className="typography-micro text-muted-foreground">{section.entries.length}</span>
          </div>
          {section.failed ? (
            <p className="typography-meta text-[var(--status-error-foreground)]">{t('rightSidebar.agentMemory.scopeFailed')}</p>
          ) : section.entries.length === 0 ? (
            <p className="typography-meta text-muted-foreground">
              {query.trim() ? t('rightSidebar.contextNotesTodo.search.noResults', { query: query.trim() }) : t('rightSidebar.agentMemory.empty')}
            </p>
          ) : section.entries.map((entry) => (
            <MemoryCard
              key={entry.id}
              entry={entry}
              scope={section.scope}
              editing={editing}
              pendingDelete={pendingDelete}
              saving={saving}
              onBeginEdit={() => {
                setPendingDelete(null);
                setEditing({
                  scope: section.scope,
                  id: entry.id,
                  title: entry.title,
                  body: entry.body,
                  type: entry.type,
                });
              }}
              onCancelEdit={() => setEditing(null)}
              onEditChange={setEditing}
              onSave={() => void handleSave()}
              onDelete={() => void handleDelete(section.scope, entry.id)}
              onCancelDelete={() => setPendingDelete(null)}
            />
          ))}
        </section>
      ))}
    </div>
  );
};

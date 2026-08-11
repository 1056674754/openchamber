import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';

import { SessionActivityDuration } from '@/components/session/SessionActivityDuration';
import { useSwitcherItems } from '@/components/session/sidebar/hooks/useSwitcherItems';
import { formatSessionCompactDateLabel } from '@/components/session/sidebar/utils';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { resolveSessionAuthority } from '@/sync/session-authority';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  refreshGlobalSessions,
  resolveGlobalSessionDirectory,
} from '@/stores/useGlobalSessionsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUnseenCount } from '@/sync/notification-store';
import { createSessionActivityKey } from '@/sync/session-activity-key';
import { useHasSessionActivityDuration } from '@/sync/session-activity-timing';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useAllServersActiveSessionKeys } from '@/sync/multi-server-hooks';

type SwitcherRowProps = {
  readonly session: Session;
  readonly projectLabel: string | null;
  readonly branchLabel: string | null;
  readonly active: boolean;
  readonly activeSessionKeys: ReadonlySet<string>;
  readonly onSelect: () => void;
};

const SwitcherRow: React.FC<SwitcherRowProps> = ({
  session,
  projectLabel,
  branchLabel,
  active,
  activeSessionKeys,
  onSelect,
}) => {
  const { t } = useI18n();
  const serverId = serverRegistry.getServerForSession(session.id)
    ?? resolveSessionAuthority(session.id).serverId
    ?? DEFAULT_SERVER_ID;
  const directory = resolveGlobalSessionDirectory(session);
  const isStreaming = activeSessionKeys.has(createSessionActivityKey(serverId, directory, session.id));
  const localUnseenCount = useSessionUnseenCount(session.id);
  const showUnread = serverId === DEFAULT_SERVER_ID && !isStreaming && !active && localUnseenCount > 0;
  const hasActivityDuration = useHasSessionActivityDuration(serverId, directory ?? '', session.id, isStreaming);
  const showActivityDuration = (isStreaming || showUnread) && hasActivityDuration;
  const title = session.title?.trim() || t('sessions.sidebar.session.untitled');
  const meta = [projectLabel, branchLabel].filter(Boolean).join(' · ');
  const timeLabel = formatSessionCompactDateLabel(session.time?.updated ?? session.time?.created ?? 0);

  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
        active && 'bg-interactive-selection text-interactive-selection-foreground',
      )}
      onClick={onSelect}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate typography-ui-label">{title}</span>
        {meta ? <span className="truncate typography-micro text-muted-foreground">{meta}</span> : null}
      </span>
      {isStreaming || showUnread ? (
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            isStreaming ? 'bg-primary' : 'bg-status-info',
          )}
          aria-hidden
        />
      ) : null}
      {showActivityDuration ? (
        <SessionActivityDuration
          serverId={serverId}
          directory={directory ?? ''}
          sessionId={session.id}
          running={isStreaming}
          className="typography-micro"
        />
      ) : timeLabel ? (
        <span className="shrink-0 typography-micro tabular-nums text-muted-foreground">{timeLabel}</span>
      ) : null}
    </button>
  );
};

type MobileSessionSwitcherPopoverProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly anchorRef: React.RefObject<HTMLElement | null>;
};

export const MobileSessionSwitcherPopover: React.FC<MobileSessionSwitcherPopoverProps> = ({
  open,
  onClose,
  anchorRef,
}) => {
  const { t } = useI18n();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);
  const items = useSwitcherItems(open, { maxParents: 10 });
  const activeSessionKeys = useAllServersActiveSessionKeys({ enabled: open });

  React.useEffect(() => {
    if (!open) return;
    void refreshGlobalSessions();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [anchorRef, onClose, open]);

  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 top-[var(--oc-header-height,56px)] z-50">
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('sessions.switcher.openAria')}
        className="pointer-events-auto mx-3 mt-2 max-h-[min(72dvh,calc(100dvh-var(--oc-header-height,56px)-1rem))] overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-lg"
      >
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center typography-ui-label text-muted-foreground">
            {t('sessions.switcher.empty')}
          </p>
        ) : items.map((item) => {
          const session = item.node.session;
          const serverId = serverRegistry.getServerForSession(session.id)
            ?? resolveSessionAuthority(session.id).serverId
            ?? null;
          const directory = resolveGlobalSessionDirectory(session);
          return (
            <SwitcherRow
              key={`${serverId}:${directory ?? ''}:${session.id}`}
              session={session}
              projectLabel={item.secondaryMeta?.projectLabel ?? null}
              branchLabel={item.secondaryMeta?.branchLabel ?? null}
              active={session.id === currentSessionId}
              activeSessionKeys={activeSessionKeys}
              onSelect={() => {
                if (item.projectId) setActiveProjectIdOnly(item.projectId);
                setCurrentSession(session.id, directory, serverId ? { serverId } : undefined);
                onClose();
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

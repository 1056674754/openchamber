import React from 'react';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import ChatMessage from '@/components/chat/ChatMessage';
import { ComposerFloatingPanel } from '@/components/chat/composer/ui/ComposerFloatingPanel';
import { ChatSurfaceProvider } from '@/components/chat/ChatSurfaceContext';
import { PermissionCard } from '@/components/chat/PermissionCard';
import { LegacyFormCard } from '@/components/chat/LegacyFormCard';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import {
  destroyBtwSession,
  filterBtwTailMessages,
  promoteBtwSession,
  type BtwSessionRef,
} from '@/lib/btw';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useBtwStore } from '@/stores/useBtwStore';
import {
  useSessionMessageRecords,
  useSessionPermissions,
  useSessionForms,
  useSessionStatus,
} from '@/sync/sync-context';
import type { StreamPhase } from '@/components/chat/message/types';
import { useStreamingStore } from '@/sync/streaming';
import { useSync } from '@/sync/use-sync';

import type { BtwPanelState } from './useBtwPanelState';

const IDLE_SESSION_STATUS = { type: 'idle' as const };

export const BtwPanel: React.FC<{ parentSessionId: string; panel: BtwPanelState }> = ({
  parentSessionId,
  panel,
}) => {
  const { t } = useI18n();
  if (panel.btwSessionId && panel.btwDirectory) {
    return (
      <BtwSheet
        sessionRef={{
          parentSessionId,
          btwSessionId: panel.btwSessionId,
          directory: panel.btwDirectory,
        }}
        title={panel.btwSession?.title?.trim() || t('chat.btw.titleFallback')}
        boundaryMessageID={panel.boundaryMessageID}
        collapsed={panel.collapsed}
      />
    );
  }
  if (!panel.creating) return null;
  return (
    <BtwFrame title={t('chat.btw.titleFallback')}>
      <div className="flex items-center gap-2 px-4 py-4 typography-meta text-muted-foreground">
        <Icon name="loader-4" className="size-4 animate-spin" />
        <span>{t('chat.btw.loading')}</span>
      </div>
    </BtwFrame>
  );
};

type BtwSessionData = {
  messageRecords: Array<{ info: Message; parts: Part[] }>;
  sessionIsWorking: boolean;
  streamingMessageId: string | null;
  activeStreamingPhase: StreamPhase | null;
  sessionPermissions: ReturnType<typeof useSessionPermissions>;
  sessionForms: ReturnType<typeof useSessionForms>;
  isEmpty: boolean;
};

const useBtwSessionData = (
  sessionId: string,
  directory: string,
  boundaryMessageID: string | null,
): BtwSessionData => {
  const sync = useSync();
  React.useEffect(() => {
    void sync.ensureSessionRenderable(sessionId, false);
  }, [sessionId, sync]);

  const messageRecords = useSessionMessageRecords(sessionId, directory);
  const status = useSessionStatus(sessionId, directory) ?? IDLE_SESSION_STATUS;
  const streamingMessageId = useStreamingStore(
    React.useCallback((state) => state.streamingMessageIds.get(sessionId) ?? null, [sessionId]),
  );
  const activeStreamingPhase = useStreamingStore(
    React.useCallback(
      (state) => (streamingMessageId ? state.messageStreamStates.get(streamingMessageId)?.phase ?? null : null),
      [streamingMessageId],
    ),
  );
  const sessionPermissions = useSessionPermissions(sessionId, directory);
  const sessionForms = useSessionForms(sessionId, directory);
  const tailRecords = React.useMemo(
    () => filterBtwTailMessages(messageRecords, boundaryMessageID),
    [boundaryMessageID, messageRecords],
  );
  const sessionIsWorking = React.useMemo(() => {
    if (sessionPermissions.length > 0 || sessionForms.length > 0) return false;
    if (status.type === 'busy' || status.type === 'retry') return true;
    const last = tailRecords[tailRecords.length - 1]?.info;
    return Boolean(last && last.role === 'assistant' && last.time.completed === undefined);
  }, [sessionPermissions.length, sessionForms.length, status.type, tailRecords]);

  return {
    messageRecords: tailRecords,
    sessionIsWorking,
    streamingMessageId,
    activeStreamingPhase,
    sessionPermissions,
    sessionForms,
    isEmpty: tailRecords.length === 0,
  };
};

const useEscapeToCollapse = (onCollapse: () => void): void => {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      onCollapse();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCollapse]);
};

const useAutoScroll = (
  bodyRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLDivElement | null>,
  contentReady: boolean,
) => {
  const stickToBottomRef = React.useRef(true);
  React.useEffect(() => {
    if (!contentReady) return;
    const body = bodyRef.current;
    const content = contentRef.current;
    if (body && stickToBottomRef.current) body.scrollTop = body.scrollHeight;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const current = bodyRef.current;
      if (current && stickToBottomRef.current) current.scrollTop = current.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [bodyRef, contentReady, contentRef]);
  return React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }, []);
};

const useBtwPanelMaxHeight = (bodyRef: React.RefObject<HTMLDivElement | null>): number | undefined => {
  const [maxHeight, setMaxHeight] = React.useState<number>();
  React.useLayoutEffect(() => {
    const update = () => {
      const body = bodyRef.current;
      if (!body) return;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const available = body.getBoundingClientRect().bottom - viewportTop - 64;
      setMaxHeight(Math.max(120, Math.min(520, Math.floor(available))));
    };
    update();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [bodyRef]);
  return maxHeight;
};

const BtwFrame: React.FC<{
  title: string;
  actions?: React.ReactNode;
  onTitleClick?: () => void;
  titleClickLabel?: string;
  collapsed?: boolean;
  headerSpinner?: boolean;
  children?: React.ReactNode;
}> = ({ title, actions, onTitleClick, titleClickLabel, collapsed, headerSpinner, children }) => (
  <ComposerFloatingPanel role="dialog" ariaLabel="btw" compact={collapsed} header={<>
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            aria-label={titleClickLabel}
            title={titleClickLabel}
            className="flex min-w-0 items-center gap-2 text-left text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon name={headerSpinner ? 'loader-4' : 'chat-ai-3'} className={cn('size-3.5 shrink-0', headerSpinner && 'animate-spin')} />
            <span className="min-w-0 truncate typography-ui-label font-semibold">{title}</span>
            <Icon name={collapsed ? 'arrow-up-s' : 'arrow-down-s'} className="size-4 shrink-0" />
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <Icon name="chat-ai-3" className="size-3.5 shrink-0" />
            <h2 className="min-w-0 truncate typography-ui-label font-semibold">{title}</h2>
          </span>
        )}
        <div className="min-w-0 flex-1" />
        {actions}
  </>}>
    {children ? <>{children}<div className="h-2" /></> : null}
  </ComposerFloatingPanel>
);

const BtwSheet: React.FC<{
  sessionRef: BtwSessionRef;
  title: string;
  boundaryMessageID: string | null;
  collapsed: boolean;
}> = ({ sessionRef, title, boundaryMessageID, collapsed }) => {
  const { t } = useI18n();
  const setCollapsed = React.useCallback((value: boolean) => {
    useBtwStore.getState().setPanelState(sessionRef.parentSessionId, { collapsed: value });
  }, [sessionRef.parentSessionId]);
  const collapse = React.useCallback(() => setCollapsed(true), [setCollapsed]);
  useEscapeToCollapse(collapse);
  const destroy = React.useCallback(() => {
    void destroyBtwSession(sessionRef).then((ok) => {
      if (!ok) toast.error(t('chat.btw.toast.destroyFailed'));
    });
  }, [sessionRef, t]);
  const promote = React.useCallback(() => {
    void promoteBtwSession(sessionRef).catch(() => toast.error(t('chat.btw.toast.promoteFailed')));
  }, [sessionRef, t]);
  const toggleLabel = collapsed ? t('chat.btw.expandAria') : t('chat.btw.collapseAria');
  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={promote} aria-label={t('chat.btw.promoteAria')} title={t('chat.btw.promoteAria')}>
        <Icon name="external-link" className="size-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={destroy} aria-label={t('chat.btw.destroyAria')} title={t('chat.btw.destroyAria')}>
        <Icon name="close" className="size-4" />
      </Button>
    </div>
  );

  if (collapsed) {
    return (
      <BtwCollapsedStrip
        sessionRef={sessionRef}
        title={title}
        actions={actions}
        onExpand={() => setCollapsed(false)}
        expandLabel={toggleLabel}
      />
    );
  }
  return (
    <BtwExpandedSheet
      sessionRef={sessionRef}
      title={title}
      boundaryMessageID={boundaryMessageID}
      actions={actions}
      onTitleClick={() => setCollapsed(true)}
      titleClickLabel={toggleLabel}
    />
  );
};

const BtwCollapsedStrip: React.FC<{
  sessionRef: BtwSessionRef;
  title: string;
  actions: React.ReactNode;
  onExpand: () => void;
  expandLabel: string;
}> = ({ sessionRef, title, actions, onExpand, expandLabel }) => {
  const status = useSessionStatus(sessionRef.btwSessionId, sessionRef.directory) ?? IDLE_SESSION_STATUS;
  return (
    <BtwFrame
      title={title}
      actions={actions}
      onTitleClick={onExpand}
      titleClickLabel={expandLabel}
      collapsed
      headerSpinner={status.type === 'busy' || status.type === 'retry'}
    />
  );
};

const BtwExpandedSheet: React.FC<{
  sessionRef: BtwSessionRef;
  title: string;
  boundaryMessageID: string | null;
  actions: React.ReactNode;
  onTitleClick: () => void;
  titleClickLabel: string;
}> = ({ sessionRef, title, boundaryMessageID, actions, onTitleClick, titleClickLabel }) => {
  const data = useBtwSessionData(sessionRef.btwSessionId, sessionRef.directory, boundaryMessageID);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const onScroll = useAutoScroll(bodyRef, contentRef, !data.isEmpty);
  const maxHeight = useBtwPanelMaxHeight(bodyRef);
  return (
    <BtwFrame title={title} actions={actions} onTitleClick={onTitleClick} titleClickLabel={titleClickLabel}>
      <ChatSurfaceProvider mode="peek">
        <BtwMessages data={data} bodyRef={bodyRef} contentRef={contentRef} onScroll={onScroll} maxHeight={maxHeight} />
      </ChatSurfaceProvider>
    </BtwFrame>
  );
};

const BtwMessages: React.FC<{
  data: BtwSessionData;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  maxHeight?: number;
}> = ({ data, bodyRef, contentRef, onScroll, maxHeight }) => {
  const { t } = useI18n();
  if (data.isEmpty) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 typography-meta text-muted-foreground">
        <Icon name="loader-4" className="size-4 animate-spin" />
        <span>{t('chat.btw.loading')}</span>
      </div>
    );
  }
  return (
    <ScrollShadow
      ref={bodyRef}
      onScroll={onScroll}
      size={32}
      data-scroll-shadow="true"
      className="max-h-[min(55vh,520px)] min-h-0 overflow-y-auto px-3 py-1"
      style={maxHeight === undefined ? undefined : { maxHeight }}
    >
      <div ref={contentRef}>
        {data.messageRecords.map((record, index) => (
          <ChatMessage
            key={record.info.id}
            message={record}
            previousMessage={data.messageRecords[index - 1]}
            nextMessage={data.messageRecords[index + 1]}
            isInActiveTurn={index === data.messageRecords.length - 1}
            activeStreamingPhase={record.info.id === data.streamingMessageId ? data.activeStreamingPhase : null}
          />
        ))}
        {data.sessionForms.map((form) => <LegacyFormCard key={form.id} form={form} />)}
        {data.sessionPermissions.map((permission) => <PermissionCard key={permission.id} permission={permission} />)}
        <div className={cn('flex items-center gap-2 px-1 py-2 typography-meta text-muted-foreground', !data.sessionIsWorking && 'invisible')} aria-hidden={!data.sessionIsWorking}>
          <Icon name="loader-4" className="size-3.5 animate-spin" />
          <span>{t('chat.btw.working')}</span>
        </div>
      </div>
    </ScrollShadow>
  );
};

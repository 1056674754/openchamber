import React from 'react';
import type { Message, Part, Session } from '@opencode-ai/sdk/v2';

import { ChatInput } from './ChatInput';
import { useUIStore } from '@/stores/useUIStore';
import { Skeleton } from '@/components/ui/skeleton';
import ChatEmptyState from './ChatEmptyState';
import { DraftPresetChips } from './DraftPresetChips';
import type { ResolvedStarter } from './useDraftStarters';
import MessageList, { type MessageListHandle } from './MessageList';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';
import { SessionRecapNote } from './SessionRecapNote';
import { StatusRowContainer } from './StatusRowContainer';
import ScrollToBottomButton from './components/ScrollToBottomButton';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { useChatAutoFollow, type AnimationHandlers, type ContentChangeReason } from '@/hooks/useChatAutoFollow';
import { useChatTimelineController } from './hooks/useChatTimelineController';
import { TimelineDialog } from './TimelineDialog';
import { useChatTurnNavigation } from './hooks/useChatTurnNavigation';
import { useCompletePromptHistory } from './hooks/useCompletePromptHistory';
import { PromptNavigatorRail } from './components/PromptNavigatorRail';
import {
    buildPromptPreviews,
    createPromptPreviewCache,
    resolvePromptNavigatorActiveTurnId,
    resolvePromptNavigatorVisibleTurnIds,
} from './lib/promptNavigatorModel';
import { useDeviceInfo } from '@/lib/device';
import { Button } from '@/components/ui/button';
import { OverlayScrollbar } from '@/components/ui/OverlayScrollbar';
import { Icon } from "@/components/icon/Icon";
import type { PermissionRequest } from '@/types/permission';
import type { QuestionRequest } from '@/types/question';
import { cn } from '@/lib/utils';
import {
    collectVisibleSessionIdsForBlockingRequests,
    collectVisibleToolRequestKeys,
    splitBlockingRequestsByVisibleTool,
} from './lib/blockingRequests';
import { InlineBlockingRequestsContext } from './InlineBlockingRequestsContext';

// New sync system imports
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useStreamingStore } from '@/sync/streaming';
import {
    useSessionMessageCount,
    useSessionMessageRecords,
    useSessionDirectory,
    useSessionMessagesRenderable,
    useSessions,
    useSyncDirectory,
    useSessionStatus,
} from '@/sync/sync-context';
import {
    useServerLiveSessions,
    useServerSessionPermissions,
    useServerSessionQuestions,
} from '@/sync/multi-server-hooks';
import { useActiveServerId } from '@/hooks/useActiveServerId';
import { useSync } from '@/sync/use-sync';
import { useInputStore } from '@/sync/input-store';
import { getSessionPrefetch, subscribeSessionPrefetch } from '@/sync/session-prefetch-cache';
import { usePlanDetection } from '@/hooks/usePlanDetection';
import { getAllSyncSessions } from '@/sync/sync-refs';
import { useI18n } from '@/lib/i18n';
import { useCurrentSessionActivity } from '@/hooks/useSessionActivity';
import { useSessionStatusWatchdog } from '@/hooks/useSessionStatusWatchdog';
import { CHAT_BOTTOM_SPACER_DESKTOP_PX, CHAT_BOTTOM_SPACER_MOBILE_PX } from './lib/scroll/bottomSpacing';
import { resolvePromptReadOnly } from '@/lib/subagentPrompting';
import { getEmbeddedSessionChatOriginSessionId } from '@/components/layout/contextPanelEmbeddedChat';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { isVSCodeRuntime } from '@/lib/desktop';
import { resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { resolveSessionEntryScrollAction } from './lib/scroll/scrollIntent';

const EMPTY_MESSAGES: Array<{ info: Message; parts: Part[] }> = [];
const IDLE_SESSION_STATUS = { type: 'idle' as const };
const CHAT_FORCE_SCROLL_BOTTOM_EVENT = 'openchamber:chat-force-scroll-bottom';
const DEFAULT_RETRY_MESSAGE = 'Quota limit reached. Retrying automatically.';
const CHAT_SCROLL_STYLE = {
    overflowAnchor: 'none',
    overscrollBehavior: 'contain',
    overscrollBehaviorY: 'contain',
} as const;
const CHAT_NAVIGATION_IGNORED_TARGET_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="combobox"]',
    '[role="dialog"]',
    '[role="listbox"]',
    '[role="menu"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="textbox"]',
    '[data-radix-popper-content-wrapper]',
].join(',');
type SessionMessageRecord = { info: Message; parts: Part[] };

const isHTMLElement = (target: EventTarget | null): target is HTMLElement => {
    return target instanceof HTMLElement;
};

const shouldIgnoreChatNavigationTarget = (target: EventTarget | null): boolean => {
    if (!isHTMLElement(target)) {
        return false;
    }

    return Boolean(target.closest(CHAT_NAVIGATION_IGNORED_TARGET_SELECTOR));
};

const shouldIgnoreChatNavigationForFocus = (activeElement: Element | null, scrollContainer: HTMLElement | null): boolean => {
    if (typeof document === 'undefined') {
        return true;
    }

    if (!activeElement || activeElement === document.body || activeElement === document.documentElement) {
        return true;
    }

    if (shouldIgnoreChatNavigationTarget(activeElement)) {
        return true;
    }

    return !scrollContainer?.contains(activeElement);
};

const hasBlockingChatOverlay = (): boolean => {
    const {
        isAboutDialogOpen,
        isCommandPaletteOpen,
        isHelpDialogOpen,
        isImagePreviewOpen,
        isMultiRunLauncherOpen,
        isSessionSwitcherOpen,
        isSettingsDialogOpen,
    } = useUIStore.getState();

    return isAboutDialogOpen
        || isCommandPaletteOpen
        || isHelpDialogOpen
        || isImagePreviewOpen
        || isMultiRunLauncherOpen
        || isSessionSwitcherOpen
        || isSettingsDialogOpen;
};

type HydratingToolSkeletonRow = {
    id: string;
    titleWidth: string;
    detailWidth: string;
};

type ChatViewportProps = {
    currentSessionId: string;
    sessionDirectory?: string | null;
    isDesktopExpandedInput: boolean;
    isMobile: boolean;
    stickyUserHeader: boolean;
    showPromptNavigator: boolean;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    messageListRef: React.RefObject<MessageListHandle | null>;
    turnStart: number;
    pendingRevealWork: boolean;
    renderedMessages: SessionMessageRecord[];
    hasMoreAboveTurns: boolean;
    isLoadingOlder: boolean;
    sessionIsWorking: boolean;
    streamingMessageId: string | null;
    activeStreamingPhase: import('./message/types').StreamPhase | null;
    retryOverlay: {
        sessionId: string;
        message: string;
        confirmedAt?: number;
        fallbackTimestamp?: number;
    } | null;
    handleMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    handleLoadOlder: (options: { userInitiated: boolean }) => Promise<void>;
    syncPendingPrependAnchorToViewport: () => void;
    scrollToBottom: () => void;
    notifyViewportStabilize: () => void;
    sessionQuestions: QuestionRequest[];
    sessionPermissions: PermissionRequest[];
    inlineBlockingRequestsByTool: ReturnType<typeof splitBlockingRequestsByVisibleTool>['inlineByTool'];
    isProgrammaticFollowActive: boolean;
    promptHistoryRecords: readonly SessionMessageRecord[];
    activeTurnId: string | null;
    visibleTurnIds: string[];
    timelineTurnIds: string[];
    onSelectTurn: (turnId: string) => void;
    canLoadEarlierPrompts: boolean;
    isInitialScrollReady: boolean;
    initialScrollAction: 'wait' | 'hash' | 'latest';
    onInitialScrollReady: () => void;
};

const ChatViewport = React.memo(({
    currentSessionId,
    sessionDirectory = null,
    isDesktopExpandedInput,
    isMobile,
    stickyUserHeader,
    showPromptNavigator,
    scrollRef,
    messageListRef,
    turnStart,
    pendingRevealWork,
    renderedMessages,
    hasMoreAboveTurns,
    isLoadingOlder,
    sessionIsWorking,
    streamingMessageId,
    activeStreamingPhase,
    retryOverlay,
    handleMessageContentChange,
    getAnimationHandlers,
    handleLoadOlder,
    syncPendingPrependAnchorToViewport,
    scrollToBottom,
    sessionQuestions,
    sessionPermissions,
    inlineBlockingRequestsByTool,
    isProgrammaticFollowActive,
    promptHistoryRecords,
    activeTurnId,
    visibleTurnIds,
    timelineTurnIds,
    onSelectTurn,
    canLoadEarlierPrompts,
    isInitialScrollReady,
    initialScrollAction,
    onInitialScrollReady,
}: ChatViewportProps) => {
    useSessionStatusWatchdog(currentSessionId);
    const promptPreviewCache = React.useRef(createPromptPreviewCache());
    const promptSourceMessages = React.useMemo(() => {
        if (promptHistoryRecords.length === 0) return renderedMessages;
        const byMessageID = new Map<string, SessionMessageRecord>();
        for (const record of promptHistoryRecords) byMessageID.set(record.info.id, record);
        for (const record of renderedMessages) byMessageID.set(record.info.id, record);
        return [...byMessageID.values()].sort((left, right) => left.info.id.localeCompare(right.info.id));
    }, [promptHistoryRecords, renderedMessages]);
    const promptPreviewsByTurnId = React.useMemo(
        () => buildPromptPreviews(promptSourceMessages, promptPreviewCache.current),
        [promptSourceMessages],
    );
    const promptTurnIds = React.useMemo(
        () => [...promptPreviewsByTurnId.keys()],
        [promptPreviewsByTurnId],
    );
    const promptVisibleTurnIds = React.useMemo(
        () => resolvePromptNavigatorVisibleTurnIds(
            timelineTurnIds,
            promptPreviewsByTurnId,
            visibleTurnIds,
        ),
        [promptPreviewsByTurnId, timelineTurnIds, visibleTurnIds],
    );
    const promptActiveTurnId = React.useMemo(
        () => resolvePromptNavigatorActiveTurnId(timelineTurnIds, promptPreviewsByTurnId, activeTurnId)
            ?? promptVisibleTurnIds[0]
            ?? null,
        [activeTurnId, promptPreviewsByTurnId, promptVisibleTurnIds, timelineTurnIds],
    );
    const focusScrollContainer = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
        if (event.defaultPrevented || shouldIgnoreChatNavigationTarget(event.target)) {
            return;
        }

        if (typeof window !== 'undefined' && window.getSelection()?.type === 'Range') {
            return;
        }

        scrollRef.current?.focus({ preventScroll: true });
    }, [scrollRef]);

    React.useLayoutEffect(() => {
        if (!isInitialScrollReady && initialScrollAction === 'hash') {
            onInitialScrollReady();
        }
    }, [initialScrollAction, isInitialScrollReady, onInitialScrollReady]);

    // Collect callIDs of ALL pending questions (inline + trailing) so the
    // question recovery mechanism in ToolPart can avoid creating a duplicate
    // card when the question is already rendered as trailing or inline.
    const pendingQuestionCallIDs = React.useMemo(() => {
        const callIDs = new Set<string>();
        for (const bucket of inlineBlockingRequestsByTool.values()) {
            for (const question of bucket.questions) {
                const callID = question.tool?.callID;
                if (typeof callID === 'string' && callID.length > 0) {
                    callIDs.add(callID);
                }
            }
        }
        for (const question of sessionQuestions) {
            const callID = question.tool?.callID;
            if (typeof callID === 'string' && callID.length > 0) {
                callIDs.add(callID);
            }
        }
        return callIDs;
    }, [inlineBlockingRequestsByTool, sessionQuestions]);

    return (
        <div
            className={cn(
                'relative min-h-0',
                isDesktopExpandedInput
                    ? 'absolute inset-0 pointer-events-none'
                    : 'flex-1'
            )}
            aria-hidden={isDesktopExpandedInput ? true : undefined}
            inert={isDesktopExpandedInput ? true : undefined}
        >
            {!isDesktopExpandedInput && !isInitialScrollReady ? (
                <div
                    className="absolute inset-0 overflow-hidden bg-background pt-6"
                    aria-hidden="true"
                >
                    <div className="space-y-4">
                        {HYDRATING_SKELETON_ITEMS.map((item) => (
                            <div key={item.id} className="group w-full">
                                <div className="chat-message-column">
                                    <div className="space-y-2.5 px-4 py-3">
                                        <div className="space-y-1.5">
                                            {item.toolRows.map((row) => (
                                                <div key={`${item.id}-${row.id}`} className="flex items-center gap-2">
                                                    <Skeleton className="h-3.5 w-3.5 rounded-full flex-shrink-0" />
                                                    <Skeleton className={cn('h-4 rounded-md', row.titleWidth)} />
                                                    <Skeleton className={cn('h-4 rounded-md', row.detailWidth)} />
                                                </div>
                                            ))}
                                        </div>
                                        <div className="space-y-1.5 pt-1">
                                            <Skeleton className={cn('h-4 rounded-md', item.textWidths[0])} />
                                            <Skeleton className={cn('h-4 rounded-md', item.textWidths[1])} />
                                            <Skeleton className={cn('h-4 rounded-md', item.textWidths[2])} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
            <div
                className={cn(
                    'absolute inset-0',
                    !isInitialScrollReady && 'opacity-0 pointer-events-none'
                )}
                aria-hidden={!isInitialScrollReady ? true : undefined}
                inert={!isInitialScrollReady ? true : undefined}
            >
                <ScrollShadow
                    className="absolute inset-0 overflow-y-auto overflow-x-hidden z-0 chat-scroll overlay-scrollbar-target"
                    ref={scrollRef}
                    style={CHAT_SCROLL_STYLE}
                    observeMutations={false}
                    hideTopShadow={stickyUserHeader}
                    tabIndex={0}
                    onClick={focusScrollContainer}
                    data-scroll-shadow="true"
                    data-scrollbar="chat"
                >
                    <div className="relative z-0 min-h-full">
                        <InlineBlockingRequestsContext.Provider value={{ inlineByTool: inlineBlockingRequestsByTool, pendingQuestionCallIDs }}>
                            <MessageList
                                ref={messageListRef}
                                sessionKey={currentSessionId}
                                sessionDirectory={sessionDirectory}
                                turnStart={turnStart}
                                disableStaging={pendingRevealWork}
                                messages={renderedMessages}
                                sessionIsWorking={sessionIsWorking}
                                activeStreamingMessageId={streamingMessageId}
                                activeStreamingPhase={activeStreamingPhase}
                                retryOverlay={retryOverlay}
                                onMessageContentChange={handleMessageContentChange}
                                getAnimationHandlers={getAnimationHandlers}
                                hasMoreAbove={hasMoreAboveTurns}
                                isLoadingOlder={isLoadingOlder}
                                onLoadOlder={handleLoadOlder}
                                onExplicitScrollInteraction={syncPendingPrependAnchorToViewport}
                                scrollToBottom={scrollToBottom}
                                scrollRef={scrollRef}
                                initialPinToBottom={!isInitialScrollReady && initialScrollAction === 'latest'}
                                onInitialBottomReady={onInitialScrollReady}
                            />
                        </InlineBlockingRequestsContext.Provider>
                        {(sessionQuestions.length > 0 || sessionPermissions.length > 0) && (
                            <div>
                                {sessionQuestions.map((question) => (
                                    <QuestionCard key={question.id} question={question} />
                                ))}
                                {sessionPermissions.map((permission) => (
                                    <PermissionCard key={permission.id} permission={permission} />
                                ))}
                            </div>
                        )}

                        {currentSessionId && (
                            <SessionRecapNote sessionId={currentSessionId} directory={sessionDirectory} isMobile={isMobile} />
                        )}

                        <div className="mb-2">
                            <StatusRowContainer />
                        </div>

                        <div
                            className="flex-shrink-0"
                            style={{ height: `${isMobile ? CHAT_BOTTOM_SPACER_MOBILE_PX : CHAT_BOTTOM_SPACER_DESKTOP_PX}px` }}
                            aria-hidden="true"
                        />
                    </div>
                </ScrollShadow>
                <OverlayScrollbar containerRef={scrollRef} suppressVisibility={isProgrammaticFollowActive} userIntentOnly observeMutations={false} />
                {showPromptNavigator && promptTurnIds.length >= 2 ? (
                    <PromptNavigatorRail
                        turnIds={promptTurnIds}
                        previewsByTurnId={promptPreviewsByTurnId}
                        activeTurnId={promptActiveTurnId}
                        visibleTurnIds={promptVisibleTurnIds}
                        onSelectTurn={onSelectTurn}
                        canLoadEarlier={canLoadEarlierPrompts}
                        isLoadingOlder={isLoadingOlder}
                        onLoadEarlier={() => {
                            void handleLoadOlder({ userInitiated: true });
                        }}
                    />
                ) : null}
            </div>
        </div>
    );
}, (prev, next) => {
    return prev.currentSessionId === next.currentSessionId
        && prev.sessionDirectory === next.sessionDirectory
        && prev.isDesktopExpandedInput === next.isDesktopExpandedInput
        && prev.isMobile === next.isMobile
        && prev.stickyUserHeader === next.stickyUserHeader
        && prev.showPromptNavigator === next.showPromptNavigator
        && prev.scrollRef === next.scrollRef
        && prev.messageListRef === next.messageListRef
        && prev.turnStart === next.turnStart
        && prev.pendingRevealWork === next.pendingRevealWork
        && prev.renderedMessages === next.renderedMessages
        && prev.hasMoreAboveTurns === next.hasMoreAboveTurns
        && prev.isLoadingOlder === next.isLoadingOlder
        && prev.sessionIsWorking === next.sessionIsWorking
        && prev.streamingMessageId === next.streamingMessageId
        && prev.activeStreamingPhase === next.activeStreamingPhase
        && prev.retryOverlay === next.retryOverlay
        && prev.handleMessageContentChange === next.handleMessageContentChange
        && prev.getAnimationHandlers === next.getAnimationHandlers
        && prev.handleLoadOlder === next.handleLoadOlder
        && prev.scrollToBottom === next.scrollToBottom
        && prev.sessionQuestions === next.sessionQuestions
        && prev.sessionPermissions === next.sessionPermissions
        && prev.inlineBlockingRequestsByTool === next.inlineBlockingRequestsByTool
        && prev.isProgrammaticFollowActive === next.isProgrammaticFollowActive
        && prev.promptHistoryRecords === next.promptHistoryRecords
        && prev.activeTurnId === next.activeTurnId
        && prev.visibleTurnIds === next.visibleTurnIds
        && prev.timelineTurnIds === next.timelineTurnIds
        && prev.onSelectTurn === next.onSelectTurn
        && prev.canLoadEarlierPrompts === next.canLoadEarlierPrompts
        && prev.isInitialScrollReady === next.isInitialScrollReady
        && prev.initialScrollAction === next.initialScrollAction
        && prev.onInitialScrollReady === next.onInitialScrollReady;
});

ChatViewport.displayName = 'ChatViewport';

const HYDRATING_SKELETON_ITEMS: Array<{
    id: number;
    toolRows: HydratingToolSkeletonRow[];
    textWidths: [string, string, string];
}> = [
    {
        id: 1,
        toolRows: [
            { id: 'search', titleWidth: 'w-24', detailWidth: 'w-52' },
            { id: 'read', titleWidth: 'w-20', detailWidth: 'w-36' },
            { id: 'edit', titleWidth: 'w-24', detailWidth: 'w-64' },
        ],
        textWidths: ['w-24', 'w-[92%]', 'w-[78%]'],
    },
    {
        id: 2,
        toolRows: [
            { id: 'read', titleWidth: 'w-20', detailWidth: 'w-40' },
            { id: 'search', titleWidth: 'w-24', detailWidth: 'w-48' },
        ],
        textWidths: ['w-20', 'w-[88%]', 'w-[70%]'],
    },
    {
        id: 3,
        toolRows: [
            { id: 'shell', titleWidth: 'w-28', detailWidth: 'w-44' },
            { id: 'edit', titleWidth: 'w-24', detailWidth: 'w-56' },
        ],
        textWidths: ['w-24', 'w-[84%]', 'w-[64%]'],
    },
];

const ReadOnlyPromptBanner: React.FC = () => {
    const { t } = useI18n();

    return (
        <div className="p-3">
            <div className="rounded-2xl border border-border/70 bg-[var(--surface-background)] px-4 py-3 typography-ui-label text-muted-foreground">
                {t('chat.container.readOnlySubagentPromptBanner')}
            </div>
        </div>
    );
};

type ChatContainerProps = {
    autoOpenDraft?: boolean;
    readOnly?: boolean;
};

export const ChatContainer: React.FC<ChatContainerProps> = ({ autoOpenDraft = true, readOnly = false }) => {
    const { t } = useI18n();
    // Session UI state
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft);
    const setCurrentSession = useSessionUIStore((s) => s.setCurrentSession);
    const newSessionDraft = useSessionUIStore((s) => s.newSessionDraft);
    const requestPresetSubmit = useInputStore((s) => s.requestPresetSubmit);

    // Sync actions
    const sync = useSync();
    const syncDirectory = useSyncDirectory();
    const ensureSessionRenderable = React.useCallback(
        (sessionId: string) => sync.ensureSessionRenderable(sessionId),
        [sync],
    );
    const loadMoreMessages = React.useCallback(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (sessionId: string, _direction: 'up' | 'down') => sync.loadMore(sessionId),
        [sync],
    );
    const loadThroughMessage = React.useCallback(
        (sessionId: string, messageId: string) => sync.loadThroughMessage(sessionId, messageId),
        [sync],
    );

    // UI store
    const isExpandedInput = useUIStore((state) => state.isExpandedInput);
    const stickyUserHeader = useUIStore((state) => state.stickyUserHeader);
    const promptNavigatorEnabled = useUIStore((state) => state.promptNavigatorEnabled);
    const allowPromptingSubagentSessions = useUIStore((state) => state.allowPromptingSubagentSessions);
    const isTimelineDialogOpen = useUIStore((s) => s.isTimelineDialogOpen);
    const setTimelineDialogOpen = useUIStore((s) => s.setTimelineDialogOpen);

    // Streaming state
    const streamingMessageId = useStreamingStore(
        React.useCallback(
            (s) => (currentSessionId ? s.streamingMessageIds.get(currentSessionId) ?? null : null),
            [currentSessionId],
        ),
    );
    const activeStreamingPhase = useStreamingStore(
        React.useCallback(
            (s) => {
                if (!streamingMessageId) return null;
                return s.messageStreamStates.get(streamingMessageId)?.phase ?? null;
            },
            [streamingMessageId],
        ),
    );
    const liveSessionDirectory = useSessionDirectory(currentSessionId ?? '');
    const globalActiveSessions = useGlobalSessionsStore((state) => state.activeSessions);
    const globalArchivedSessions = useGlobalSessionsStore((state) => state.archivedSessions);
    const globalSessionDirectory = React.useMemo(() => {
        if (!currentSessionId) return undefined;
        const session = globalActiveSessions.find((candidate) => candidate.id === currentSessionId)
            ?? globalArchivedSessions.find((candidate) => candidate.id === currentSessionId);
        return session ? resolveGlobalSessionDirectory(session) ?? undefined : undefined;
    }, [currentSessionId, globalActiveSessions, globalArchivedSessions]);
    const currentSessionDirectory = liveSessionDirectory ?? globalSessionDirectory;
    const sessionMessageCount = useSessionMessageCount(currentSessionId ?? '', currentSessionDirectory);
    const hasRenderableSessionSnapshot = useSessionMessagesRenderable(currentSessionId ?? '', currentSessionDirectory);
    // Messages from sync system
    const sessionMessageRecords = useSessionMessageRecords(currentSessionId ?? '', currentSessionDirectory, {
        suspendPartUpdates: Boolean(streamingMessageId),
        suspendPartUpdatesForMessageId: streamingMessageId,
    });
    const sessionMessages = currentSessionId ? sessionMessageRecords : EMPTY_MESSAGES;
    const sessionPrefetchDirectory = React.useMemo(() => {
        if (!currentSessionId) return syncDirectory;
        return currentSessionDirectory ?? useSessionUIStore.getState().getDirectoryForSession(currentSessionId) ?? syncDirectory;
    }, [currentSessionDirectory, currentSessionId, syncDirectory]);
    const sessionPrefetchInfo = React.useSyncExternalStore(
        React.useCallback(
            (notify) => currentSessionId
                ? subscribeSessionPrefetch(sessionPrefetchDirectory, currentSessionId, notify)
                : () => undefined,
            [currentSessionId, sessionPrefetchDirectory],
        ),
        React.useCallback(
            () => currentSessionId ? getSessionPrefetch(sessionPrefetchDirectory, currentSessionId) : undefined,
            [currentSessionId, sessionPrefetchDirectory],
        ),
        React.useCallback(() => undefined, []),
    );

    // Sessions from sync system
    const directorySessions = useSessions();
    const activeServerId = useActiveServerId();
    const sessions = useServerLiveSessions(activeServerId);

    // Plan detection - watches messages for plan creation and signals store
    usePlanDetection(currentSessionId ?? '', sessionMessages);

    // Session status from sync system
    const sessionStatusForCurrent = useSessionStatus(currentSessionId ?? '', currentSessionDirectory) ?? IDLE_SESSION_STATUS;

    const scopedSessionIds = React.useMemo(
        () => collectVisibleSessionIdsForBlockingRequests(
            sessions.map((session) => ({ id: session.id, parentID: session.parentID })),
            currentSessionId,
        ),
        [sessions, currentSessionId],
    );

    const scopedBlockingRequestTargets = React.useMemo(() => {
        const sessionsById = new Map(sessions.map((session) => [session.id, session]));
        return scopedSessionIds.flatMap((sessionId) => {
            const directory = sessionsById.get(sessionId)?.directory
                ?? (sessionId === currentSessionId ? currentSessionDirectory : null);
            return directory ? [{ sessionId, directory }] : [];
        });
    }, [currentSessionDirectory, currentSessionId, scopedSessionIds, sessions]);

    const sessionPermissions = useServerSessionPermissions(activeServerId, scopedBlockingRequestTargets);
    const sessionQuestions = useServerSessionQuestions(activeServerId, scopedBlockingRequestTargets);
    const { isWorking: sessionActivityWorking } = useCurrentSessionActivity();
    const sessionIsWorking = React.useMemo(() => {
        if (!currentSessionId || sessionPermissions.length > 0 || sessionQuestions.length > 0) {
            return false;
        }

        return sessionActivityWorking;
    }, [currentSessionId, sessionPermissions.length, sessionQuestions.length, sessionActivityWorking]);
    const activeRetryStatus = React.useMemo(() => {
        if (!currentSessionId || sessionStatusForCurrent.type !== 'retry') {
            return null;
        }

        const rawMessage = typeof (sessionStatusForCurrent as { message?: string }).message === 'string'
            ? (((sessionStatusForCurrent as { message?: string }).message) ?? '').trim()
            : '';

        return {
            sessionId: currentSessionId,
            message: rawMessage || DEFAULT_RETRY_MESSAGE,
            confirmedAt: (sessionStatusForCurrent as { confirmedAt?: number }).confirmedAt,
        };
    }, [currentSessionId, sessionStatusForCurrent]);
    const [retryFallbackTimestamp, setRetryFallbackTimestamp] = React.useState<number>(0);
    const retryFallbackSessionRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        if (!activeRetryStatus || typeof activeRetryStatus.confirmedAt === 'number') {
            retryFallbackSessionRef.current = null;
            setRetryFallbackTimestamp(0);
            return;
        }

        if (retryFallbackSessionRef.current !== activeRetryStatus.sessionId) {
            retryFallbackSessionRef.current = activeRetryStatus.sessionId;
            setRetryFallbackTimestamp(Date.now());
        }
    }, [activeRetryStatus]);

    const retryOverlay = React.useMemo(() => {
        if (!activeRetryStatus) {
            return null;
        }

        return {
            ...activeRetryStatus,
            fallbackTimestamp: retryFallbackTimestamp,
        };
    }, [activeRetryStatus, retryFallbackTimestamp]);

    // History metadata — use sync's hasMore/isLoading
    const historyMeta = React.useMemo(() => {
        if (!currentSessionId || !currentSessionDirectory) return null;
        const syncComplete = sync.isComplete(currentSessionId);
        const prefetchHasMore = !syncComplete
            && Boolean(sessionPrefetchInfo?.cursor)
            && sessionPrefetchInfo?.complete !== true;
        return {
            limit: sessionMessages.length,
            complete: syncComplete || !(sync.hasMore(currentSessionId) || prefetchHasMore),
            loading: sync.isLoading(currentSessionId),
        };
    }, [currentSessionDirectory, currentSessionId, sessionMessages.length, sessionPrefetchInfo, sync]);

    const { isMobile } = useDeviceInfo();
    const isVSCode = isVSCodeRuntime();
    const promptHistory = useCompletePromptHistory({
        enabled: promptNavigatorEnabled && hasRenderableSessionSnapshot && !isMobile && !isVSCode,
        sessionID: currentSessionId,
        directory: sessionPrefetchDirectory,
    });
    const draftOpen = Boolean(newSessionDraft?.open);
    const isDesktopExpandedInput = isExpandedInput && !isMobile;
    const messageListRef = React.useRef<MessageListHandle | null>(null);

    const activeSession = React.useMemo(() => {
        if (!currentSessionId) return null;
        return directorySessions.find((session) => session.id === currentSessionId)
            ?? sessions.find((session) => session.id === currentSessionId)
            ?? getAllSyncSessions().find((session) => session.id === currentSessionId)
            ?? null;
    }, [currentSessionId, directorySessions, sessions]);

    const parentSession = React.useMemo(() => {
        const parentID = activeSession?.parentID;
        if (!parentID) return null;
        return directorySessions.find((session) => session.id === parentID)
            ?? sessions.find((session) => session.id === parentID)
            ?? getAllSyncSessions().find((session) => session.id === parentID)
            ?? null;
    }, [activeSession?.parentID, directorySessions, sessions]);

    const handleReturnToParentSession = React.useCallback(() => {
        if (!parentSession) return;
        const parentDirectory = (parentSession as Session & { directory?: string | null }).directory ?? null;
        const parentServerId = serverRegistry.getServerForSession(parentSession.id);
        setCurrentSession(
            parentSession.id,
            parentDirectory,
            parentServerId ? { serverId: parentServerId } : undefined,
        );
    }, [parentSession, setCurrentSession]);

    const embeddedAnchorSessionId = getEmbeddedSessionChatOriginSessionId();
    const returnToParentButton = parentSession && currentSessionId !== embeddedAnchorSessionId ? (
        <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleReturnToParentSession}
            className="absolute left-3 top-3 z-20 !font-normal bg-[var(--surface-background)]/95"
            aria-label={t('chat.container.returnToParent.aria')}
            title={parentSession.title?.trim()
                ? t('chat.container.returnToParent.titleNamed', { title: parentSession.title })
                : t('chat.container.returnToParent.title')}
        >
            <Icon name="arrow-left" className="h-4 w-4" />
            {t('chat.container.returnToParent.label')}
        </Button>
    ) : null;
    const promptReadOnly = resolvePromptReadOnly(
        readOnly,
        Boolean(activeSession?.parentID),
        allowPromptingSubagentSessions,
    );

    React.useEffect(() => {
        if (autoOpenDraft && !currentSessionId && !draftOpen) {
            openNewSessionDraft();
        }
    }, [autoOpenDraft, currentSessionId, draftOpen, openNewSessionDraft]);

    const activeTurnChangeRef = React.useRef<(turnId: string | null, visibleTurnIds: string[]) => void>(() => {});
    const handleActiveTurnChange = React.useCallback((turnId: string | null, visibleTurnIds: string[]) => {
        activeTurnChangeRef.current(turnId, visibleTurnIds);
    }, []);

    const {
        scrollRef,
        notifyContentChange: handleMessageContentChange,
        getAnimationHandlers,
        goToBottom,
        releaseAutoFollow,
        isPinned,
        isFollowingProgrammatically,
        showScrollButton,
        notifyViewportStabilize,
    } = useChatAutoFollow({
        currentSessionId,
        sessionMessageCount,
        sessionIsWorking,
        isMobile,
        onActiveTurnChange: handleActiveTurnChange,
    });

    const viewportMessages = sessionMessages;

    const timelineController = useChatTimelineController({
        sessionId: currentSessionId,
        messages: viewportMessages,
        historyMeta,
        scrollRef,
        messageListRef,
        loadMoreMessages,
        loadThroughMessage,
        goToBottom,
        releaseAutoFollow,
        isPinned,
        showScrollButton,
    });
    const { loadEarlier } = timelineController;

    const visibleToolRequestKeys = React.useMemo(
        () => collectVisibleToolRequestKeys(timelineController.renderedMessages),
        [timelineController.renderedMessages],
    );
    const {
        inlineByTool: inlineBlockingRequestsByTool,
        trailingQuestions,
        trailingPermissions,
    } = React.useMemo(
        () => splitBlockingRequestsByVisibleTool(sessionQuestions, sessionPermissions, visibleToolRequestKeys),
        [sessionPermissions, sessionQuestions, visibleToolRequestKeys],
    );

    const resumeToLatestInstant = React.useCallback(() => {
        goToBottom('instant');
    }, [goToBottom]);

    const handleDraftStarterSubmit = React.useCallback((starter: ResolvedStarter) => {
        requestPresetSubmit(starter.submitText, starter.ref.type);
    }, [requestPresetSubmit]);

    const draftWelcome = React.useMemo(() => (
        <ChatEmptyState isSubmitting={Boolean(newSessionDraft?.submitting)}>
            <DraftPresetChips
                onSubmit={handleDraftStarterSubmit}
                className="mx-auto max-w-full"
            />
        </ChatEmptyState>
    ), [handleDraftStarterSubmit, newSessionDraft?.submitting]);

    React.useEffect(() => {
        activeTurnChangeRef.current = timelineController.handleActiveTurnChange;
    }, [timelineController.handleActiveTurnChange]);

    React.useEffect(() => {
        if (sessionPermissions.length === 0 && sessionQuestions.length === 0) {
            return;
        }
        if (inlineBlockingRequestsByTool.size > 0) {
            releaseAutoFollow();
            return;
        }
        handleMessageContentChange('permission');
    }, [handleMessageContentChange, inlineBlockingRequestsByTool, releaseAutoFollow, sessionPermissions, sessionQuestions]);

    const handleLoadOlder = React.useCallback((options: { userInitiated: boolean }) => {
        return loadEarlier({ userInitiated: options.userInitiated });
    }, [loadEarlier]);

    const navigation = useChatTurnNavigation({
        sessionId: currentSessionId,
        turnIds: timelineController.turnIds,
        activeTurnId: timelineController.activeTurnId,
        scrollToTurn: timelineController.scrollToTurn,
        scrollToMessage: timelineController.scrollToMessage,
        resumeToBottom: timelineController.resumeToBottomInstant,
    });
    const { scrollToTurnId } = navigation;
    const handleSelectPromptTurn = React.useCallback((turnId: string) => {
        void scrollToTurnId(turnId, { behavior: 'auto' });
    }, [scrollToTurnId]);
    const showPromptNavigator = !isMobile
        && !isVSCode
        && !isDesktopExpandedInput
        && promptNavigatorEnabled
        && (timelineController.turnIds.length >= 2 || promptHistory.records.length >= 2);

    React.useEffect(() => {
        if (!showPromptNavigator) {
            useUIStore.getState().setPromptNavigatorPanelOpen(false);
        }
    }, [showPromptNavigator]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || !currentSessionId) return;

        const handleForceScrollBottom = (event: Event) => {
            const customEvent = event as CustomEvent<{ sessionId?: string }>;
            if (customEvent.detail?.sessionId && customEvent.detail.sessionId !== currentSessionId) return;
            goToBottom('instant');
        };

        window.addEventListener(CHAT_FORCE_SCROLL_BOTTOM_EVENT, handleForceScrollBottom as EventListener);
        return () => {
            window.removeEventListener(CHAT_FORCE_SCROLL_BOTTOM_EVENT, handleForceScrollBottom as EventListener);
        };
    }, [currentSessionId, goToBottom]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || !currentSessionId || isDesktopExpandedInput) {
            return;
        }

        const handleChatTurnKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing) {
                return;
            }

            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                return;
            }

            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
                return;
            }

            const { activeMainTab } = useUIStore.getState();
            if (activeMainTab !== 'chat' || hasBlockingChatOverlay()) {
                return;
            }

            const scrollContainer = scrollRef.current;
            if (shouldIgnoreChatNavigationForFocus(document.activeElement, scrollContainer)) {
                return;
            }

            if (shouldIgnoreChatNavigationTarget(event.target)) {
                return;
            }

            event.preventDefault();
            const offset = event.key === 'ArrowUp' ? -1 : 1;
            void navigation.scrollByTurnOffset(offset, { resumePastEnd: false });
        };

        window.addEventListener('keydown', handleChatTurnKeyDown);
        return () => {
            window.removeEventListener('keydown', handleChatTurnKeyDown);
        };
    }, [currentSessionId, isDesktopExpandedInput, navigation, scrollRef]);

    React.useLayoutEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const updateChatScrollHeight = () => {
            container.style.setProperty('--chat-scroll-height', `${container.clientHeight}px`);
        };

        updateChatScrollHeight();

        let rafId = 0;
        const scheduleUpdate = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                updateChatScrollHeight();
            });
        };

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', scheduleUpdate);
            return () => {
                if (rafId) cancelAnimationFrame(rafId);
                window.removeEventListener('resize', scheduleUpdate);
            };
        }

        const resizeObserver = new ResizeObserver(scheduleUpdate);
        resizeObserver.observe(container);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
        };
    }, [currentSessionId, isDesktopExpandedInput, scrollRef]);

    const [initialScrollReadySessionId, setInitialScrollReadySessionId] = React.useState<string | null>(null);

    const isSessionHydrating =
        Boolean(currentSessionId)
        && !hasRenderableSessionSnapshot;
    const sessionEntryScrollAction = resolveSessionEntryScrollAction({
        hasRenderableSnapshot: hasRenderableSessionSnapshot,
        hasHashTarget: typeof window !== 'undefined' && window.location.hash.length > 0,
    });
    const handleInitialScrollReady = React.useCallback(() => {
        setInitialScrollReadySessionId(currentSessionId);
    }, [currentSessionId]);

    React.useLayoutEffect(() => {
        if (!currentSessionId || sessionEntryScrollAction !== 'hash') {
            return;
        }
        releaseAutoFollow();
    }, [currentSessionId, releaseAutoFollow, sessionEntryScrollAction]);

    React.useEffect(() => {
        if (!currentSessionId) return;
        if (!currentSessionDirectory) return;
        if (hasRenderableSessionSnapshot) return;
        void ensureSessionRenderable(currentSessionId);
    }, [currentSessionDirectory, currentSessionId, ensureSessionRenderable, hasRenderableSessionSnapshot]);

	if (!currentSessionId && !draftOpen) {
		return (
			<div className="flex flex-col h-full bg-background">
				<ChatEmptyState />
			</div>
		);
	}

	if (!currentSessionId && draftOpen) {
		return (
			<div className="relative flex flex-col h-full bg-background transform-gpu">
				{!isDesktopExpandedInput ? (
					<div className="flex-1 flex items-center justify-center">
						{draftWelcome}
					</div>
				) : null}
                <div
                    className={cn(
                        'relative z-10',
						isDesktopExpandedInput
							? 'flex-1 min-h-0 bg-background'
							: 'bg-background'
					)}
				>
					{promptReadOnly ? <ReadOnlyPromptBanner /> : <ChatInput scrollToBottom={resumeToLatestInstant} />}
				</div>
			</div>
        );
    }

    if (!currentSessionId) {
        return null;
    }

	if (isSessionHydrating && sessionMessages.length === 0) {
		return (
			<div className="relative flex flex-col h-full bg-background">
				{returnToParentButton}
				<div
					className={cn(
						'relative min-h-0',
                        isDesktopExpandedInput
                            ? 'absolute inset-0 opacity-0 pointer-events-none'
                            : 'flex-1'
                    )}
                    aria-hidden={isDesktopExpandedInput}
                >
                    <div className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-background pt-6" style={CHAT_SCROLL_STYLE}>
                        <div className="space-y-4">
                            {HYDRATING_SKELETON_ITEMS.map((item) => (
                                <div key={item.id} className="group w-full">
                                    <div className="chat-message-column">
                                        <div className="space-y-2.5 px-4 py-3">
                                            <div className="space-y-1.5">
                                                {item.toolRows.map((row) => {
                                                    return (
                                                        <div key={`${item.id}-${row.id}`} className="flex items-center gap-2">
                                                            <Skeleton className="h-3.5 w-3.5 rounded-full flex-shrink-0" />
                                                            <Skeleton className={cn('h-4 rounded-md', row.titleWidth)} />
                                                            <Skeleton className={cn('h-4 rounded-md', row.detailWidth)} />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="space-y-1.5 pt-1">
                                                <Skeleton className={cn('h-4 rounded-md', item.textWidths[0])} />
                                                <Skeleton className={cn('h-4 rounded-md', item.textWidths[1])} />
                                                <Skeleton className={cn('h-4 rounded-md', item.textWidths[2])} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div
                    className={cn(
                        'relative z-10',
						isDesktopExpandedInput
							? 'flex-1 min-h-0 bg-background'
							: 'bg-background'
					)}
				>
					{promptReadOnly ? <ReadOnlyPromptBanner /> : <ChatInput scrollToBottom={resumeToLatestInstant} />}
				</div>
            </div>
        );
    }

	if (sessionMessages.length === 0) {
		return (
			<div className="relative flex flex-col h-full bg-background transform-gpu">
				{returnToParentButton}
				<div
					className={cn(
                        'relative min-h-0',
                        isDesktopExpandedInput
                            ? 'absolute inset-0 opacity-0 pointer-events-none'
                            : 'flex-1'
                    )}
                    aria-hidden={isDesktopExpandedInput}
                >
                    {!isDesktopExpandedInput ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <ChatEmptyState />
                        </div>
                    ) : null}
                </div>
                <div
                    className={cn(
                        'relative z-10',
						isDesktopExpandedInput
							? 'flex-1 min-h-0 bg-background'
							: 'bg-background'
					)}
				>
					{promptReadOnly ? <ReadOnlyPromptBanner /> : <ChatInput scrollToBottom={resumeToLatestInstant} />}
				</div>
            </div>
        );
    }

	return (
		<div className="relative flex flex-col h-full bg-background">
			{returnToParentButton}
			<ChatViewport
				key={currentSessionId}
				currentSessionId={currentSessionId}
                sessionDirectory={currentSessionDirectory}
                isDesktopExpandedInput={isDesktopExpandedInput}
                isMobile={isMobile}
                stickyUserHeader={stickyUserHeader}
                showPromptNavigator={showPromptNavigator}
                scrollRef={scrollRef}
                messageListRef={messageListRef}
                turnStart={timelineController.turnStart}
                pendingRevealWork={timelineController.pendingRevealWork}
                renderedMessages={timelineController.renderedMessages}
                hasMoreAboveTurns={timelineController.historySignals.hasMoreAboveTurns}
                isLoadingOlder={timelineController.isLoadingOlder}
                sessionIsWorking={sessionIsWorking}
                streamingMessageId={streamingMessageId}
                activeStreamingPhase={activeStreamingPhase}
                retryOverlay={retryOverlay}
                handleMessageContentChange={handleMessageContentChange}
                getAnimationHandlers={getAnimationHandlers}
                handleLoadOlder={handleLoadOlder}
                syncPendingPrependAnchorToViewport={timelineController.syncPendingPrependAnchorToViewport}
                scrollToBottom={resumeToLatestInstant}
                notifyViewportStabilize={notifyViewportStabilize}
                sessionQuestions={trailingQuestions}
                sessionPermissions={trailingPermissions}
                inlineBlockingRequestsByTool={inlineBlockingRequestsByTool}
                isProgrammaticFollowActive={isFollowingProgrammatically}
                promptHistoryRecords={promptHistory.records}
                activeTurnId={timelineController.activeTurnId}
                visibleTurnIds={timelineController.visibleTurnIds}
                timelineTurnIds={timelineController.turnIds}
                onSelectTurn={handleSelectPromptTurn}
                canLoadEarlierPrompts={timelineController.historySignals.canLoadEarlier}
                isInitialScrollReady={initialScrollReadySessionId === currentSessionId}
                initialScrollAction={sessionEntryScrollAction}
                onInitialScrollReady={handleInitialScrollReady}
            />

                <div
                    className={cn(
                        'relative z-10',
                        isDesktopExpandedInput
                            ? 'flex-1 min-h-0 bg-background'
                            : 'bg-background'
                    )}
                >
                    {!isDesktopExpandedInput && sessionMessages.length > 0 && (
                        <ScrollToBottomButton
                        visible={timelineController.showScrollToBottom}
                        onClick={navigation.resumeToLatest}
                    />
                )}
                {promptReadOnly ? <ReadOnlyPromptBanner /> : <ChatInput scrollToBottom={resumeToLatestInstant} />}
            </div>

            <TimelineDialog
                open={isTimelineDialogOpen}
                onOpenChange={setTimelineDialogOpen}
                onScrollToMessage={timelineController.scrollToMessage}
                onScrollByTurnOffset={navigation.scrollByTurnOffset}
                onResumeToLatest={resumeToLatestInstant}
                canLoadEarlier={timelineController.historySignals.canLoadEarlier}
                isLoadingEarlier={timelineController.isLoadingOlder}
                onLoadEarlier={() => {
                    void handleLoadOlder({ userInitiated: true });
                }}
            />
        </div>
    );
};

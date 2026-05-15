import React from 'react';

import type { ChatMessageEntry } from '../lib/turns/types';
import type { MessageListHandle } from '../MessageList';
import { TURN_WINDOW_DEFAULTS } from '../lib/turns/constants';
import {
    buildTurnWindowModel,
    clampTurnStart,
    getInitialTurnStart,
    updateTurnWindowModelIncremental,
    type TurnWindowModel,
} from '../lib/turns/windowTurns';
import type { TurnHistorySignals } from '../lib/turns/historySignals';
import { getMemoryLimits, type SessionHistoryMeta } from '@/stores/types/sessionTypes';
import { isSystemDirectiveMessage } from '@/lib/messages/system-directive';

type ViewportAnchor = { messageId: string; offsetTop: number };

type PendingScrollRequest = {
    sessionId: string;
    kind: 'turn' | 'message';
    id: string;
    behavior: ScrollBehavior;
    turnId: string | null;
    resolve: (value: boolean) => void;
};

interface UseChatTimelineControllerOptions {
    sessionId: string | null;
    messages: ChatMessageEntry[];
    historyMeta: SessionHistoryMeta | null;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    messageListRef: React.RefObject<MessageListHandle | null>;
    loadMoreMessages: (sessionId: string, direction: 'up' | 'down') => Promise<void>;
    goToBottom: (mode?: 'instant' | 'smooth') => void;
    releaseAutoFollow: () => void;
    isPinned: boolean;
    showScrollButton: boolean;
}

export interface UseChatTimelineControllerResult {
    turnIds: string[];
    turnStart: number;
    renderedMessages: ChatMessageEntry[];
    historySignals: TurnHistorySignals;
    isLoadingOlder: boolean;
    pendingRevealWork: boolean;
    activeTurnId: string | null;
    showScrollToBottom: boolean;
    turnWindowModel: TurnWindowModel;
    loadEarlier: () => Promise<void>;
    revealBufferedTurns: () => Promise<boolean>;
    resumeToBottom: () => void;
    resumeToBottomInstant: () => Promise<void>;
    scrollToTurn: (turnId: string, options?: { behavior?: ScrollBehavior }) => Promise<boolean>;
    scrollToMessage: (messageId: string, options?: { behavior?: ScrollBehavior }) => Promise<boolean>;
    captureViewportAnchor: () => ViewportAnchor | null;
    restoreViewportAnchor: (anchor: ViewportAnchor) => boolean;
    handleActiveTurnChange: (turnId: string | null) => void;
}

const TURN_MODEL_CACHE_MAX = 30;
const turnModelCache = new Map<string, { messages: ChatMessageEntry[]; model: TurnWindowModel }>();

export const useChatTimelineController = ({
    sessionId,
    messages,
    historyMeta,
    scrollRef,
    messageListRef,
    loadMoreMessages,
    goToBottom,
    releaseAutoFollow,
    isPinned,
    showScrollButton,
}: UseChatTimelineControllerOptions): UseChatTimelineControllerResult => {
    const previousTurnWindowModelRef = React.useRef<TurnWindowModel | null>(null);
    const previousMessagesRef = React.useRef<ChatMessageEntry[] | null>(null);
    const turnWindowModel = React.useMemo(() => {
        const key = sessionId ?? '';
        const cached = key ? turnModelCache.get(key) : undefined;
        if (cached && cached.messages === messages) {
            previousTurnWindowModelRef.current = cached.model;
            previousMessagesRef.current = messages;
            return cached.model;
        }

        const incrementalModel = updateTurnWindowModelIncremental(
            previousTurnWindowModelRef.current,
            previousMessagesRef.current,
            messages,
        );
        const nextModel = incrementalModel ?? buildTurnWindowModel(messages);
        previousTurnWindowModelRef.current = nextModel;
        previousMessagesRef.current = messages;

        if (key && messages.length > 0) {
            // LRU-like eviction: delete oldest when at capacity
            if (turnModelCache.size >= TURN_MODEL_CACHE_MAX) {
                const oldest = turnModelCache.keys().next().value;
                if (oldest !== undefined) turnModelCache.delete(oldest);
            }
            turnModelCache.set(key, { messages, model: nextModel });
        }

        return nextModel;
    }, [messages, sessionId]);

    // [sscity-mod] Count only real user turns (non-directive) for windowing.
    // Directives inflate turnCount but should not affect the window threshold.
    const realUserGroupCount = React.useMemo(() => {
        let count = 0;
        for (const message of messages) {
            const role = (message.info as { clientRole?: string | null; role?: string | null }).clientRole ?? message.info.role;
            if (role === 'user' && !isSystemDirectiveMessage(message.parts)) {
                count += 1;
            }
        }
        return count;
    }, [messages]);

    // Map from any turnId/messageId → the real-user-group index that contains it.
    // Directive turns map to the same group index as their preceding real user turn.
    const turnIdToGroupIndex = React.useMemo(() => {
        const map = new Map<string, number>();
        let groupIndex = -1;
        for (const message of messages) {
            const role = (message.info as { clientRole?: string | null; role?: string | null }).clientRole ?? message.info.role;
            if (role === 'user') {
                if (!isSystemDirectiveMessage(message.parts)) {
                    groupIndex += 1;
                }
                map.set(message.info.id, Math.max(groupIndex, 0));
            }
        }
        // Also map assistant messages to their parent's group index
        for (const [turnId, turnIndex] of turnWindowModel.turnIndexById) {
            if (!map.has(turnId)) {
                // Find the nearest group index at or before this raw turn index
                const rawTurnIds = turnWindowModel.turnIds;
                for (let i = turnIndex; i >= 0; i--) {
                    const gIdx = map.get(rawTurnIds[i]!);
                    if (typeof gIdx === 'number') {
                        map.set(turnId, gIdx);
                        break;
                    }
                }
            }
        }
        return map;
    }, [messages, turnWindowModel.turnIds, turnWindowModel.turnIndexById]);

    const turnIdToGroupIndexRef = React.useRef(turnIdToGroupIndex);
    turnIdToGroupIndexRef.current = turnIdToGroupIndex;

    const [turnStart, setTurnStart] = React.useState(() => getInitialTurnStart(realUserGroupCount));
    const [isLoadingOlder, setIsLoadingOlder] = React.useState(false);
    const [pendingRevealWork, setPendingRevealWork] = React.useState(false);
    const [activeTurnId, setActiveTurnId] = React.useState<string | null>(null);

    const turnModelRef = React.useRef(turnWindowModel);
    const turnStartRef = React.useRef(turnStart);
    const isPinnedRef = React.useRef(isPinned);
    const isLoadingOlderRef = React.useRef(isLoadingOlder);
    const pendingRevealWorkRef = React.useRef(pendingRevealWork);
    const sessionIdRef = React.useRef<string | null>(sessionId);
    const messagesRef = React.useRef(messages);
    const historyMetaRef = React.useRef<SessionHistoryMeta | null>(historyMeta);
    const previousTurnCountRef = React.useRef(realUserGroupCount);
    const initializedSessionRef = React.useRef<string | null>(null);
    const pendingRenderResolversRef = React.useRef<Array<() => void>>([]);
    const pendingScrollRequestRef = React.useRef<PendingScrollRequest | null>(null);

    const historySignals = React.useMemo(() => {
        const defaultLimit = getMemoryLimits().HISTORICAL_MESSAGES;
        const hasBufferedTurns = turnStart > 0;
        const hasMoreAboveTurns = historyMeta
            ? !historyMeta.complete
            : messages.length >= defaultLimit;
        const historyLoading = Boolean(historyMeta?.loading);
        // [sscity-mod] Guard: if realUserGroupCount fits within the initial
        // window, there's nothing to load/reveal regardless of historyMeta timing.
        const effectiveHasMore = hasMoreAboveTurns && realUserGroupCount > TURN_WINDOW_DEFAULTS.initialTurns;
        return {
            hasBufferedTurns,
            hasMoreAboveTurns: effectiveHasMore,
            historyLoading,
            canLoadEarlier: hasBufferedTurns || effectiveHasMore,
        };
    }, [historyMeta, messages.length, realUserGroupCount, turnStart]);

    const historySignalsRef = React.useRef(historySignals);

    turnModelRef.current = turnWindowModel;
    turnStartRef.current = turnStart;
    isPinnedRef.current = isPinned;
    isLoadingOlderRef.current = isLoadingOlder;
    pendingRevealWorkRef.current = pendingRevealWork;
    historySignalsRef.current = historySignals;
    sessionIdRef.current = sessionId;
    messagesRef.current = messages;
    historyMetaRef.current = historyMeta;

    React.useLayoutEffect(() => {
        if (initializedSessionRef.current === sessionId) {
            return;
        }
        initializedSessionRef.current = sessionId;
        setTurnStart(getInitialTurnStart(realUserGroupCount));
        setIsLoadingOlder(false);
        setPendingRevealWork(false);
        setActiveTurnId(null);
        previousTurnCountRef.current = realUserGroupCount;
    }, [sessionId, realUserGroupCount]);

    React.useLayoutEffect(() => {
        setTurnStart((current) => clampTurnStart(current, realUserGroupCount));
    }, [realUserGroupCount]);

    React.useLayoutEffect(() => {
        const previousTurnCount = previousTurnCountRef.current;
        const nextTurnCount = realUserGroupCount;
        if (previousTurnCount === nextTurnCount) {
            return;
        }

        setTurnStart((current) => {
            const previousInitial = getInitialTurnStart(previousTurnCount);
            const nextInitial = getInitialTurnStart(nextTurnCount);
            if (isPinnedRef.current && current === previousInitial) {
                return nextInitial;
            }
            return clampTurnStart(current, nextTurnCount);
        });

        previousTurnCountRef.current = nextTurnCount;
    }, [realUserGroupCount]);

    const resolvePendingRenderWaiters = React.useCallback(() => {
        const resolvers = pendingRenderResolversRef.current;
        if (resolvers.length === 0) {
            return;
        }
        pendingRenderResolversRef.current = [];
        resolvers.forEach((resolve) => resolve());
    }, []);

    const waitForNextRenderCommit = React.useCallback((): Promise<void> => {
        return new Promise<void>((resolve) => {
            pendingRenderResolversRef.current.push(resolve);
        });
    }, []);

    const resolvePendingScrollRequest = React.useCallback((value: boolean) => {
        const pending = pendingScrollRequestRef.current;
        if (!pending) {
            return;
        }
        pendingScrollRequestRef.current = null;
        pending.resolve(value);
    }, []);

    const attemptPendingScrollRequest = React.useCallback(() => {
        const pending = pendingScrollRequestRef.current;
        if (!pending) {
            return;
        }

        if (pending.sessionId !== sessionIdRef.current) {
            resolvePendingScrollRequest(false);
            return;
        }

        const didScroll = pending.kind === 'turn'
            ? (messageListRef.current?.scrollToTurnId(pending.id, { behavior: pending.behavior }) ?? false)
            : (messageListRef.current?.scrollToMessageId(pending.id, { behavior: pending.behavior }) ?? false);

        if (didScroll) {
            if (pending.turnId) {
                setActiveTurnId(pending.turnId);
            }
            resolvePendingScrollRequest(true);
            return;
        }

        const targetGroupIndex = pending.kind === 'turn'
            ? turnIdToGroupIndexRef.current.get(pending.id)
            : ((): number | undefined => {
                const tId = turnModelRef.current.messageToTurnId.get(pending.id);
                return tId ? turnIdToGroupIndexRef.current.get(tId) : undefined;
            })();

        if (typeof targetGroupIndex === 'number' && targetGroupIndex >= turnStartRef.current) {
            resolvePendingScrollRequest(false);
        }
    }, [messageListRef, resolvePendingScrollRequest]);

    React.useEffect(() => {
        return () => {
            resolvePendingRenderWaiters();
            resolvePendingScrollRequest(false);
        };
    }, [resolvePendingRenderWaiters, resolvePendingScrollRequest]);

    const renderedMessages = React.useMemo(() => {
        // [sscity-mod] Pass full messages to MessageList. Turn windowing now
        // happens at the grouped-turn-entry level inside MessageList, not at
        // the raw-message level. This ensures the complete turn tree is always
        // available so directive turns never lose their parent real-user turn.
        return messages;
    }, [messages]);

    React.useLayoutEffect(() => {
        resolvePendingRenderWaiters();
        attemptPendingScrollRequest();
    }, [attemptPendingScrollRequest, renderedMessages, resolvePendingRenderWaiters, turnStart]);

    // --- Synchronous scroll compensation for load-more / reveal ---
    // fetchOlderHistory and revealBufferedTurns store a snapshot here
    // before triggering the state change. useLayoutEffect consumes it
    // after React commits new DOM — before the browser paints.
    const prePrependScrollRef = React.useRef<{
        height: number;
        top: number;
        anchor: ViewportAnchor | null;
    } | null>(null);

    const captureViewportAnchor = React.useCallback((): ViewportAnchor | null => {
        return messageListRef.current?.captureViewportAnchor() ?? null;
    }, [messageListRef]);

    const restoreViewportAnchor = React.useCallback((anchor: ViewportAnchor): boolean => {
        return messageListRef.current?.restoreViewportAnchor(anchor) ?? false;
    }, [messageListRef]);

    React.useLayoutEffect(() => {
        const snap = prePrependScrollRef.current;
        const container = scrollRef.current;
        if (!snap || !container) return;
        prePrependScrollRef.current = null;

        if (snap.anchor && restoreViewportAnchor(snap.anchor)) {
            return;
        }

        const delta = container.scrollHeight - snap.height;
        if (delta > 0) {
            container.scrollTop = snap.top + delta;
        }
    }, [renderedMessages, scrollRef, restoreViewportAnchor]);

    const revealBufferedTurns = React.useCallback(async (): Promise<boolean> => {
        if (turnStartRef.current <= 0 || pendingRevealWorkRef.current) {
            return false;
        }

        const container = scrollRef.current;
        if (container) {
            prePrependScrollRef.current = {
                height: container.scrollHeight,
                top: container.scrollTop,
                anchor: captureViewportAnchor(),
            };
        }

        setPendingRevealWork(true);
        setTurnStart((current) => {
            const next = current - TURN_WINDOW_DEFAULTS.batchTurns;
            return next > 0 ? next : 0;
        });

        await waitForNextRenderCommit();
        setPendingRevealWork(false);
        return true;
    }, [captureViewportAnchor, scrollRef, waitForNextRenderCommit]);

    const fetchOlderHistory = React.useCallback(async (input: {
        preserveViewport: boolean;
    }): Promise<boolean> => {
        if (!sessionIdRef.current || isLoadingOlderRef.current) {
            return false;
        }
        if (!historySignalsRef.current.hasMoreAboveTurns) {
            return false;
        }

        const container = scrollRef.current;
        const beforeMessages = messagesRef.current;
        const beforeMessageCount = beforeMessages.length;
        const beforeOldestMessageId = beforeMessages[0]?.info?.id ?? null;
        const beforeLimit = historyMetaRef.current?.limit ?? getMemoryLimits().HISTORICAL_MESSAGES;

        // Store scroll snapshot BEFORE the fetch so useLayoutEffect can
        // compensate synchronously when React commits the new messages.
        if (input.preserveViewport && container) {
            prePrependScrollRef.current = {
                height: container.scrollHeight,
                top: container.scrollTop,
                anchor: captureViewportAnchor(),
            };
        }

        setIsLoadingOlder(true);

        try {
            const targetSessionId = sessionIdRef.current;
            if (!targetSessionId) {
                return false;
            }

            await loadMoreMessages(targetSessionId, 'up');

            const afterMessages = messagesRef.current;
            const afterMessageCount = afterMessages.length;
            const afterOldestMessageId = afterMessages[0]?.info?.id ?? null;
            const afterLimit = historyMetaRef.current?.limit ?? beforeLimit;
            const historyGrew =
                afterMessageCount > beforeMessageCount
                || (typeof beforeOldestMessageId === 'string'
                    && typeof afterOldestMessageId === 'string'
                    && beforeOldestMessageId !== afterOldestMessageId);

            return historyGrew || afterLimit > beforeLimit;
        } finally {
            setIsLoadingOlder(false);
        }
    }, [captureViewportAnchor, loadMoreMessages, scrollRef]);

    const loadEarlier = React.useCallback(async () => {
        if (await revealBufferedTurns()) {
            return;
        }

        void (await fetchOlderHistory({ preserveViewport: true }));
    }, [fetchOlderHistory, revealBufferedTurns]);

    const scrollToTurn = React.useCallback(async (
        turnId: string,
        options?: { behavior?: ScrollBehavior },
    ): Promise<boolean> => {
        if (!turnId || !sessionIdRef.current) {
            return false;
        }

        releaseAutoFollow();
        setPendingRevealWork(true);

        try {
            if (sessionIdRef.current !== sessionId) {
                return false;
            }

            const turnIndex = turnIdToGroupIndexRef.current.get(turnId);
            if (typeof turnIndex !== 'number') {
                return false;
            }

            if (turnIndex < turnStartRef.current) {
                setTurnStart(turnIndex);
            }

            const result = await new Promise<boolean>((resolve) => {
                pendingScrollRequestRef.current = {
                    sessionId: sessionIdRef.current ?? sessionId ?? '',
                    kind: 'turn',
                    id: turnId,
                    behavior: options?.behavior ?? 'auto',
                    turnId,
                    resolve,
                };
                attemptPendingScrollRequest();
            });

            if (result) {
                return true;
            }

            return false;
        } finally {
            setPendingRevealWork(false);
        }
    }, [attemptPendingScrollRequest, releaseAutoFollow, sessionId]);

    const scrollToMessage = React.useCallback(async (
        messageId: string,
        options?: { behavior?: ScrollBehavior },
    ): Promise<boolean> => {
        if (!messageId || !sessionIdRef.current) {
            return false;
        }

        releaseAutoFollow();
        setPendingRevealWork(true);

        try {
            if (sessionIdRef.current !== sessionId) {
                return false;
            }

            const turnId = turnModelRef.current.messageToTurnId.get(messageId);
            const groupIndex = turnId ? turnIdToGroupIndexRef.current.get(turnId) : undefined;

            if (typeof groupIndex !== 'number') {
                return false;
            }

            if (groupIndex < turnStartRef.current) {
                setTurnStart(groupIndex);
            }

            const result = await new Promise<boolean>((resolve) => {
                pendingScrollRequestRef.current = {
                    sessionId: sessionIdRef.current ?? sessionId ?? '',
                    kind: 'message',
                    id: messageId,
                    behavior: options?.behavior ?? 'auto',
                    turnId: turnId ?? null,
                    resolve,
                };
                attemptPendingScrollRequest();
            });

            if (result) {
                return true;
            }

            return false;
        } finally {
            setPendingRevealWork(false);
        }
    }, [attemptPendingScrollRequest, releaseAutoFollow, sessionId]);

    const resumeToBottom = React.useCallback(async () => {
        const nextStart = getInitialTurnStart(realUserGroupCount);
        setPendingRevealWork(false);
        setIsLoadingOlder(false);

        const shouldWaitForRender = nextStart !== turnStartRef.current;
        if (shouldWaitForRender) {
            setTurnStart(nextStart);
            await waitForNextRenderCommit();
        }

        goToBottom('smooth');
    }, [goToBottom, realUserGroupCount, waitForNextRenderCommit]);

    const resumeToBottomInstant = React.useCallback(async () => {
        const nextStart = getInitialTurnStart(realUserGroupCount);
        setPendingRevealWork(false);
        setIsLoadingOlder(false);

        const shouldWaitForRender = nextStart !== turnStartRef.current;
        if (shouldWaitForRender) {
            setTurnStart(nextStart);
            await waitForNextRenderCommit();
        }

        goToBottom('instant');
    }, [goToBottom, realUserGroupCount, waitForNextRenderCommit]);

    const handleActiveTurnChange = React.useCallback((turnId: string | null) => {
        setActiveTurnId(turnId);
    }, []);

    return {
        turnIds: turnWindowModel.turnIds,
        turnStart,
        renderedMessages,
        historySignals,
        isLoadingOlder,
        pendingRevealWork,
        activeTurnId,
        showScrollToBottom: showScrollButton && !pendingRevealWork,
        turnWindowModel,
        loadEarlier,
        revealBufferedTurns,
        resumeToBottom,
        resumeToBottomInstant,
        scrollToTurn,
        scrollToMessage,
        captureViewportAnchor,
        restoreViewportAnchor,
        handleActiveTurnChange,
    };
};

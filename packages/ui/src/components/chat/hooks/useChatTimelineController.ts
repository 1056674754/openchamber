import React from 'react';

import type { ChatMessageEntry } from '../lib/turns/types';
import type { MessageListHandle, MessageViewportAnchor } from '../MessageList';
import { TURN_WINDOW_DEFAULTS } from '../lib/turns/constants';
import {
    buildTurnWindowModel,
    updateTurnWindowModelIncremental,
    type TurnWindowModel,
} from '../lib/turns/windowTurns';
import { deriveTimelineHistorySignals, type TurnHistorySignals } from '../lib/turns/historySignals';
import { getMemoryLimits, type SessionHistoryMeta } from '@/stores/types/sessionTypes';
import { hasRealUserMessageParts } from '@/lib/messages/real-user';
import { isVSCodeRuntime } from '@/lib/desktop';
import { toast } from '@/components/ui';
import { formatSdkError } from '@/sync/sdk-error';

type PendingScrollRequest = {
    sessionId: string;
    kind: 'turn' | 'message';
    id: string;
    behavior: ScrollBehavior;
    turnId: string | null;
    awaitingLoad: boolean;
    resolve: (value: boolean) => void;
};

interface UseChatTimelineControllerOptions {
    sessionId: string | null;
    messages: ChatMessageEntry[];
    historyMeta: SessionHistoryMeta | null;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    messageListRef: React.RefObject<MessageListHandle | null>;
    loadMoreMessages: (sessionId: string, direction: 'up' | 'down') => Promise<void>;
    loadThroughMessage: (sessionId: string, messageId: string) => Promise<boolean>;
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
    visibleTurnIds: string[];
    showScrollToBottom: boolean;
    turnWindowModel: TurnWindowModel;
    loadEarlier: (options?: { userInitiated?: boolean }) => Promise<void>;
    revealBufferedTurns: () => Promise<boolean>;
    resumeToBottom: () => void;
    resumeToBottomInstant: () => Promise<void>;
    scrollToTurn: (turnId: string, options?: { behavior?: ScrollBehavior }) => Promise<boolean>;
    scrollToMessage: (messageId: string, options?: { behavior?: ScrollBehavior }) => Promise<boolean>;
    captureViewportAnchor: () => MessageViewportAnchor | null;
    restoreViewportAnchor: (anchor: MessageViewportAnchor) => boolean;
    syncPendingPrependAnchorToViewport: () => void;
    handleActiveTurnChange: (turnId: string | null, visibleTurnIds: string[]) => void;
}

const TURN_MODEL_CACHE_MAX = 30;
const VSCODE_TURN_MODEL_CACHE_MAX = 4;
const VSCODE_TURN_MODEL_CACHE_MAX_MESSAGES = 30;
const turnModelCache = new Map<string, { messages: ChatMessageEntry[]; model: TurnWindowModel }>();
const getTurnModelCacheMax = () => isVSCodeRuntime() ? VSCODE_TURN_MODEL_CACHE_MAX : TURN_MODEL_CACHE_MAX;

const shouldCacheTurnModelMessages = (messages: ChatMessageEntry[]): boolean => {
    if (!isVSCodeRuntime()) return true;
    return messages.length <= VSCODE_TURN_MODEL_CACHE_MAX_MESSAGES;
};

const rememberTurnModel = (key: string, value: { messages: ChatMessageEntry[]; model: TurnWindowModel }) => {
    turnModelCache.delete(key);
    if (!shouldCacheTurnModelMessages(value.messages)) {
        return;
    }
    const max = getTurnModelCacheMax();
    while (turnModelCache.size >= max) {
        const oldest = turnModelCache.keys().next().value;
        if (typeof oldest !== 'string') break;
        turnModelCache.delete(oldest);
    }
    turnModelCache.set(key, value);
};

export const useChatTimelineController = ({
    sessionId,
    messages,
    historyMeta,
    scrollRef,
    messageListRef,
    loadMoreMessages,
    loadThroughMessage,
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
            rememberTurnModel(key, cached);
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
            rememberTurnModel(key, { messages, model: nextModel });
        }

        return nextModel;
    }, [messages, sessionId]);

    // [sscity-mod] Count only real user turns (non-directive) for windowing.
    // Directives inflate turnCount but should not affect the window threshold.
    const realUserGroupCount = React.useMemo(() => {
        let count = 0;
        for (const message of messages) {
            const role = (message.info as { clientRole?: string | null; role?: string | null }).clientRole ?? message.info.role;
            if (role === 'user' && hasRealUserMessageParts(message.parts, message.info)) {
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
                if (hasRealUserMessageParts(message.parts, message.info)) {
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

    const turnStart = 0;
    const [isLoadingOlder, setIsLoadingOlder] = React.useState(false);
    const [pendingRevealWork, setPendingRevealWork] = React.useState(false);
    const [activeTurnId, setActiveTurnId] = React.useState<string | null>(null);
    const [visibleTurnIds, setVisibleTurnIds] = React.useState<string[]>([]);

    const turnModelRef = React.useRef(turnWindowModel);
    const turnStartRef = React.useRef(turnStart);
    const isPinnedRef = React.useRef(isPinned);
    const isLoadingOlderRef = React.useRef(isLoadingOlder);
    const sessionIdRef = React.useRef<string | null>(sessionId);
    const messagesRef = React.useRef(messages);
    const historyMetaRef = React.useRef<SessionHistoryMeta | null>(historyMeta);
    const initializedSessionRef = React.useRef<string | null>(null);
    const pendingScrollRequestRef = React.useRef<PendingScrollRequest | null>(null);

    const historySignals = React.useMemo(() => {
        const defaultLimit = getMemoryLimits().HISTORICAL_MESSAGES;
        return deriveTimelineHistorySignals({
            historyMeta,
            loadedMessageCount: messages.length,
            loadedRealUserGroupCount: realUserGroupCount,
            turnStart,
            defaultHistoryLimit: defaultLimit,
            initialTurns: TURN_WINDOW_DEFAULTS.initialTurns,
        });
    }, [historyMeta, messages.length, realUserGroupCount, turnStart]);

    const historySignalsRef = React.useRef(historySignals);

    turnModelRef.current = turnWindowModel;
    turnStartRef.current = turnStart;
    isPinnedRef.current = isPinned;
    isLoadingOlderRef.current = isLoadingOlder;
    historySignalsRef.current = historySignals;
    sessionIdRef.current = sessionId;
    messagesRef.current = messages;
    historyMetaRef.current = historyMeta;

    React.useLayoutEffect(() => {
        if (initializedSessionRef.current === sessionId) {
            return;
        }
        initializedSessionRef.current = sessionId;
        setIsLoadingOlder(false);
        setPendingRevealWork(false);
        setActiveTurnId(null);
        setVisibleTurnIds([]);
    }, [sessionId]);

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

        if (
            typeof targetGroupIndex === 'number'
            && targetGroupIndex >= turnStartRef.current
            && !pending.awaitingLoad
        ) {
            resolvePendingScrollRequest(false);
        }
    }, [messageListRef, resolvePendingScrollRequest]);

    React.useEffect(() => {
        return () => {
            resolvePendingScrollRequest(false);
        };
    }, [resolvePendingScrollRequest]);

    const renderedMessages = React.useMemo(() => {
        // [sscity-mod] Pass full messages to MessageList. Turn windowing now
        // happens at the grouped-turn-entry level inside MessageList, not at
        // the raw-message level. This ensures the complete turn tree is always
        // available so directive turns never lose their parent real-user turn.
        return messages;
    }, [messages]);

    React.useLayoutEffect(() => {
        attemptPendingScrollRequest();
    }, [attemptPendingScrollRequest, renderedMessages, turnStart]);

    // --- Synchronous scroll compensation for load-more / reveal ---
    // fetchOlderHistory and revealBufferedTurns store a snapshot here
    // before triggering the state change. useLayoutEffect consumes it
    // after React commits new DOM — before the browser paints.
    const prePrependScrollRef = React.useRef<{
        height: number;
        top: number;
        anchor: MessageViewportAnchor | null;
        oldestMessageId: string | null;
    } | null>(null);

    const cancelPendingPrependAnchor = React.useCallback(() => {
        prePrependScrollRef.current = null;
    }, []);

    React.useLayoutEffect(() => {
        cancelPendingPrependAnchor();
    }, [cancelPendingPrependAnchor, sessionId]);

    const captureViewportAnchor = React.useCallback((): MessageViewportAnchor | null => {
        return messageListRef.current?.captureViewportAnchor() ?? null;
    }, [messageListRef]);

    const syncPendingPrependAnchorToViewport = React.useCallback(() => {
        const pending = prePrependScrollRef.current;
        const container = scrollRef.current;
        if (!pending || !container) {
            return;
        }

        prePrependScrollRef.current = {
            height: container.scrollHeight,
            top: container.scrollTop,
            anchor: captureViewportAnchor(),
            oldestMessageId: pending.oldestMessageId,
        };
    }, [captureViewportAnchor, scrollRef]);

    const restoreViewportAnchor = React.useCallback((anchor: MessageViewportAnchor): boolean => {
        return messageListRef.current?.restoreViewportAnchor(anchor) ?? false;
    }, [messageListRef]);

    React.useLayoutEffect(() => {
        const snap = prePrependScrollRef.current;
        const container = scrollRef.current;
        if (!snap || !container) return;
        const currentOldestMessageId = renderedMessages[0]?.info.id ?? null;
        if (currentOldestMessageId === snap.oldestMessageId) return;
        prePrependScrollRef.current = null;

        if (snap.anchor && restoreViewportAnchor(snap.anchor)) {
            return;
        }

        const delta = container.scrollHeight - snap.height;
        if (delta > 0) {
            container.scrollTop = snap.top + delta;
        }
    }, [renderedMessages, scrollRef, restoreViewportAnchor, turnStart]);

    const revealBufferedTurns = React.useCallback(async (): Promise<boolean> => false, []);

    const fetchOlderHistory = React.useCallback(async (input: {
        preserveViewport: boolean;
        notifyFailure: boolean;
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
                oldestMessageId: beforeOldestMessageId,
            };
        }

        setIsLoadingOlder(true);
        let historyAdvanced = false;
        let oldestMessageAdvanced = false;

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

            oldestMessageAdvanced = typeof afterOldestMessageId === 'string'
                && beforeOldestMessageId !== afterOldestMessageId;
            historyAdvanced = historyGrew || afterLimit > beforeLimit;
            return historyAdvanced;
        } catch (error) {
            if (input.notifyFailure) {
                toast.error('Could not load older messages', {
                    description: formatSdkError(error),
                });
            }
            return false;
        } finally {
            if (!oldestMessageAdvanced) {
                cancelPendingPrependAnchor();
            }
            setIsLoadingOlder(false);
        }
    }, [cancelPendingPrependAnchor, captureViewportAnchor, loadMoreMessages, scrollRef]);

    const loadEarlier = React.useCallback(async (options?: { userInitiated?: boolean }) => {
        if (options?.userInitiated) {
            releaseAutoFollow();
        }

        void (await fetchOlderHistory({
            preserveViewport: true,
            notifyFailure: options?.userInitiated === true,
        }));
    }, [fetchOlderHistory, releaseAutoFollow]);

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

            const targetLoaded = typeof turnIdToGroupIndexRef.current.get(turnId) === 'number';
            const pendingResult = new Promise<boolean>((resolve) => {
                pendingScrollRequestRef.current = {
                    sessionId: sessionIdRef.current ?? sessionId ?? '',
                    kind: 'turn',
                    id: turnId,
                    behavior: options?.behavior ?? 'auto',
                    turnId,
                    awaitingLoad: !targetLoaded,
                    resolve,
                };
            });

            if (targetLoaded) {
                attemptPendingScrollRequest();
                return await pendingResult;
            }

            cancelPendingPrependAnchor();

            setIsLoadingOlder(true);
            try {
                const loaded = await loadThroughMessage(sessionIdRef.current ?? sessionId ?? '', turnId);
                if (!loaded) {
                    cancelPendingPrependAnchor();
                    resolvePendingScrollRequest(false);
                    return false;
                }
                const pending = pendingScrollRequestRef.current;
                if (pending?.kind === 'turn' && pending.id === turnId) {
                    pending.awaitingLoad = false;
                }
                attemptPendingScrollRequest();
                return await pendingResult;
            } catch (error) {
                cancelPendingPrependAnchor();
                resolvePendingScrollRequest(false);
                toast.error('Could not load the selected prompt', {
                    description: formatSdkError(error),
                });
                return false;
            } finally {
                setIsLoadingOlder(false);
            }
        } finally {
            setPendingRevealWork(false);
        }
    }, [
        attemptPendingScrollRequest,
        cancelPendingPrependAnchor,
        loadThroughMessage,
        releaseAutoFollow,
        resolvePendingScrollRequest,
        sessionId,
    ]);

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

            const result = await new Promise<boolean>((resolve) => {
                pendingScrollRequestRef.current = {
                    sessionId: sessionIdRef.current ?? sessionId ?? '',
                    kind: 'message',
                    id: messageId,
                    behavior: options?.behavior ?? 'auto',
                    turnId: turnId ?? null,
                    awaitingLoad: false,
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
        setPendingRevealWork(false);
        setIsLoadingOlder(false);
        goToBottom('smooth');
    }, [goToBottom]);

    const resumeToBottomInstant = React.useCallback(async () => {
        setPendingRevealWork(false);
        setIsLoadingOlder(false);
        goToBottom('instant');
    }, [goToBottom]);

    const handleActiveTurnChange = React.useCallback((turnId: string | null, nextVisibleTurnIds: string[]) => {
        setActiveTurnId(turnId);
        setVisibleTurnIds((previous) => {
            const unchanged = previous.length === nextVisibleTurnIds.length
                && nextVisibleTurnIds.every((id, index) => id === previous[index]);
            return unchanged ? previous : nextVisibleTurnIds;
        });
    }, []);

    return {
        turnIds: turnWindowModel.turnIds,
        turnStart,
        renderedMessages,
        historySignals,
        isLoadingOlder,
        pendingRevealWork,
        activeTurnId,
        visibleTurnIds,
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
        syncPendingPrependAnchorToViewport,
        handleActiveTurnChange,
    };
};

import React from 'react';
import type { Part } from '@opencode-ai/sdk/v2';
import { elementScroll, type VirtualItem, useVirtualizer } from '@tanstack/react-virtual';

import ChatMessage from './ChatMessage';
import { areOptionalRenderRelevantMessagesEqual, areRelevantTurnGroupingContextsEqual, areRenderRelevantMessagesEqual } from './message/renderCompare';
import TurnItem from './components/TurnItem';
import type { AnimationHandlers, ContentChangeReason } from '@/hooks/useChatAutoFollow';
import { filterSyntheticParts } from '@/lib/messages/synthetic';
import { hasSubtaskPart } from '@/lib/messages/real-user';
import type { ChatMessageEntry, TurnRecord, TurnGroupingContext } from './lib/turns/types';
import { useTurnRecords } from './hooks/useTurnRecords';
import { useOlderHistoryPrefetch } from './hooks/useOlderHistoryPrefetch';
import { applyRetryOverlay } from './lib/turns/applyRetryOverlay';
import {
    deriveAutoExpandedTurnIds,
    deriveProcessFoldState,
    setProcessFoldOverride,
    turnContainsMessageId,
    turnHasStopSummary,
} from './lib/turns/processFold';
import { useUIStore } from '@/stores/useUIStore';
import { useFeatureFlagsStore } from '@/stores/useFeatureFlagsStore';
import { FadeInDisabledProvider } from './message/FadeInOnReveal';
import { hasPendingUserSendAnimation, consumePendingUserSendAnimation } from '@/lib/userSendAnimation';
import { streamPerfCount, streamPerfMeasure } from '@/stores/utils/streamDebug';
import type { StreamPhase } from './message/types';
import { normalizeParts } from './message/partUtils';
import { isProcessFoldTransitionActive } from './lib/scroll/processFoldViewport';
import {
    getMessageListOverscan,
    shouldCompensateVirtualItemResize,
    shouldRevealInitialLatestViewport,
} from './lib/scroll/scrollIntent';
import { useDeviceInfo } from '@/lib/device';
import { listTurnSnapshotDiffs } from '@/lib/diff/turnSnapshotDiff';
import { useSessionParts } from '@/sync/sync-context';
import { buildLiveStreamingEntry } from './lib/turns/streamingTailEntry';

const MESSAGE_LIST_VIRTUALIZE_THRESHOLD = 5;
const MESSAGE_LIST_AT_END_THRESHOLD_PX = 80;
const MESSAGE_LIST_ESTIMATED_ENTRY_SIZE = 320;
const MESSAGE_LIST_ESTIMATE_MIN_SAMPLES = 5;
const MESSAGE_LIST_ESTIMATE_MIN = 120;
const MESSAGE_LIST_ESTIMATE_MAX = 1200;
const INITIAL_LATEST_QUIET_PERIOD_MS = 250;
const INITIAL_LATEST_MAX_WAIT_MS = 2000;
const EMPTY_PROCESS_FOLD_OVERRIDES: ReadonlyMap<string, boolean> = new Map();
// Large turns can finish virtual row measurement well after the wheel event.
// Keep those measurements from rewriting scrollTop during the same gesture.
const SCROLL_INTERACTION_WINDOW_MS = 1200;

const useStableEvent = <TArgs extends unknown[], TResult>(handler: (...args: TArgs) => TResult) => {
    const handlerRef = React.useRef(handler);
    React.useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    return React.useCallback((...args: TArgs) => handlerRef.current(...args), []);
};

const USER_SHELL_MARKER = 'The following tool was executed by the user';

const resolveMessageRole = (message: ChatMessageEntry): string | null => {
    const info = message.info as unknown as { clientRole?: string | null | undefined; role?: string | null | undefined };
    return (typeof info.clientRole === 'string' ? info.clientRole : null)
        ?? (typeof info.role === 'string' ? info.role : null)
        ?? null;
};

const hasCompactionPart = (message: ChatMessageEntry): boolean => {
    return message.parts.some((part) => {
        const type = (part as { type?: unknown } | null | undefined)?.type;
        return type === 'compaction';
    });
};

const isCompactionTurn = (turn: TurnRecord): boolean => {
    const msg = turn.userMessage;
    if (hasCompactionPart(msg)) {
        return true;
    }
    return msg.parts.length > 0
        && msg.parts.every((part) => {
            if (part.type !== 'text') { return false; }
            return getPartText(part).trim() === '/compact';
        });
};

const isCompactionComplete = (turn: TurnRecord): boolean => {
    if (turn.assistantMessages.length === 0) {
        return false;
    }
    const last = turn.assistantMessages[turn.assistantMessages.length - 1];
    return isAssistantMessageCompleted(last);
};

const getPartText = (part: Part): string => {
    const text = (part as { text?: unknown }).text;
    if (typeof text === 'string') {
        return text;
    }
    const content = (part as { content?: unknown }).content;
    if (typeof content === 'string') {
        return content;
    }
    return '';
};

const normalizeCompactionCommandMessage = (message: ChatMessageEntry): ChatMessageEntry => {
    if (!hasCompactionPart(message)) {
        return message;
    }

    let changedParts = false;
    const nextParts = message.parts.map((part) => {
        const type = (part as { type?: unknown } | null | undefined)?.type;
        if (type !== 'compaction') {
            return part;
        }
        changedParts = true;
        return { type: 'text', text: '/compact' } as Part;
    });

    const info = message.info as unknown as { clientRole?: string | null | undefined };
    const needsClientRole = info.clientRole !== 'user';

    if (!changedParts && !needsClientRole) {
        return message;
    }

    return {
        ...message,
        info: needsClientRole
            ? ({
                ...(message.info as unknown as Record<string, unknown>),
                clientRole: 'user',
            } as unknown as typeof message.info)
            : message.info,
        parts: changedParts ? nextParts : message.parts,
    };
};

const normalizeCompactionSummaryMessage = (
    message: ChatMessageEntry,
    compactionCommandIds: Set<string>,
): ChatMessageEntry => {
    const role = resolveMessageRole(message);
    if (role !== 'system') {
        return message;
    }

    const parentID = getMessageParentId(message);
    if (!parentID || !compactionCommandIds.has(parentID)) {
        return message;
    }

    const info = message.info as unknown as { clientRole?: string | null | undefined };
    if (info.clientRole === 'assistant') {
        return message;
    }

    return {
        ...message,
        info: ({
            ...(message.info as unknown as Record<string, unknown>),
            clientRole: 'assistant',
        } as unknown as typeof message.info),
    };
};

const isAssistantMessageCompleted = (message: ChatMessageEntry): boolean => {
    const info = message.info as { time?: { completed?: unknown }; status?: unknown };
    const completed = info.time?.completed;
    const status = info.status;
    if (typeof completed !== 'number' || completed <= 0) {
        return false;
    }
    if (typeof status === 'string') {
        return status === 'completed';
    }
    return true;
};

const isUserSubtaskMessage = (message: ChatMessageEntry | undefined): boolean => {
    if (!message) return false;
    if (resolveMessageRole(message) !== 'user') return false;
    return hasSubtaskPart(message.parts);
};

const getMessageId = (message: ChatMessageEntry | undefined): string | null => {
    if (!message) return null;
    const id = (message.info as unknown as { id?: unknown }).id;
    return typeof id === 'string' && id.trim().length > 0 ? id : null;
};

const getMessageParentId = (message: ChatMessageEntry): string | null => {
    const parentID = (message.info as unknown as { parentID?: unknown }).parentID;
    return typeof parentID === 'string' && parentID.trim().length > 0 ? parentID : null;
};

const isInsideStuckStickyWrapper = (node: HTMLElement, containerRect: DOMRect): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    const stickyWrapper = node.closest<HTMLElement>('[data-sticky-message-wrapper="true"]');
    if (!stickyWrapper) {
        return false;
    }

    const computed = window.getComputedStyle(stickyWrapper);
    if (computed.position !== 'sticky') {
        return false;
    }

    const rect = stickyWrapper.getBoundingClientRect();
    const stickyTop = Number.parseFloat(computed.top);
    const stuckTop = containerRect.top + (Number.isFinite(stickyTop) ? stickyTop : 0);
    return rect.top <= stuckTop + 1;
};

const isUserShellMarkerMessage = (message: ChatMessageEntry | undefined): boolean => {
    if (!message) return false;
    if (resolveMessageRole(message) !== 'user') return false;

    return message.parts.some((part) => {
        if (part?.type !== 'text') return false;
        const textPart = part as unknown as { text?: unknown; synthetic?: unknown; shellAction?: unknown };
        const text = textPart.text;
        const synthetic = textPart.synthetic;
        const hasShellAction = typeof textPart.shellAction === 'object' && textPart.shellAction !== null;
        if (hasShellAction && typeof text === 'string' && text.trim() === '/shell') return true;
        return synthetic === true && typeof text === 'string' && text.trim().startsWith(USER_SHELL_MARKER);
    });
};

type ShellBridgeDetails = {
    command?: string;
    output?: string;
    status?: string;
};

const getShellBridgeAssistantDetails = (message: ChatMessageEntry, expectedParentId: string | null): { hide: boolean; details: ShellBridgeDetails | null } => {
    if (resolveMessageRole(message) !== 'assistant') {
        return { hide: false, details: null };
    }

    if (expectedParentId && getMessageParentId(message) !== expectedParentId) {
        return { hide: false, details: null };
    }

    if (message.parts.length !== 1) {
        return { hide: false, details: null };
    }

    const part = message.parts[0] as unknown as {
        type?: unknown;
        tool?: unknown;
        state?: {
            status?: unknown;
            input?: { command?: unknown };
            output?: unknown;
            metadata?: { output?: unknown };
        };
    };

    if (part?.type !== 'tool') {
        return { hide: false, details: null };
    }

    const toolName = typeof part.tool === 'string' ? part.tool.toLowerCase() : '';
    if (toolName !== 'bash') {
        return { hide: false, details: null };
    }

    const command = typeof part.state?.input?.command === 'string' ? part.state.input.command : undefined;
    const output =
        (typeof part.state?.output === 'string' ? part.state.output : undefined)
        ?? (typeof part.state?.metadata?.output === 'string' ? part.state.metadata.output : undefined);
    const status = typeof part.state?.status === 'string' ? part.state.status : undefined;

    return {
        hide: true,
        details: {
            command,
            output,
            status,
        },
    };
};

const readTaskSessionId = (toolPart: Part): string | null => {
    const partRecord = toolPart as unknown as {
        state?: {
            metadata?: {
                sessionId?: unknown;
                sessionID?: unknown;
            };
            output?: unknown;
        };
    };
    const metadata = partRecord.state?.metadata;
    const fromMetadata =
        (typeof metadata?.sessionID === 'string' && metadata.sessionID.trim().length > 0
            ? metadata.sessionID.trim()
            : null)
        ?? (typeof metadata?.sessionId === 'string' && metadata.sessionId.trim().length > 0
            ? metadata.sessionId.trim()
            : null);
    if (fromMetadata) return fromMetadata;

    const output = partRecord.state?.output;
    if (typeof output === 'string') {
        const match = output.match(/task_id\s*:\s*([^\s<"']+)/i);
        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
};

const isSyntheticSubtaskBridgeAssistant = (message: ChatMessageEntry): { hide: boolean; taskSessionId: string | null } => {
    if (resolveMessageRole(message) !== 'assistant') {
        return { hide: false, taskSessionId: null };
    }

    if (message.parts.length !== 1) {
        return { hide: false, taskSessionId: null };
    }

    const onlyPart = message.parts[0] as unknown as {
        type?: unknown;
        tool?: unknown;
    } | null | undefined;

    if (onlyPart?.type !== 'tool') {
        return { hide: false, taskSessionId: null };
    }

    const toolName = typeof onlyPart.tool === 'string' ? onlyPart.tool.toLowerCase() : '';
    if (toolName !== 'task') {
        return { hide: false, taskSessionId: null };
    }

    return {
        hide: true,
        taskSessionId: readTaskSessionId(message.parts[0]),
    };
};

const withSubtaskSessionId = (message: ChatMessageEntry, taskSessionId: string | null): ChatMessageEntry => {
    if (!taskSessionId) return message;
    const nextParts = message.parts.map((part) => {
        if (part?.type !== 'subtask') return part;
        const existing = (part as unknown as { taskSessionID?: unknown }).taskSessionID;
        if (typeof existing === 'string' && existing.trim().length > 0) return part;
        return {
            ...part,
            taskSessionID: taskSessionId,
        } as Part;
    });

    return {
        ...message,
        parts: nextParts,
    };
};

const withShellBridgeDetails = (message: ChatMessageEntry, details: ShellBridgeDetails | null): ChatMessageEntry => {
    const command = typeof details?.command === 'string' ? details.command.trim() : '';
    const output = typeof details?.output === 'string' ? details.output : '';
    const status = typeof details?.status === 'string' ? details.status.trim() : '';

    const nextParts: Part[] = [];
    let injected = false;

    for (const part of message.parts) {
        if (!injected && part?.type === 'text') {
            const textPart = part as unknown as {
                text?: unknown;
                synthetic?: unknown;
                shellAction?: {
                    command?: unknown;
                    output?: unknown;
                    status?: unknown;
                };
            };
            const text = textPart.text;
            const synthetic = textPart.synthetic;
            const trimmedText = typeof text === 'string' ? text.trim() : '';
            const hasShellAction = typeof textPart.shellAction === 'object' && textPart.shellAction !== null;
            if ((synthetic === true && trimmedText.startsWith(USER_SHELL_MARKER)) || (hasShellAction && trimmedText === '/shell')) {
                const existingCommand = typeof textPart.shellAction?.command === 'string' ? textPart.shellAction.command.trim() : '';
                const existingOutput = typeof textPart.shellAction?.output === 'string' ? textPart.shellAction.output : '';
                const existingStatus = typeof textPart.shellAction?.status === 'string' ? textPart.shellAction.status.trim() : '';
                const effectiveCommand = command || existingCommand;
                const effectiveOutput = output || existingOutput;
                const effectiveStatus = status || existingStatus;
                nextParts.push({
                    type: 'text',
                    text: '/shell',
                    shellAction: {
                        ...(effectiveCommand ? { command: effectiveCommand } : {}),
                        ...(effectiveOutput ? { output: effectiveOutput } : {}),
                        ...(effectiveStatus ? { status: effectiveStatus } : {}),
                    },
                } as unknown as Part);
                injected = true;
                continue;
            }
        }
        nextParts.push(part);
    }

    if (!injected) {
        nextParts.push({
            type: 'text',
            text: '/shell',
            shellAction: {
                ...(command ? { command } : {}),
                ...(output ? { output } : {}),
                ...(status ? { status } : {}),
            },
        } as unknown as Part);
    }

    return {
        ...message,
        parts: nextParts,
    };
};

const normalizeMessageParts = (message: ChatMessageEntry): ChatMessageEntry => {
    const parts = normalizeParts(message.parts);
    if (parts.length === message.parts.length) {
        return message;
    }
    return {
        ...message,
        parts,
    };
};

const normalizedMessageBySource = new WeakMap<ChatMessageEntry, ChatMessageEntry>();

const getNormalizedMessageForDisplay = (message: ChatMessageEntry): ChatMessageEntry => {
    const cached = normalizedMessageBySource.get(message);
    if (cached) {
        return cached;
    }

    const normalizedPartMessage = normalizeMessageParts(message);
    const normalizedCompactionMessage = normalizeCompactionCommandMessage(normalizedPartMessage);
    const filteredParts = filterSyntheticParts(normalizedCompactionMessage.parts);
    const normalized = filteredParts === normalizedCompactionMessage.parts
        ? normalizedCompactionMessage
        : {
            ...normalizedCompactionMessage,
            parts: filteredParts,
        };

    normalizedMessageBySource.set(message, normalized);
    return normalized;
};

interface MessageListProps {
    sessionKey: string;
    /** Session-authoritative directory for live part reinjection (never UI getDirectory fallback). */
    sessionDirectory?: string | null;
    turnStart: number;
    disableStaging?: boolean;
    messages: ChatMessageEntry[];
    sessionIsWorking?: boolean;
    activeStreamingMessageId?: string | null;
    activeStreamingPhase?: StreamPhase | null;
    retryOverlay?: {
        sessionId: string;
        message: string;
        confirmedAt?: number;
        fallbackTimestamp?: number;
    } | null;
    onMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    hasMoreAbove: boolean;
    isLoadingOlder: boolean;
    onLoadOlder: (options: { userInitiated: boolean }) => Promise<void>;
    onExplicitScrollInteraction: () => void;
    scrollToBottom?: () => void;
    scrollRef?: React.RefObject<HTMLDivElement | null>;
    initialPinToBottom: boolean;
    onInitialBottomReady: () => void;
    onViewportStabilize?: () => void;
}

export type MessageViewportAnchor = {
    messageId: string;
    offsetTop: number;
    entryKey: string;
    entryOffsetTop: number;
};

export interface MessageListHandle {
    scrollToTurnId: (turnId: string, options?: { behavior?: ScrollBehavior }) => boolean;
    scrollToMessageId: (messageId: string, options?: { behavior?: ScrollBehavior }) => boolean;
    captureViewportAnchor: () => MessageViewportAnchor | null;
    restoreViewportAnchor: (anchor: MessageViewportAnchor) => boolean;
    scrollToBottom: () => void;
}

type RenderEntry =
    | {
        kind: 'ungrouped';
        key: string;
        message: ChatMessageEntry;
        previousMessage?: ChatMessageEntry;
        nextMessage?: ChatMessageEntry;
        assistantHeaderMessageId?: string;
        turnGroupingContext?: TurnGroupingContext;
    }
    | {
        kind: 'turn';
        key: string;
        turn: TurnRecord;
        isLastTurn: boolean;
        lastTurnId: string | null;
        // [sscity-mod] Directive turns that immediately follow this real user
        // turn. They render inside the same <section> so that the real user's
        // sticky header stays active while scrolling through directive content.
        directiveTurns?: TurnRecord[];
    };

type TurnUiState = {
    isExpanded?: boolean;
    processFoldOverrides?: ReadonlyMap<string, boolean>;
};

interface RenderMessageOptions {
    hideAssistantBody?: boolean;
    assistantHeaderAddon?: React.ReactNode;
    assistantBodyProcessFoldContent?: boolean;
    assistantBodyProcessFoldCollapsed?: boolean;
}



interface MessageRowProps {
    message: ChatMessageEntry;
    previousMessage?: ChatMessageEntry;
    nextMessage?: ChatMessageEntry;
    turnGroupingContext?: TurnGroupingContext;
    assistantHeaderMessageId?: string;
    isInActiveTurn?: boolean;
    activeStreamingPhase?: StreamPhase | null;
    animateUserOnMount?: boolean;
    onUserAnimationConsumed?: (messageId: string) => void;
    onContentChange: (reason?: ContentChangeReason) => void;
    animationHandlers: AnimationHandlers;
    scrollToBottom?: () => void;
    hideAssistantBody?: boolean;
    assistantHeaderAddon?: React.ReactNode;
    assistantBodyProcessFoldContent?: boolean;
    assistantBodyProcessFoldCollapsed?: boolean;
}

const MessageRow = React.memo<MessageRowProps>(({ 
    message,
    previousMessage,
    nextMessage,
    turnGroupingContext,
    assistantHeaderMessageId,
    isInActiveTurn,
    activeStreamingPhase,
    animateUserOnMount,
    onUserAnimationConsumed,
    onContentChange,
    animationHandlers,
    scrollToBottom,
    hideAssistantBody,
    assistantHeaderAddon,
    assistantBodyProcessFoldContent,
    assistantBodyProcessFoldCollapsed,
}) => {
    return (
        <ChatMessage
            message={message}
            previousMessage={previousMessage}
            nextMessage={nextMessage}
            animateUserOnMount={animateUserOnMount}
            onUserAnimationConsumed={onUserAnimationConsumed}
            onContentChange={onContentChange}
            animationHandlers={animationHandlers}
            scrollToBottom={scrollToBottom}
            turnGroupingContext={turnGroupingContext}
            assistantHeaderMessageId={assistantHeaderMessageId}
            isInActiveTurn={isInActiveTurn}
            activeStreamingPhase={activeStreamingPhase}
            hideAssistantBody={hideAssistantBody}
            assistantHeaderAddon={assistantHeaderAddon}
            assistantBodyProcessFoldContent={assistantBodyProcessFoldContent}
            assistantBodyProcessFoldCollapsed={assistantBodyProcessFoldCollapsed}
        />
    );
}, (prev, next) => {
    const prevTurn = prev.turnGroupingContext;
    const nextTurn = next.turnGroupingContext;

    return areRenderRelevantMessagesEqual(prev.message, next.message)
        && areOptionalRenderRelevantMessagesEqual(prev.previousMessage, next.previousMessage)
        && areOptionalRenderRelevantMessagesEqual(prev.nextMessage, next.nextMessage)
        && prev.animateUserOnMount === next.animateUserOnMount
        && prev.onUserAnimationConsumed === next.onUserAnimationConsumed
        && prev.onContentChange === next.onContentChange
        && prev.scrollToBottom === next.scrollToBottom
        && areRelevantTurnGroupingContextsEqual(prevTurn, nextTurn, prev.message.info.id, resolveMessageRole(prev.message) === 'user')
        && prev.assistantHeaderMessageId === next.assistantHeaderMessageId
        && prev.isInActiveTurn === next.isInActiveTurn
        && prev.activeStreamingPhase === next.activeStreamingPhase
        && prev.hideAssistantBody === next.hideAssistantBody
        && prev.assistantHeaderAddon === next.assistantHeaderAddon
        && prev.assistantBodyProcessFoldContent === next.assistantBodyProcessFoldContent
        && prev.assistantBodyProcessFoldCollapsed === next.assistantBodyProcessFoldCollapsed
        && prev.animationHandlers?.onChunk === next.animationHandlers?.onChunk
        && prev.animationHandlers?.onComplete === next.animationHandlers?.onComplete
        && prev.animationHandlers?.onStreamingCandidate === next.animationHandlers?.onStreamingCandidate
        && prev.animationHandlers?.onAnimationStart === next.animationHandlers?.onAnimationStart
        && prev.animationHandlers?.onReservationCancelled === next.animationHandlers?.onReservationCancelled
        && prev.animationHandlers?.onReasoningBlock === next.animationHandlers?.onReasoningBlock
        && prev.animationHandlers?.onAnimatedHeightChange === next.animationHandlers?.onAnimatedHeightChange;
});

MessageRow.displayName = 'MessageRow';

interface TurnBlockProps {
    turn: TurnRecord;
    isLastTurn: boolean;
    lastTurnId: string | null;
    sessionIsWorking: boolean;
    defaultActivityExpanded: boolean;
    autoExpandedTurnIds: Set<string>;
    turnUiStates: Map<string, TurnUiState>;
    onToggleTurnGroup: (turnId: string, currentExpanded: boolean) => void;
    onProcessFoldOverride: (turnId: string, foldId: string, expanded: boolean) => void;
    chatRenderMode: 'sorted' | 'live';
    onMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    scrollToBottom?: () => void;
    stickyUserHeader?: boolean;
    shouldAnimateUserMessage: (message: ChatMessageEntry) => boolean;
    onUserAnimationConsumed: (messageId: string) => void;
    activeStreamingMessageId?: string | null;
    activeStreamingPhase?: StreamPhase | null;
    directiveTurns?: TurnRecord[];
}

const TurnBlock = React.memo(({
    turn,
    isLastTurn,
    lastTurnId,
    sessionIsWorking,
    defaultActivityExpanded,
    autoExpandedTurnIds,
    turnUiStates,
    onToggleTurnGroup,
    onProcessFoldOverride,
    chatRenderMode,
    onMessageContentChange,
    getAnimationHandlers,
    scrollToBottom,
    stickyUserHeader = true,
    shouldAnimateUserMessage,
    onUserAnimationConsumed,
    activeStreamingMessageId,
    activeStreamingPhase,
    directiveTurns,
}: TurnBlockProps) => {
    const getProcessFoldState = React.useCallback((targetTurn: TurnRecord) => {
        return deriveProcessFoldState({
            turn: targetTurn,
            sessionIsWorking,
            defaultActivityExpanded,
            autoExpandedTurnIds,
            activeStreamingTurnId: turnContainsMessageId(targetTurn, activeStreamingMessageId)
                ? targetTurn.turnId
                : null,
            lastTurnId,
        });
    }, [activeStreamingMessageId, autoExpandedTurnIds, defaultActivityExpanded, lastTurnId, sessionIsWorking]);

    const turnUiState = turnUiStates.get(turn.turnId);
    const isTurnExpanded = turnUiState?.isExpanded ?? defaultActivityExpanded;
    const handleToggleTurnGroup = React.useCallback(() => {
        onToggleTurnGroup(turn.turnId, isTurnExpanded);
    }, [isTurnExpanded, onToggleTurnGroup, turn.turnId]);

    const messageOrder = React.useMemo(() => {
        const ordered = [turn.userMessage, ...turn.assistantMessages];
        const lookup = new Map<string, number>();
        ordered.forEach((message, index) => {
            lookup.set(message.info.id, index);
        });
        return { ordered, lookup };
    }, [turn.assistantMessages, turn.userMessage]);

    const streamingAssistantMessageId = React.useMemo(() => {
        if (activeStreamingMessageId && turn.assistantMessages.some((assistant) => assistant.info.id === activeStreamingMessageId)) {
            return activeStreamingMessageId;
        }

        for (let index = turn.assistantMessages.length - 1; index >= 0; index -= 1) {
            const assistant = turn.assistantMessages[index];
            if (!isAssistantMessageCompleted(assistant)) {
                return assistant.info.id;
            }
        }

        return null;
    }, [activeStreamingMessageId, turn.assistantMessages]);

    const visibleAssistantMessages = React.useMemo(() => {
        if (chatRenderMode === 'live') {
            return turn.assistantMessages;
        }

        const completed = turn.assistantMessages.filter(isAssistantMessageCompleted);
        if (completed.length === turn.assistantMessages.length) {
            return turn.assistantMessages;
        }

        if (streamingAssistantMessageId) {
            const completedIds = new Set(completed.map((assistant) => assistant.info.id));
            return turn.assistantMessages.filter((assistant) => (
                completedIds.has(assistant.info.id)
                || assistant.info.id === streamingAssistantMessageId
            ));
        }

        if (completed.length > 0) {
            return completed;
        }
        const firstAssistant = turn.assistantMessages[0];
        return firstAssistant ? [firstAssistant] : [];
    }, [chatRenderMode, streamingAssistantMessageId, turn.assistantMessages]);

    const completedAssistantMessages = React.useMemo(() => {
        if (chatRenderMode !== 'sorted') {
            return turn.assistantMessages;
        }
        return turn.assistantMessages.filter(isAssistantMessageCompleted);
    }, [chatRenderMode, turn.assistantMessages]);

    const visibleAssistantIds = React.useMemo(() => {
        const ids = new Map<string, number>();
        visibleAssistantMessages.forEach((assistant, index) => {
            ids.set(assistant.info.id, index);
        });
        return ids;
    }, [visibleAssistantMessages]);

    const completedAssistantIdSet = React.useMemo(() => {
        return new Set(completedAssistantMessages.map((assistant) => assistant.info.id));
    }, [completedAssistantMessages]);

    const visibleActivityMessageIdSet = React.useMemo(() => {
        const ids = new Set(completedAssistantIdSet);
        if (streamingAssistantMessageId) {
            ids.add(streamingAssistantMessageId);
        }
        return ids;
    }, [completedAssistantIdSet, streamingAssistantMessageId]);

    const turnIsInActiveStream = React.useMemo(() => {
        return turnContainsMessageId(turn, streamingAssistantMessageId);
    }, [turn, streamingAssistantMessageId]);

    const activityOwnerMessageId = React.useMemo(() => {
        if (turnIsInActiveStream && streamingAssistantMessageId) {
            return streamingAssistantMessageId;
        }
        return visibleAssistantMessages[0]?.info.id;
    }, [streamingAssistantMessageId, turnIsInActiveStream, visibleAssistantMessages]);

    const visibleActivityParts = React.useMemo(() => {
        if (chatRenderMode !== 'sorted') {
            return turn.activityParts;
        }
        if (visibleActivityMessageIdSet.size === turn.assistantMessages.length) {
            return turn.activityParts;
        }
        return turn.activityParts.filter((activity) => visibleActivityMessageIdSet.has(activity.messageId));
    }, [chatRenderMode, visibleActivityMessageIdSet, turn.activityParts, turn.assistantMessages.length]);

    const visibleActivitySegments = React.useMemo(() => {
        if (chatRenderMode !== 'sorted') {
            return turn.activitySegments;
        }
        if (visibleActivityMessageIdSet.size === turn.assistantMessages.length) {
            return turn.activitySegments;
        }
        return turn.activitySegments
            .map((segment) => {
                const parts = segment.parts.filter((activity) => visibleActivityMessageIdSet.has(activity.messageId));
                if (parts.length === 0) {
                    return null;
                }
                const anchorMessageId = visibleActivityMessageIdSet.has(segment.anchorMessageId)
                    ? segment.anchorMessageId
                    : parts[0]?.messageId;
                if (!anchorMessageId) {
                    return null;
                }
                return {
                    ...segment,
                    anchorMessageId,
                    parts,
                };
            })
            .filter((segment): segment is NonNullable<typeof segment> => segment !== null);
    }, [chatRenderMode, visibleActivityMessageIdSet, turn.activitySegments, turn.assistantMessages.length]);

    const turnGroupingContextBase = React.useMemo(() => {
        const userCreatedAt = (turn.userMessage.info.time as { created?: number } | undefined)?.created;
        // OpenCode 1.4.0 moved variant from top-level to model.variant on UserMessage.
        // Prefer the new location, fall back to the legacy one for older servers.
        const info = turn.userMessage.info as {
            variant?: unknown;
            model?: { variant?: unknown };
            summary?: { diffs?: unknown };
        } | undefined;
        const rawVariant = info?.model?.variant ?? info?.variant;
        const userMessageVariant = typeof rawVariant === 'string' && rawVariant.trim().length > 0
            ? rawVariant
            : undefined;
        const summaryDiffs = listTurnSnapshotDiffs(info?.summary?.diffs);
        return {
            turnId: turn.turnId,
            summaryBody: turn.summaryText,
            summaryDiffs: summaryDiffs.length > 0 ? summaryDiffs : undefined,
            activityParts: visibleActivityParts,
            activityGroupSegments: visibleActivitySegments,
            headerMessageId: turn.headerMessageId,
            hasTools: turn.hasTools,
            hasReasoning: turn.hasReasoning,
            diffStats: turn.diffStats,
            userMessageCreatedAt: typeof userCreatedAt === 'number' ? userCreatedAt : undefined,
            userMessageVariant,
        };
    }, [turn.diffStats, turn.hasReasoning, turn.hasTools, turn.headerMessageId, turn.summaryText, turn.turnId, turn.userMessage.info, visibleActivityParts, visibleActivitySegments]);

    const renderMessage = React.useCallback(
        (message: ChatMessageEntry, options?: RenderMessageOptions) => {
            const messageRole = resolveMessageRole(message);
            const isUserMessage = messageRole === 'user';
            const messageIndex = messageOrder.lookup.get(message.info.id);
            const assistantIndex = visibleAssistantIds.get(message.info.id) ?? -1;
            const isAssistantMessage = assistantIndex >= 0;
            const isFirstAssistant = assistantIndex === 0;
            const isLastAssistant = assistantIndex === visibleAssistantMessages.length - 1;
            const hasAnchoredActivitySegment = visibleActivitySegments.some((segment) => segment.anchorMessageId === message.info.id);
            const shouldAttachFullTurnContext = isAssistantMessage;
            const assistantHeaderMessageId = visibleAssistantMessages[0]?.info.id ?? turn.headerMessageId;

            const previousMessage = isUserMessage
                ? undefined
                : (isAssistantMessage
                    ? (isFirstAssistant
                        ? turn.userMessage
                        : undefined)
                    : (typeof messageIndex === 'number' && messageIndex > 0
                        ? messageOrder.ordered[messageIndex - 1]
                        : undefined));
            const nextMessage = undefined;

            const turnGroupingContext = isAssistantMessage
                ? {
                    turnId: turn.turnId,
                    activityOwnerMessageId,
                    isFirstAssistantInTurn: isFirstAssistant,
                    isLastAssistantInTurn: isLastAssistant,
                    isLatestTurn: isLastTurn,
                    isWorking: isLastTurn && sessionIsWorking && (
                        chatRenderMode === 'sorted'
                            ? hasAnchoredActivitySegment
                            : message.info.id === streamingAssistantMessageId
                    ),
                    hasTools: turn.hasTools,
                    hasReasoning: turn.hasReasoning,
                    ...(shouldAttachFullTurnContext ? {
                        summaryBody: turnGroupingContextBase.summaryBody,
                        summaryDiffs: turnGroupingContextBase.summaryDiffs,
                        activityParts: turnGroupingContextBase.activityParts,
                        activityGroupSegments: turnGroupingContextBase.activityGroupSegments,
                        headerMessageId: turnGroupingContextBase.headerMessageId,
                        diffStats: turnGroupingContextBase.diffStats,
                        userMessageCreatedAt: turnGroupingContextBase.userMessageCreatedAt,
                        userMessageVariant: turnGroupingContextBase.userMessageVariant,
                        isGroupExpanded: isTurnExpanded,
                        toggleGroup: handleToggleTurnGroup,
                    } : {}),
                } satisfies TurnGroupingContext
                : undefined;

            return (
                <MessageRow
                    key={message.info.id}
                    message={message}
                    previousMessage={previousMessage}
                    nextMessage={nextMessage}
                    turnGroupingContext={turnGroupingContext}
                    assistantHeaderMessageId={assistantHeaderMessageId}
                    isInActiveTurn={Boolean(streamingAssistantMessageId) && message.info.id === streamingAssistantMessageId}
                    activeStreamingPhase={message.info.id === streamingAssistantMessageId ? activeStreamingPhase : null}
                    animateUserOnMount={shouldAnimateUserMessage(message)}
                    onUserAnimationConsumed={onUserAnimationConsumed}
                    onContentChange={onMessageContentChange}
                    animationHandlers={getAnimationHandlers(message.info.id)}
                    scrollToBottom={scrollToBottom}
                    hideAssistantBody={options?.hideAssistantBody}
                    assistantHeaderAddon={options?.assistantHeaderAddon}
                    assistantBodyProcessFoldContent={options?.assistantBodyProcessFoldContent}
                    assistantBodyProcessFoldCollapsed={options?.assistantBodyProcessFoldCollapsed}
                />
            );
        },
        [
            getAnimationHandlers,
            isLastTurn,
            messageOrder.lookup,
            messageOrder.ordered,
            onMessageContentChange,
            scrollToBottom,
            sessionIsWorking,
            chatRenderMode,
            turn.headerMessageId,
            turn.hasReasoning,
            turn.hasTools,
            turn.turnId,
            turn.userMessage,
            isTurnExpanded,
            turnGroupingContextBase,
            streamingAssistantMessageId,
            activeStreamingPhase,
            visibleAssistantMessages,
            visibleAssistantIds,
            visibleActivitySegments,
            activityOwnerMessageId,
            shouldAnimateUserMessage,
            onUserAnimationConsumed,
            handleToggleTurnGroup,
        ]
    );


    const renderableTurn = React.useMemo(() => {
        if (visibleAssistantMessages === turn.assistantMessages) {
            return turn;
        }
        return {
            ...turn,
            assistantMessages: visibleAssistantMessages,
        };
    }, [turn, visibleAssistantMessages]);

    return (
        <TurnItem
            turn={renderableTurn}
            stickyUserHeader={stickyUserHeader}
            renderMessage={renderMessage}
            directiveTurns={directiveTurns}
            getProcessFoldState={getProcessFoldState}
            processFoldOverrides={turnUiState?.processFoldOverrides ?? EMPTY_PROCESS_FOLD_OVERRIDES}
            onProcessFoldOverride={onProcessFoldOverride}
        />
    );
});

TurnBlock.displayName = 'TurnBlock';

interface UngroupedMessageRowProps {
    message: ChatMessageEntry;
    previousMessage?: ChatMessageEntry;
    nextMessage?: ChatMessageEntry;
    turnGroupingContext?: TurnGroupingContext;
    assistantHeaderMessageId?: string;
    onMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    scrollToBottom?: () => void;
    shouldAnimateUserMessage: (message: ChatMessageEntry) => boolean;
    onUserAnimationConsumed: (messageId: string) => void;
    activeStreamingMessageId?: string | null;
    activeStreamingPhase?: StreamPhase | null;
}

const UngroupedMessageRow = React.memo(({
    message,
    previousMessage,
    nextMessage,
    turnGroupingContext,
    assistantHeaderMessageId,
    onMessageContentChange,
    getAnimationHandlers,
    scrollToBottom,
    shouldAnimateUserMessage,
    onUserAnimationConsumed,
    activeStreamingMessageId,
    activeStreamingPhase,
}: UngroupedMessageRowProps) => {
    return (
        <MessageRow
            message={message}
            previousMessage={previousMessage}
            nextMessage={nextMessage}
            turnGroupingContext={turnGroupingContext}
            assistantHeaderMessageId={assistantHeaderMessageId}
            animateUserOnMount={shouldAnimateUserMessage(message)}
            onUserAnimationConsumed={onUserAnimationConsumed}
            onContentChange={onMessageContentChange}
            animationHandlers={getAnimationHandlers(message.info.id)}
            scrollToBottom={scrollToBottom}
            isInActiveTurn={Boolean(activeStreamingMessageId) && message.info.id === activeStreamingMessageId}
            activeStreamingPhase={message.info.id === activeStreamingMessageId ? activeStreamingPhase : null}
        />
    );
});

UngroupedMessageRow.displayName = 'UngroupedMessageRow';

const CompactionDivider = React.memo(({ turn }: { turn: TurnRecord }) => {
    const [expanded, setExpanded] = React.useState(false);
    const completed = isCompactionComplete(turn);
    const label = completed ? 'Compacted' : 'Compacting…';

    return (
        <div className="py-2">
            <div
                className="flex items-center gap-2 cursor-pointer select-none group"
                onClick={() => setExpanded((v) => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v); } }}
            >
                <div className="flex-1 h-px bg-border/60" />
                <span className="typography-ui-label text-xs text-foreground/50 group-hover:text-foreground/70 transition-colors whitespace-nowrap">
                    {label}
                </span>
                <div className="flex-1 h-px bg-border/60" />
            </div>
            {expanded && turn.assistantMessages.length > 0 && (
                <div className="mt-2 rounded-lg border border-border/40 bg-muted/10 p-3 text-xs text-foreground/70 whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {turn.assistantMessages.map((msg) =>
                        msg.parts
                            .filter((p) => p.type === 'text')
                            .map((p, i) => <span key={`${msg.info.id}-${i}`}>{getPartText(p)}</span>)
                    )}
                </div>
            )}
        </div>
    );
});

CompactionDivider.displayName = 'CompactionDivider';

interface MessageListEntryProps {
    entry: RenderEntry;
    onMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    scrollToBottom?: () => void;
    stickyUserHeader?: boolean;
    sessionIsWorking: boolean;
    defaultActivityExpanded: boolean;
    autoExpandedTurnIds: Set<string>;
    turnUiStates: Map<string, TurnUiState>;
    onToggleTurnGroup: (turnId: string, currentExpanded: boolean) => void;
    onProcessFoldOverride: (turnId: string, foldId: string, expanded: boolean) => void;
    chatRenderMode: 'sorted' | 'live';
    shouldAnimateUserMessage: (message: ChatMessageEntry) => boolean;
    onUserAnimationConsumed: (messageId: string) => void;
    activeStreamingMessageId?: string | null;
    activeStreamingPhase?: StreamPhase | null;
}

const MessageListEntry = React.memo(({
    entry,
    onMessageContentChange,
    getAnimationHandlers,
    scrollToBottom,
    stickyUserHeader,
    sessionIsWorking,
    defaultActivityExpanded,
    autoExpandedTurnIds,
    turnUiStates,
    onToggleTurnGroup,
    onProcessFoldOverride,
    chatRenderMode,
    shouldAnimateUserMessage,
    onUserAnimationConsumed,
    activeStreamingMessageId,
    activeStreamingPhase,
}: MessageListEntryProps) => {
    if (entry.kind === 'ungrouped') {
        return (
            <UngroupedMessageRow
                message={entry.message}
                previousMessage={entry.previousMessage}
                nextMessage={entry.nextMessage}
                turnGroupingContext={entry.turnGroupingContext}
                assistantHeaderMessageId={entry.assistantHeaderMessageId}
                onMessageContentChange={onMessageContentChange}
                getAnimationHandlers={getAnimationHandlers}
                scrollToBottom={scrollToBottom}
                shouldAnimateUserMessage={shouldAnimateUserMessage}
                onUserAnimationConsumed={onUserAnimationConsumed}
                activeStreamingMessageId={activeStreamingMessageId}
                activeStreamingPhase={activeStreamingPhase}
            />
        );
    }

    if (isCompactionTurn(entry.turn)) {
        return <CompactionDivider turn={entry.turn} />;
    }

    return (
        <TurnBlock
            turn={entry.turn}
            isLastTurn={entry.isLastTurn}
            lastTurnId={entry.lastTurnId}
            sessionIsWorking={sessionIsWorking}
            defaultActivityExpanded={defaultActivityExpanded}
            autoExpandedTurnIds={autoExpandedTurnIds}
            turnUiStates={turnUiStates}
            onToggleTurnGroup={onToggleTurnGroup}
            onProcessFoldOverride={onProcessFoldOverride}
            chatRenderMode={chatRenderMode}
            shouldAnimateUserMessage={shouldAnimateUserMessage}
            onUserAnimationConsumed={onUserAnimationConsumed}
            activeStreamingMessageId={activeStreamingMessageId}
            activeStreamingPhase={activeStreamingPhase}
            onMessageContentChange={onMessageContentChange}
            getAnimationHandlers={getAnimationHandlers}
            scrollToBottom={scrollToBottom}
            stickyUserHeader={stickyUserHeader}
            directiveTurns={entry.kind === 'turn' ? entry.directiveTurns : undefined}
        />
    );
});

MessageListEntry.displayName = 'MessageListEntry';

// Inner component that renders staged turn entries.
const StaticHistoryList: React.FC<{
    entries: RenderEntry[];
    shouldVirtualize: boolean;
    virtualRows: VirtualItem[];
    totalSize: number;
    scrollMargin: number;
    measureElement: (element: HTMLDivElement | null) => void;
    contentRef: React.RefObject<HTMLDivElement | null>;
    onMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    scrollToBottom?: () => void;
    stickyUserHeader: boolean;
    sessionIsWorking: boolean;
    defaultActivityExpanded: boolean;
    autoExpandedTurnIds: Set<string>;
    turnUiStates: Map<string, TurnUiState>;
    onToggleTurnGroup: (turnId: string, currentExpanded: boolean) => void;
    onProcessFoldOverride: (turnId: string, foldId: string, expanded: boolean) => void;
    chatRenderMode: 'sorted' | 'live';
    shouldAnimateUserMessage: (message: ChatMessageEntry) => boolean;
    onUserAnimationConsumed: (messageId: string) => void;
    activeStreamingPhase?: StreamPhase | null;
}> = ({ entries, shouldVirtualize, virtualRows, totalSize, scrollMargin, measureElement, contentRef, onMessageContentChange, getAnimationHandlers, scrollToBottom, stickyUserHeader, sessionIsWorking, defaultActivityExpanded, autoExpandedTurnIds, turnUiStates, onToggleTurnGroup, onProcessFoldOverride, chatRenderMode, shouldAnimateUserMessage, onUserAnimationConsumed, activeStreamingPhase }) => {
    const renderEntry = React.useCallback((entry: RenderEntry) => {
        return (
            <MessageListEntry
                key={entry.key}
                entry={entry}
                onMessageContentChange={onMessageContentChange}
                getAnimationHandlers={getAnimationHandlers}
                scrollToBottom={scrollToBottom}
                stickyUserHeader={stickyUserHeader}
                sessionIsWorking={sessionIsWorking}
                defaultActivityExpanded={defaultActivityExpanded}
                autoExpandedTurnIds={autoExpandedTurnIds}
                turnUiStates={turnUiStates}
                onToggleTurnGroup={onToggleTurnGroup}
                onProcessFoldOverride={onProcessFoldOverride}
                chatRenderMode={chatRenderMode}
                shouldAnimateUserMessage={shouldAnimateUserMessage}
                onUserAnimationConsumed={onUserAnimationConsumed}
                activeStreamingMessageId={null}
                activeStreamingPhase={activeStreamingPhase}
            />
        );
    }, [activeStreamingPhase, autoExpandedTurnIds, chatRenderMode, defaultActivityExpanded, getAnimationHandlers, onMessageContentChange, onProcessFoldOverride, onToggleTurnGroup, onUserAnimationConsumed, scrollToBottom, sessionIsWorking, shouldAnimateUserMessage, stickyUserHeader, turnUiStates]);

    const paddingTop = shouldVirtualize && virtualRows.length > 0
        ? Math.max(0, (virtualRows[0]?.start ?? 0) - scrollMargin)
        : 0;
    if (!shouldVirtualize) {
        return (
            <div ref={contentRef} className="relative w-full">
                {entries.map((entry) => (
                    <div
                        key={entry.key}
                        data-turn-entry={entry.key}
                    >
                        {renderEntry(entry)}
                    </div>
                ))}
            </div>
        );
    }

    if (virtualRows.length === 0 && entries.length > 0) {
        return (
            <div ref={contentRef} className="relative w-full">
                {entries.map((entry) => (
                    <div
                        key={entry.key}
                        data-turn-entry={entry.key}
                    >
                        {renderEntry(entry)}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div
            ref={contentRef}
            className="relative w-full"
            style={{ height: `${Math.max(0, totalSize)}px` }}
        >
            <div style={{ paddingTop: `${paddingTop}px` }}>
                {virtualRows.map((virtualRow) => {
                    const entry = entries[virtualRow.index];
                    if (!entry) {
                        return null;
                    }

                    return (
                        <div
                            key={virtualRow.key}
                            ref={measureElement}
                            data-index={virtualRow.index}
                            data-turn-entry={entry.key}
                        >
                            {renderEntry(entry)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

StaticHistoryList.displayName = 'StaticHistoryList';

const StreamingTailContent: React.FC<{
    entry: RenderEntry;
    sessionDirectory?: string | null;
    onMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    scrollToBottom?: () => void;
    stickyUserHeader: boolean;
    sessionIsWorking: boolean;
    defaultActivityExpanded: boolean;
    autoExpandedTurnIds: Set<string>;
    turnUiStates: Map<string, TurnUiState>;
    onToggleTurnGroup: (turnId: string, currentExpanded: boolean) => void;
    onProcessFoldOverride: (turnId: string, foldId: string, expanded: boolean) => void;
    chatRenderMode: 'sorted' | 'live';
    planModeEnabled: boolean;
    shouldAnimateUserMessage: (message: ChatMessageEntry) => boolean;
    onUserAnimationConsumed: (messageId: string) => void;
    activeStreamingMessageId?: string | null;
    activeStreamingPhase?: StreamPhase | null;
}> = ({
    entry,
    sessionDirectory,
    onMessageContentChange,
    getAnimationHandlers,
    scrollToBottom,
    stickyUserHeader,
    sessionIsWorking,
    defaultActivityExpanded,
    autoExpandedTurnIds,
    turnUiStates,
    onToggleTurnGroup,
    onProcessFoldOverride,
    chatRenderMode,
    planModeEnabled,
    shouldAnimateUserMessage,
    onUserAnimationConsumed,
    activeStreamingMessageId,
    activeStreamingPhase,
}) => {
    // Live parts reinjected only in this leaf — bulk projection freezes streaming parts via suspendPartUpdates.
    const liveParts = useSessionParts(activeStreamingMessageId ?? '', sessionDirectory ?? undefined);
    const liveEntry = React.useMemo(
        () => buildLiveStreamingEntry(entry, {
            activeStreamingMessageId,
            liveParts,
            showTextJustificationActivity: chatRenderMode === 'sorted',
            planModeEnabled,
        }),
        [activeStreamingMessageId, chatRenderMode, entry, liveParts, planModeEnabled],
    );

    return (
        <MessageListEntry
            entry={liveEntry}
            onMessageContentChange={onMessageContentChange}
            getAnimationHandlers={getAnimationHandlers}
            scrollToBottom={scrollToBottom}
            stickyUserHeader={stickyUserHeader}
            sessionIsWorking={sessionIsWorking}
            defaultActivityExpanded={defaultActivityExpanded}
            autoExpandedTurnIds={autoExpandedTurnIds}
            turnUiStates={turnUiStates}
            onToggleTurnGroup={onToggleTurnGroup}
            onProcessFoldOverride={onProcessFoldOverride}
            chatRenderMode={chatRenderMode}
            shouldAnimateUserMessage={shouldAnimateUserMessage}
            onUserAnimationConsumed={onUserAnimationConsumed}
            activeStreamingMessageId={activeStreamingMessageId}
            activeStreamingPhase={activeStreamingPhase}
        />
    );
};

StreamingTailContent.displayName = 'StreamingTailContent';

const MessageList = React.forwardRef<MessageListHandle, MessageListProps>(({ 
    sessionKey,
    sessionDirectory = null,
    turnStart,
    disableStaging: _disableStaging,
    messages,
    sessionIsWorking = false,
    activeStreamingMessageId = null,
    activeStreamingPhase = null,
    retryOverlay = null,
    onMessageContentChange,
    getAnimationHandlers,
    hasMoreAbove,
    isLoadingOlder,
    onLoadOlder,
    onExplicitScrollInteraction,
    scrollToBottom,
    scrollRef,
    initialPinToBottom,
    onInitialBottomReady,
    onViewportStabilize,
}, ref) => {
    streamPerfCount('ui.message_list.render');
    void _disableStaging;
    const stickyUserHeader = useUIStore(state => state.stickyUserHeader);
    const { isMobile } = useDeviceInfo();
    const chatRenderMode = useUIStore((state) => state.chatRenderMode);
    const activityRenderMode = useUIStore((state) => state.activityRenderMode);
    const defaultActivityExpanded = false;
    const [turnUiStates, setTurnUiStates] = React.useState<Map<string, TurnUiState>>(() => new Map());
    const [autoExpandedTurnIds, setAutoExpandedTurnIds] = React.useState<Set<string>>(() => new Set());
    const userAnimationRef = React.useRef<{
        sessionKey: string | undefined;
        previousOrder: string[];
        animatedIds: Set<string>;
    }>({ sessionKey: undefined, previousOrder: [], animatedIds: new Set() });
    const stableGetAnimationHandlers = useStableEvent(getAnimationHandlers);
    const stableOnLoadOlder = useStableEvent(onLoadOlder);
    const stableOnExplicitScrollInteraction = useStableEvent(onExplicitScrollInteraction);
    const stableScrollToBottom = useStableEvent(() => {
        scrollToBottom?.();
    });
    const stableOnInitialBottomReady = useStableEvent(onInitialBottomReady);

    React.useLayoutEffect(() => {
        setTurnUiStates(new Map());
        setAutoExpandedTurnIds(new Set());
    }, [activityRenderMode, chatRenderMode, sessionKey]);

    const toggleTurnGroup = React.useCallback((turnId: string, currentExpanded: boolean) => {
        setTurnUiStates((previous) => {
            const next = new Map(previous);
            next.set(turnId, {
                ...previous.get(turnId),
                isExpanded: !currentExpanded,
            });
            return next;
        });
    }, []);

    const setTurnProcessFoldOverride = React.useCallback((turnId: string, foldId: string, expanded: boolean) => {
        setTurnUiStates((previous) => {
            const current = previous.get(turnId);
            const processFoldOverrides = setProcessFoldOverride(current?.processFoldOverrides, foldId, expanded);
            const next = new Map(previous);
            next.set(turnId, {
                ...current,
                processFoldOverrides,
            });
            return next;
        });
    }, []);


    const baseDisplayMessages = React.useMemo(() => streamPerfMeasure('ui.message_list.base_display_ms', () => {
        const seenIdsFromTail = new Set<string>();
        const dedupedMessages: ChatMessageEntry[] = [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            const messageId = message.info?.id;
            if (typeof messageId === 'string') {
                if (seenIdsFromTail.has(messageId)) {
                    continue;
                }
                seenIdsFromTail.add(messageId);
            }
            dedupedMessages.push(getNormalizedMessageForDisplay(message));
        }
        dedupedMessages.reverse();

        const output: ChatMessageEntry[] = [];
        const compactionCommandIds = new Set<string>();
        for (let index = 0; index < dedupedMessages.length; index += 1) {
            const current = dedupedMessages[index];
            const currentWithRole = normalizeCompactionSummaryMessage(current, compactionCommandIds);
            if (hasCompactionPart(current) || current.parts.some((part) => part.type === 'text' && getPartText(part).trim() === '/compact')) {
                compactionCommandIds.add(current.info.id);
            }
            const previous = output.length > 0 ? output[output.length - 1] : undefined;

            if (isUserSubtaskMessage(previous)) {
                const bridge = isSyntheticSubtaskBridgeAssistant(currentWithRole);
                if (bridge.hide) {
                    output[output.length - 1] = withSubtaskSessionId(previous as ChatMessageEntry, bridge.taskSessionId);
                    continue;
                }
            }

            if (isUserShellMarkerMessage(previous)) {
                const bridge = getShellBridgeAssistantDetails(currentWithRole, getMessageId(previous));
                if (bridge.hide) {
                    output[output.length - 1] = withShellBridgeDetails(previous as ChatMessageEntry, bridge.details);
                    continue;
                }
            }

            output.push(currentWithRole);
        }

        return output;
    }), [messages]);

    const historyContentRef = React.useRef<HTMLDivElement | null>(null);
    const scrollInteractionUntilRef = React.useRef(0);
    const pendingViewportAnchorRef = React.useRef<MessageViewportAnchor | null>(null);
    const pendingViewportAnchorTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingTargetScrollRef = React.useRef<{ kind: 'turn' | 'message'; id: string } | null>(null);
    const clearPendingViewportAnchor = React.useCallback(() => {
        pendingViewportAnchorRef.current = null;
        if (pendingViewportAnchorTimerRef.current) {
            clearTimeout(pendingViewportAnchorTimerRef.current);
            pendingViewportAnchorTimerRef.current = null;
        }
    }, []);
    const clearPendingTargetScroll = React.useCallback(() => {
        pendingTargetScrollRef.current = null;
    }, []);
    const retainPendingTargetScroll = React.useCallback((kind: 'turn' | 'message', id: string) => {
        pendingTargetScrollRef.current = { kind, id };
    }, []);
    const resolveScrollContainer = React.useCallback((): HTMLDivElement | null => {
        if (scrollRef?.current) {
            return scrollRef.current;
        }
        if (typeof document === 'undefined') {
            return null;
        }
        return document.querySelector<HTMLDivElement>('[data-scrollbar="chat"]');
    }, [scrollRef]);
    const olderHistorySentinelRef = useOlderHistoryPrefetch({
        historyVersion: `${sessionKey}:${messages[0]?.info.id ?? 'empty'}:${messages.length}`,
        hasMoreAbove,
        isLoadingOlder,
        resolveScrollContainer,
        onLoadOlder: stableOnLoadOlder,
    });

    React.useEffect(() => {
        const container = resolveScrollContainer();
        if (!container) {
            return;
        }

        const markScrollInteraction = () => {
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            scrollInteractionUntilRef.current = now + SCROLL_INTERACTION_WINDOW_MS;
        };
        const handleScrollInteraction = () => {
            markScrollInteraction();
            stableOnExplicitScrollInteraction();
        };
        const markExplicitScrollInteraction = () => {
            clearPendingViewportAnchor();
            clearPendingTargetScroll();
            stableOnExplicitScrollInteraction();
            markScrollInteraction();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.key === 'ArrowUp'
                || event.key === 'ArrowDown'
                || event.key === 'PageUp'
                || event.key === 'PageDown'
                || event.key === 'Home'
                || event.key === 'End'
                || event.key === ' '
            ) {
                markExplicitScrollInteraction();
            }
        };

        container.addEventListener('scroll', handleScrollInteraction, { passive: true, capture: true });
        container.addEventListener('wheel', markExplicitScrollInteraction, { passive: true });
        container.addEventListener('touchstart', markExplicitScrollInteraction, { passive: true });
        container.addEventListener('touchmove', markExplicitScrollInteraction, { passive: true });
        container.addEventListener('pointerdown', markExplicitScrollInteraction, { passive: true });
        container.addEventListener('keydown', handleKeyDown);

        return () => {
            container.removeEventListener('scroll', handleScrollInteraction, { capture: true });
            container.removeEventListener('wheel', markExplicitScrollInteraction);
            container.removeEventListener('touchstart', markExplicitScrollInteraction);
            container.removeEventListener('touchmove', markExplicitScrollInteraction);
            container.removeEventListener('pointerdown', markExplicitScrollInteraction);
            container.removeEventListener('keydown', handleKeyDown);
        };
    }, [clearPendingTargetScroll, clearPendingViewportAnchor, resolveScrollContainer, stableOnExplicitScrollInteraction]);

    React.useEffect(() => clearPendingViewportAnchor, [clearPendingViewportAnchor]);
    React.useEffect(() => clearPendingTargetScroll, [clearPendingTargetScroll]);

    const displayMessages = React.useMemo(() => streamPerfMeasure('ui.message_list.retry_overlay_ms', () => {
        return applyRetryOverlay(baseDisplayMessages, {
            sessionId: retryOverlay?.sessionId ?? null,
            message: retryOverlay?.message ?? 'Quota limit reached. Retrying automatically.',
            confirmedAt: retryOverlay?.confirmedAt,
            fallbackTimestamp: retryOverlay?.fallbackTimestamp ?? 0,
        });
    }), [baseDisplayMessages, retryOverlay]);

    const planModeEnabled = useFeatureFlagsStore((state) => state.planModeEnabled);
    const { projection, staticTurns, streamingTurn } = useTurnRecords(displayMessages, {
        sessionKey,
        showTextJustificationActivity: true,
        planModeEnabled,
    });

    const buildUngroupedEntry = React.useCallback((message: ChatMessageEntry, index: number, nextMessage?: ChatMessageEntry): RenderEntry => {
        const role = resolveMessageRole(message);
        let assistantHeaderMessageId: string | undefined;
        let turnGroupingContext: TurnGroupingContext | undefined;

        if (role === 'assistant') {
            let chainStartIndex = index;
            while (chainStartIndex > 0) {
                const previous = displayMessages[chainStartIndex - 1];
                if (!previous || resolveMessageRole(previous) !== 'assistant' || !projection.ungroupedMessageIds.has(previous.info.id)) {
                    break;
                }
                chainStartIndex -= 1;
            }

            let chainEndIndex = index;
            while (chainEndIndex < displayMessages.length - 1) {
                const next = displayMessages[chainEndIndex + 1];
                if (!next || resolveMessageRole(next) !== 'assistant' || !projection.ungroupedMessageIds.has(next.info.id)) {
                    break;
                }
                chainEndIndex += 1;
            }

            const headerMessage = displayMessages[chainStartIndex] ?? message;
            const headerMessageId = headerMessage.info.id;
            assistantHeaderMessageId = headerMessageId;
            turnGroupingContext = {
                turnId: `ungrouped-assistant:${getMessageParentId(headerMessage) ?? headerMessageId}`,
                activityOwnerMessageId: headerMessageId,
                isFirstAssistantInTurn: index === chainStartIndex,
                isLastAssistantInTurn: index === chainEndIndex,
                isWorking: false,
                hasTools: false,
                hasReasoning: false,
                headerMessageId,
            } satisfies TurnGroupingContext;
        }

        return {
            kind: 'ungrouped',
            key: `msg:${message.info.id}`,
            message,
            previousMessage: index > 0 ? displayMessages[index - 1] : undefined,
            nextMessage: nextMessage ?? (index < displayMessages.length - 1 ? displayMessages[index + 1] : undefined),
            assistantHeaderMessageId,
            turnGroupingContext,
        };
    }, [displayMessages, projection.ungroupedMessageIds]);

    const staticRenderEntries = React.useMemo<RenderEntry[]>(() => streamPerfMeasure('ui.message_list.render_entries_ms', () => {
        // [sscity-mod] Group directive turns under their parent real user turn
        // so they share a single <section> and the real user's sticky header
        // stays active while scrolling through directive content.
        // We use parentID to find the correct parent turn rather than relying
        // on positional adjacency, because other real user turns may appear
        // between the parent and its directive children in the message array.
        const realUserEntryByTurnId = new Map<string, RenderEntry & { kind: 'turn' }>();
        const groupedTurnEntries: RenderEntry[] = [];

        // First pass: create entries for ALL turns in order
        for (const turn of staticTurns) {
            const entry: RenderEntry & { kind: 'turn' } = {
                kind: 'turn',
                key: `turn:${turn.turnId}`,
                turn,
                isLastTurn: turn.turnId === projection.lastTurnId,
                lastTurnId: projection.lastTurnId,
            };
            if (!turn.isDirectiveTurn) {
                realUserEntryByTurnId.set(turn.turnId, entry);
            }
            groupedTurnEntries.push(entry);
        }

        // Second pass: attach directive turns that have a valid parentID
        // to their parent real user turn, removing them from the flat list.
        const attachedDirectiveIds = new Set<string>();
        for (const turn of staticTurns) {
            if (!turn.isDirectiveTurn) {
                continue;
            }

            const directiveParentId = (turn.userMessage.info as { parentID?: string }).parentID;
            let parentEntry = directiveParentId
                ? realUserEntryByTurnId.get(directiveParentId)
                : undefined;

            if (!parentEntry && directiveParentId) {
                for (const [, entry] of realUserEntryByTurnId) {
                    if (entry.turn.assistantMessageIds.includes(directiveParentId)) {
                        parentEntry = entry;
                        break;
                    }
                }
            }

            if (parentEntry && isCompactionTurn(parentEntry.turn)) {
                parentEntry = undefined;
            }

            if (parentEntry) {
                const directives = parentEntry.directiveTurns ?? [];
                directives.push(turn);
                parentEntry.directiveTurns = directives;
                attachedDirectiveIds.add(turn.turnId);
                // Propagate isLastTurn: if a directive is the session's last
                // turn, mark its parent entry so streaming indicators work.
                if (turn.turnId === projection.lastTurnId) {
                    parentEntry.isLastTurn = true;
                }
            }
        }

        // Remove attached directives from the flat list (they render under their parent)
        const finalEntries = groupedTurnEntries.filter((entry) =>
            !(entry.kind === 'turn' && entry.turn.isDirectiveTurn && attachedDirectiveIds.has(entry.turn.turnId))
        );

        // [sscity-mod] Apply group-level windowing. turnStart is the number of
        // real-user-groups to skip from the top. Only count real-user groups
        // (non-directive standalone entries also count as a group).
        let windowedEntries: RenderEntry[];
        if (turnStart > 0) {
            let realGroupsSeen = 0;
            let sliceIndex = 0;
            for (let i = 0; i < finalEntries.length; i++) {
                const entry = finalEntries[i];
                if (entry.kind === 'turn' && !entry.turn.isDirectiveTurn) {
                    realGroupsSeen += 1;
                    if (realGroupsSeen > turnStart) {
                        sliceIndex = i;
                        break;
                    }
                }
            }
            if (realGroupsSeen <= turnStart) {
                sliceIndex = finalEntries.length;
            }
            windowedEntries = finalEntries.slice(sliceIndex);
        } else {
            windowedEntries = finalEntries;
        }

        if (projection.ungroupedMessageIds.size === 0) {
            return windowedEntries;
        }

        const turnEntryByUserMessageId = new Map<string, RenderEntry>();
        windowedEntries.forEach((entry) => {
            if (entry.kind === 'turn') {
                turnEntryByUserMessageId.set(entry.turn.userMessage.info.id, entry);
            }
        });

        const orderedEntries: RenderEntry[] = [];
        displayMessages.forEach((message, index) => {
            const turnEntry = turnEntryByUserMessageId.get(message.info.id);
            if (turnEntry) {
                orderedEntries.push(turnEntry);
                return;
            }

            if (!projection.ungroupedMessageIds.has(message.info.id)) {
                return;
            }

            orderedEntries.push(buildUngroupedEntry(message, index));
        });

        return orderedEntries;
    }), [buildUngroupedEntry, displayMessages, projection.lastTurnId, projection.ungroupedMessageIds, staticTurns, turnStart]);

    const trailingStreamingEntry = React.useMemo<RenderEntry | undefined>(() => {
        if (streamingTurn) {
            return {
                kind: 'turn',
                key: `turn:${streamingTurn.turnId}`,
                turn: streamingTurn,
                isLastTurn: streamingTurn.turnId === projection.lastTurnId,
                lastTurnId: projection.lastTurnId,
            } satisfies RenderEntry;
        }

        if (projection.ungroupedMessageIds.size === 0) {
            return undefined;
        }

        const lastMessage = displayMessages[displayMessages.length - 1];
        if (!lastMessage || !projection.ungroupedMessageIds.has(lastMessage.info.id)) {
            return undefined;
        }

        return buildUngroupedEntry(lastMessage, displayMessages.length - 1, undefined);
    }, [buildUngroupedEntry, displayMessages, projection.lastTurnId, projection.ungroupedMessageIds, streamingTurn]);

    if (trailingStreamingEntry) {
        streamPerfCount('ui.message_list.render.streaming');
    }

    const activeStreamingTurnId = React.useMemo(() => {
        if (!activeStreamingMessageId) {
            return null;
        }
        return projection.indexes.messageToTurnId.get(activeStreamingMessageId) ?? null;
    }, [activeStreamingMessageId, projection.indexes.messageToTurnId]);
    const activeStreamingTurnHasStop = React.useMemo(() => {
        if (!activeStreamingTurnId) {
            return false;
        }
        const activeTurn = projection.indexes.turnById.get(activeStreamingTurnId);
        return activeTurn ? turnHasStopSummary(activeTurn) : false;
    }, [activeStreamingTurnId, projection.indexes.turnById]);
    React.useLayoutEffect(() => {
        setAutoExpandedTurnIds((previous) => {
            return deriveAutoExpandedTurnIds({
                previous,
                sessionIsWorking,
                activeStreamingTurnId,
                activeStreamingTurnHasStop,
            });
        });
    }, [activeStreamingTurnHasStop, activeStreamingTurnId, sessionIsWorking]);

    const historyEntries = staticRenderEntries;
    const shouldVirtualizeHistory = historyEntries.length >= MESSAGE_LIST_VIRTUALIZE_THRESHOLD;
    const [historyScrollMargin, setHistoryScrollMargin] = React.useState(0);
    const historyEstimatedEntrySizeRef = React.useRef(MESSAGE_LIST_ESTIMATED_ENTRY_SIZE);
    const showLoadOlder = turnStart > 0 || hasMoreAbove;

    const historyVirtualizer = useVirtualizer({
        count: historyEntries.length,
        getScrollElement: resolveScrollContainer,
        estimateSize: () => historyEstimatedEntrySizeRef.current,
        scrollToFn: (offset, options, instance) => {
            const sizeElement = historyContentRef.current;
            if (sizeElement) {
                sizeElement.style.height = `${instance.getTotalSize()}px`;
            }
            elementScroll(offset, options, instance);
        },
        getItemKey: (index) => historyEntries[index]?.key ?? String(index),
        useAnimationFrameWithResizeObserver: true,
        overscan: getMessageListOverscan(isMobile),
        scrollMargin: historyScrollMargin,
        initialOffset: () => initialPinToBottom ? 0 : Number.MAX_SAFE_INTEGER,
        enabled: shouldVirtualizeHistory,
    });

    historyVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
        if (pendingTargetScrollRef.current) {
            return false;
        }
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        return shouldCompensateVirtualItemResize({
            isScrolling: instance.isScrolling,
            scrollInteractionActive: now < scrollInteractionUntilRef.current,
            processFoldTransitionActive: isProcessFoldTransitionActive(),
            isAtEnd: instance.isAtEnd(MESSAGE_LIST_AT_END_THRESHOLD_PX),
            itemIndex: item.index,
            firstVisibleIndex: instance.range?.startIndex,
        });
    };

    React.useEffect(() => {
        if (!shouldVirtualizeHistory) {
            return;
        }
        const sizes = historyVirtualizer.itemSizeCache;
        if (sizes.size < MESSAGE_LIST_ESTIMATE_MIN_SAMPLES) {
            return;
        }
        let total = 0;
        for (const size of sizes.values()) {
            total += size;
        }
        historyEstimatedEntrySizeRef.current = Math.min(
            MESSAGE_LIST_ESTIMATE_MAX,
            Math.max(MESSAGE_LIST_ESTIMATE_MIN, Math.round(total / sizes.size)),
        );
    });

    React.useLayoutEffect(() => {
        if (!shouldVirtualizeHistory) {
            setHistoryScrollMargin((previous) => (previous === 0 ? previous : 0));
            return;
        }

        const historyContent = historyContentRef.current;
        const scrollEl = resolveScrollContainer();
        if (!historyContent || !scrollEl) {
            return;
        }

        const nextMargin = Math.max(
            0,
            historyContent.getBoundingClientRect().top
                - scrollEl.getBoundingClientRect().top
                + scrollEl.scrollTop,
        );
        setHistoryScrollMargin((previous) => (
            Math.abs(previous - nextMargin) < 1 ? previous : nextMargin
        ));
    }, [hasMoreAbove, historyEntries.length, isLoadingOlder, resolveScrollContainer, shouldVirtualizeHistory, turnStart]);

    const historyTotalSize = historyVirtualizer.getTotalSize();
    const historyVirtualRows = shouldVirtualizeHistory && historyTotalSize >= 0
        ? historyVirtualizer.getVirtualItems()
        : [];
    const historyVirtualRangeStart = historyVirtualRows[0]?.index ?? -1;
    const historyVirtualRangeEnd = historyVirtualRows[historyVirtualRows.length - 1]?.index ?? -1;

    const allEntries = React.useMemo(() => {
        return trailingStreamingEntry ? [...historyEntries, trailingStreamingEntry] : historyEntries;
    }, [historyEntries, trailingStreamingEntry]);

    React.useLayoutEffect(() => {
        if (!initialPinToBottom) {
            return;
        }
        if (allEntries.length === 0) {
            stableOnInitialBottomReady();
            return;
        }

        const readNow = () => (
            typeof performance !== 'undefined' ? performance.now() : Date.now()
        );
        const startedAt = readNow();
        let lastLayoutChangeAt = startedAt;
        let lastScrollHeight = -1;
        let lastTotalSize = -1;
        let lastVirtualRangeEnd = -1;
        let frameId = 0;
        let resizeObserver: ResizeObserver | null = null;

        const pinCurrentViewport = (): HTMLDivElement | null => {
            const container = historyContentRef.current?.closest<HTMLDivElement>('[data-scrollbar="chat"]');
            if (!container || container.clientHeight <= 0) {
                return null;
            }

            container.scrollTop = container.scrollHeight + 4096;
            stableScrollToBottom();
            return container;
        };

        const settle = () => {
            const container = pinCurrentViewport();
            if (!container) {
                frameId = requestAnimationFrame(settle);
                return;
            }

            const totalSize = historyVirtualizer.getTotalSize();
            const virtualRows = shouldVirtualizeHistory
                ? historyVirtualizer.getVirtualItems()
                : [];
            const virtualRangeEnd = virtualRows[virtualRows.length - 1]?.index ?? -1;
            if (
                container.scrollHeight !== lastScrollHeight
                || totalSize !== lastTotalSize
                || virtualRangeEnd !== lastVirtualRangeEnd
            ) {
                lastScrollHeight = container.scrollHeight;
                lastTotalSize = totalSize;
                lastVirtualRangeEnd = virtualRangeEnd;
                lastLayoutChangeAt = readNow();
            }

            const hasLastHistoryEntry = !shouldVirtualizeHistory
                || historyEntries.length === 0
                || virtualRangeEnd >= historyEntries.length - 1;
            const distanceFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
            const now = readNow();
            if (shouldRevealInitialLatestViewport({
                atBottom: distanceFromBottom <= 1,
                hasLastHistoryEntry,
                startedAt,
                lastLayoutChangeAt,
                now,
                quietPeriodMs: INITIAL_LATEST_QUIET_PERIOD_MS,
                maxWaitMs: INITIAL_LATEST_MAX_WAIT_MS,
            })) {
                stableOnInitialBottomReady();
                return;
            }

            frameId = requestAnimationFrame(settle);
        };

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                lastLayoutChangeAt = readNow();
                pinCurrentViewport();
            });
            const container = historyContentRef.current?.closest<HTMLDivElement>('[data-scrollbar="chat"]');
            if (container) {
                resizeObserver.observe(container);
                const inner = container.firstElementChild;
                if (inner instanceof Element) {
                    resizeObserver.observe(inner);
                }
            }
            const historyContent = historyContentRef.current;
            if (historyContent) {
                resizeObserver.observe(historyContent);
            }
        }

        frameId = requestAnimationFrame(settle);

        return () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            resizeObserver?.disconnect();
        };
    }, [
        allEntries.length,
        historyEntries.length,
        historyVirtualizer,
        initialPinToBottom,
        shouldVirtualizeHistory,
        stableOnInitialBottomReady,
        stableScrollToBottom,
    ]);

    const stableHistoryContentChange = useStableEvent((reason?: ContentChangeReason) => {
        onMessageContentChange(reason);
    });

    const stableTailContentChange = useStableEvent((reason?: ContentChangeReason) => {
        onMessageContentChange(reason);
    });

    const currentUserOrder = React.useMemo(() => {
        return messages
            .filter((message) => resolveMessageRole(message) === 'user')
            .map((message) => message.info.id);
    }, [messages]);

    // Detect new user messages SYNCHRONOUSLY during render.
    // Must happen during render (not in useEffect) so that ToolRevealOnMount
    // receives animate=true on the FIRST render of the new message,
    // starting it hidden (opacity 0). An effect-based approach causes
    // the message to flash visible before the animation starts.
    {
        const anim = userAnimationRef.current;

        // Reset on session switch
        if (anim.sessionKey !== sessionKey) {
            anim.sessionKey = sessionKey;
            anim.previousOrder = currentUserOrder;
            anim.animatedIds = new Set();
        }

        // Detect appended user messages
        const prev = anim.previousOrder;
        if (currentUserOrder.length > prev.length) {
            const isAppendOnly = prev.every((id, i) => currentUserOrder[i] === id);
            if (isAppendOnly && hasPendingUserSendAnimation(sessionKey)) {
                for (let i = prev.length; i < currentUserOrder.length; i += 1) {
                    const id = currentUserOrder[i];
                    if (id && !anim.animatedIds.has(id)) {
                        if (!consumePendingUserSendAnimation(sessionKey)) break;
                        anim.animatedIds.add(id);
                    }
                }
            }
        }
        anim.previousOrder = currentUserOrder;
    }

    const shouldAnimateUserMessage = React.useCallback((message: ChatMessageEntry): boolean => {
        if (resolveMessageRole(message) !== 'user') return false;
        return userAnimationRef.current.animatedIds.has(message.info.id);
    }, []);

    const onUserAnimationConsumed = React.useCallback((messageId: string) => {
        userAnimationRef.current.animatedIds.delete(messageId);
    }, []);

    const messageIndexMap = React.useMemo(() => {
        const indexMap = new Map<string, number>();

        allEntries.forEach((entry, index) => {
            if (entry.kind === 'ungrouped') {
                indexMap.set(entry.message.info.id, index);
                return;
            }
            indexMap.set(entry.turn.userMessage.info.id, index);
            entry.turn.assistantMessages.forEach((message) => {
                indexMap.set(message.info.id, index);
            });
        });

        return indexMap;
    }, [allEntries]);

    const turnIndexMap = React.useMemo(() => {
        const indexMap = new Map<string, number>();
        allEntries.forEach((entry, index) => {
            if (entry.kind === 'turn') {
                indexMap.set(entry.turn.turnId, index);
            }
        });
        return indexMap;
    }, [allEntries]);

    const entryIndexMap = React.useMemo(() => {
        return new Map(allEntries.map((entry, index) => [entry.key, index]));
    }, [allEntries]);

    const findMessageElement = React.useCallback((messageId: string): HTMLElement | null => {
        const container = resolveScrollContainer();
        if (!container) {
            return null;
        }
        return container.querySelector(`[data-message-id="${messageId}"]`);
    }, [resolveScrollContainer]);

    const applyViewportAnchor = React.useCallback((anchor: MessageViewportAnchor): boolean => {
        const container = resolveScrollContainer();
        if (!container) {
            return false;
        }

        const containerRect = container.getBoundingClientRect();
        const messageElement = findMessageElement(anchor.messageId);
        const entryElement = container.querySelector<HTMLElement>(
            `[data-turn-entry="${CSS.escape(anchor.entryKey)}"]`,
        );
        const element = messageElement ?? entryElement;
        if (!element) {
            return false;
        }

        const desiredTop = messageElement ? anchor.offsetTop : anchor.entryOffsetTop;
        const currentTop = element.getBoundingClientRect().top - containerRect.top;
        const delta = currentTop - desiredTop;
        if (delta !== 0) {
            const nextScrollTop = container.scrollTop + delta;
            if (shouldVirtualizeHistory) {
                historyVirtualizer.scrollToOffset(nextScrollTop, { align: 'start', behavior: 'auto' });
            } else {
                container.scrollTop = nextScrollTop;
            }
        }
        return true;
    }, [findMessageElement, historyVirtualizer, resolveScrollContainer, shouldVirtualizeHistory]);

    const scrollHistoryIndexIntoView = React.useCallback((index: number, behavior: ScrollBehavior = 'auto') => {
        if (!shouldVirtualizeHistory || index < 0 || index >= historyEntries.length) {
            return false;
        }

        const virtualizerBehavior = behavior === 'smooth' ? 'smooth' : 'auto';
        historyVirtualizer.scrollToIndex(index, { align: 'start', behavior: virtualizerBehavior });
        return true;
    }, [historyEntries.length, historyVirtualizer, shouldVirtualizeHistory]);

    React.useLayoutEffect(() => {
        const pending = pendingTargetScrollRef.current;
        const container = resolveScrollContainer();
        if (!pending || !container) {
            return;
        }

        const selector = pending.kind === 'turn'
            ? `[data-turn-id="${CSS.escape(pending.id)}"]`
            : `[data-message-id="${CSS.escape(pending.id)}"]`;
        const element = container.querySelector<HTMLElement>(selector);
        if (!element) {
            return;
        }

        const offset = pending.kind === 'message' ? 50 : 0;
        const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top - offset;
        if (Math.abs(delta) <= 1) {
            return;
        }

        historyVirtualizer.scrollToOffset(container.scrollTop + delta, { align: 'start', behavior: 'auto' });
    }, [historyTotalSize, historyVirtualRangeEnd, historyVirtualRangeStart, historyVirtualizer, resolveScrollContainer]);

    React.useLayoutEffect(() => {
        const anchor = pendingViewportAnchorRef.current;
        if (!anchor || !applyViewportAnchor(anchor)) {
            return;
        }
        clearPendingViewportAnchor();
    }, [applyViewportAnchor, clearPendingViewportAnchor, historyTotalSize, historyVirtualRangeEnd, historyVirtualRangeStart]);

    React.useLayoutEffect(() => {
        clearPendingViewportAnchor();
    }, [clearPendingViewportAnchor, sessionKey]);

    const scrollMessageElementIntoView = React.useCallback((messageId: string, behavior: ScrollBehavior = 'auto') => {
        const container = resolveScrollContainer();
        if (!container) {
            return false;
        }
        const messageElement = findMessageElement(messageId);
        if (!messageElement) {
            return false;
        }

        const containerRect = container.getBoundingClientRect();
        const messageRect = messageElement.getBoundingClientRect();
        const offset = 50;
        const top = messageRect.top - containerRect.top + container.scrollTop - offset;
        container.scrollTo({ top, behavior });
        return true;
    }, [findMessageElement, resolveScrollContainer]);

    React.useLayoutEffect(() => {
        if (!ref) {
            return;
        }

        const handle: MessageListHandle = {
            scrollToTurnId: (turnId: string, options?: { behavior?: ScrollBehavior }) => {
                const behavior = options?.behavior ?? 'auto';
                const index = turnIndexMap.get(turnId);
                if (index === undefined) {
                    return false;
                }

                const container = resolveScrollContainer();
                if (!container) {
                    return false;
                }
                retainPendingTargetScroll('turn', turnId);
                const turnElement = container.querySelector<HTMLElement>(`[data-turn-id="${turnId}"]`);
                if (turnElement) {
                    turnElement.scrollIntoView({ behavior, block: 'start' });
                    return true;
                }

                const targetIsTail = trailingStreamingEntry !== undefined && index >= historyEntries.length;
                if (targetIsTail) {
                    return false;
                }

                return scrollHistoryIndexIntoView(index, behavior);
            },

            scrollToMessageId: (messageId: string, options?: { behavior?: ScrollBehavior }) => {
                const behavior = options?.behavior ?? 'auto';
                const index = messageIndexMap.get(messageId);
                if (index === undefined) {
                    return false;
                }

                retainPendingTargetScroll('message', messageId);

                return scrollMessageElementIntoView(messageId, behavior)
                    || (
                        trailingStreamingEntry !== undefined && index >= historyEntries.length
                            ? false
                            : scrollHistoryIndexIntoView(index, behavior)
                    );
            },

            captureViewportAnchor: () => {
                const container = resolveScrollContainer();
                if (!container) {
                    return null;
                }

                const containerRect = container.getBoundingClientRect();
                const nodes: HTMLElement[] = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
                const isVisibleAnchorCandidate = (node: HTMLElement, allowStuckSticky: boolean): boolean => {
                    const rect = node.getBoundingClientRect();
                    if (rect.bottom <= containerRect.top + 1) {
                        return false;
                    }
                    if (rect.top >= containerRect.bottom - 1) {
                        return false;
                    }

                    if (allowStuckSticky || typeof window === 'undefined') {
                        return true;
                    }

                    const computed = window.getComputedStyle(node);
                    const isStuckSticky = computed.position === 'sticky' && rect.top <= containerRect.top + 1;
                    return !isStuckSticky && !isInsideStuckStickyWrapper(node, containerRect);
                };

                const visibleCandidates = nodes.filter((node) => isVisibleAnchorCandidate(node, false));
                const stickyCandidates = nodes.filter((node) => isVisibleAnchorCandidate(node, true));
                const hasStableTurnEntry = (node: HTMLElement): boolean => {
                    return node.closest<HTMLElement>('[data-turn-entry]')?.dataset.turnEntry?.startsWith('turn:') === true;
                };
                const firstVisible = visibleCandidates.find(hasStableTurnEntry)
                    ?? visibleCandidates[0]
                    ?? stickyCandidates.find(hasStableTurnEntry)
                    ?? stickyCandidates[0];
                if (!firstVisible) {
                    return null;
                }

                const messageId = firstVisible.dataset.messageId;
                if (!messageId) {
                    return null;
                }

                const entry = firstVisible.closest<HTMLElement>('[data-turn-entry]');
                const entryKey = entry?.dataset.turnEntry;
                if (!entry || !entryKey) {
                    return null;
                }

                return {
                    messageId,
                    offsetTop: firstVisible.getBoundingClientRect().top - containerRect.top,
                    entryKey,
                    entryOffsetTop: entry.getBoundingClientRect().top - containerRect.top,
                };
            },

            restoreViewportAnchor: (anchor: MessageViewportAnchor) => {
                const container = resolveScrollContainer();
                if (!container) {
                    return false;
                }

                const index = messageIndexMap.get(anchor.messageId) ?? entryIndexMap.get(anchor.entryKey);
                if (index === undefined) {
                    return false;
                }

                if (applyViewportAnchor(anchor)) {
                    clearPendingViewportAnchor();
                    return true;
                }

                if (shouldVirtualizeHistory && index < historyEntries.length) {
                    pendingViewportAnchorRef.current = anchor;
                    if (pendingViewportAnchorTimerRef.current) {
                        clearTimeout(pendingViewportAnchorTimerRef.current);
                    }
                    pendingViewportAnchorTimerRef.current = setTimeout(clearPendingViewportAnchor, 1200);
                    scrollHistoryIndexIntoView(index, 'auto');
                    return true;
                }

                return false;
            },

            scrollToBottom: () => {
                clearPendingTargetScroll();
                if (shouldVirtualizeHistory && historyEntries.length > 0) {
                    historyVirtualizer.scrollToIndex(historyEntries.length - 1, { align: 'end' });
                    return;
                }
                const container = resolveScrollContainer();
                if (container) {
                    container.scrollTop = container.scrollHeight - container.clientHeight;
                }
            },
        };

        if (typeof ref === 'function') {
            ref(handle);
            return () => {
                ref(null);
            };
        }

        const objectRef = ref;
        objectRef.current = handle;
        return () => {
            objectRef.current = null;
        };
    }, [applyViewportAnchor, clearPendingTargetScroll, clearPendingViewportAnchor, entryIndexMap, findMessageElement, historyEntries.length, historyVirtualizer, messageIndexMap, resolveScrollContainer, retainPendingTargetScroll, scrollHistoryIndexIntoView, scrollMessageElementIntoView, shouldVirtualizeHistory, trailingStreamingEntry, turnIndexMap, ref]);

    const prevTotalSizeRef = React.useRef(-1);
    const prevEntryCountRef = React.useRef(-1);
    React.useEffect(() => {
        const sizeChanged = prevTotalSizeRef.current >= 0 && prevTotalSizeRef.current !== historyTotalSize;
        const countChanged = prevEntryCountRef.current >= 0 && prevEntryCountRef.current !== allEntries.length;
        if (sizeChanged || countChanged) {
            onViewportStabilize?.();
        }
        prevTotalSizeRef.current = historyTotalSize;
        prevEntryCountRef.current = allEntries.length;
    }, [historyTotalSize, allEntries.length, onViewportStabilize]);

    const disableFadeIn = false;

    return (
        <div>
                {showLoadOlder && (
                    <div ref={olderHistorySentinelRef} className="flex justify-center py-3">
                        {isLoadingOlder ? (
                            <span className="text-xs uppercase tracking-wide text-muted-foreground/80">
                                Loading…
                            </span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    void stableOnLoadOlder({ userInitiated: true });
                                }}
                                className="text-xs uppercase tracking-wide text-muted-foreground/80 hover:text-foreground"
                            >
                                Load older messages
                            </button>
                        )}
                    </div>
                )}

                <FadeInDisabledProvider disabled={disableFadeIn}>
                    <div className="relative w-full">
                        <StaticHistoryList
                            entries={historyEntries}
                            shouldVirtualize={shouldVirtualizeHistory}
                            virtualRows={historyVirtualRows}
                            totalSize={historyTotalSize}
                            scrollMargin={historyScrollMargin}
                            measureElement={historyVirtualizer.measureElement}
                            contentRef={historyContentRef}
                            onMessageContentChange={stableHistoryContentChange}
                            getAnimationHandlers={stableGetAnimationHandlers}
                            scrollToBottom={stableScrollToBottom}
                            stickyUserHeader={stickyUserHeader}
                            sessionIsWorking={sessionIsWorking}
                            defaultActivityExpanded={defaultActivityExpanded}
                            autoExpandedTurnIds={autoExpandedTurnIds}
                            turnUiStates={turnUiStates}
                            onToggleTurnGroup={toggleTurnGroup}
                            onProcessFoldOverride={setTurnProcessFoldOverride}
                            chatRenderMode={chatRenderMode}
                            shouldAnimateUserMessage={shouldAnimateUserMessage}
                            onUserAnimationConsumed={onUserAnimationConsumed}
                            activeStreamingPhase={activeStreamingPhase}
                        />
                        {trailingStreamingEntry ? (
                            <StreamingTailContent
                                entry={trailingStreamingEntry}
                                sessionDirectory={sessionDirectory}
                                onMessageContentChange={stableTailContentChange}
                                getAnimationHandlers={stableGetAnimationHandlers}
                                scrollToBottom={stableScrollToBottom}
                                stickyUserHeader={stickyUserHeader}
                                sessionIsWorking={sessionIsWorking}
                                defaultActivityExpanded={defaultActivityExpanded}
                                autoExpandedTurnIds={autoExpandedTurnIds}
                                turnUiStates={turnUiStates}
                                onToggleTurnGroup={toggleTurnGroup}
                                onProcessFoldOverride={setTurnProcessFoldOverride}
                                chatRenderMode={chatRenderMode}
                                planModeEnabled={planModeEnabled}
                                shouldAnimateUserMessage={shouldAnimateUserMessage}
                                onUserAnimationConsumed={onUserAnimationConsumed}
                                activeStreamingMessageId={activeStreamingMessageId}
                                activeStreamingPhase={activeStreamingPhase}
                            />
                        ) : null}
                    </div>
                </FadeInDisabledProvider>

        </div>
    );
});

MessageList.displayName = 'MessageList';

export default React.memo(MessageList);

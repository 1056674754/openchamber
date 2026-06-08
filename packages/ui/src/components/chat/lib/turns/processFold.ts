import type { ChatMessageEntry, TurnRecord } from './types';
import { getMessageFinishReason } from '@/lib/messageCompletion';

const getMessageFinish = (message: ChatMessageEntry | undefined): string | undefined => {
    return getMessageFinishReason(message?.info, message?.parts);
};

export const turnHasStopSummary = (turn: TurnRecord): boolean => {
    const lastAssistant = turn.assistantMessages[turn.assistantMessages.length - 1];
    return getMessageFinish(lastAssistant) === 'stop';
};

export const turnContainsMessageId = (turn: TurnRecord, messageId: string | null | undefined): boolean => {
    if (!messageId) {
        return false;
    }

    if (turn.userMessage.info.id === messageId) {
        return true;
    }

    return turn.assistantMessages.some((assistant) => assistant.info.id === messageId);
};

export interface ProcessFoldStateInput {
    turn: TurnRecord;
    sessionIsWorking: boolean;
    defaultActivityExpanded: boolean;
    autoExpandedTurnIds: Set<string>;
    activeStreamingTurnId?: string | null;
    lastTurnId?: string | null;
}

export const deriveProcessFoldState = ({
    turn,
    sessionIsWorking,
    defaultActivityExpanded,
    autoExpandedTurnIds,
    activeStreamingTurnId,
    lastTurnId,
}: ProcessFoldStateInput): { expanded: boolean; enabled: boolean } => {
    const hasStopSummary = turnHasStopSummary(turn);
    const isLastTurn = lastTurnId ? turn.turnId === lastTurnId : true;
    const activeTurnMatches = activeStreamingTurnId ? turn.turnId === activeStreamingTurnId : true;
    const isLiveIncompleteTurn = sessionIsWorking && isLastTurn && activeTurnMatches && !hasStopSummary;
    const isAutoExpandedIncompleteTurn = sessionIsWorking
        && isLastTurn
        && autoExpandedTurnIds.has(turn.turnId)
        && !hasStopSummary;
    const expanded = defaultActivityExpanded || isAutoExpandedIncompleteTurn || isLiveIncompleteTurn;

    return {
        expanded,
        enabled: !isLiveIncompleteTurn && !isAutoExpandedIncompleteTurn,
    };
};

export interface AutoExpandedTurnIdsInput {
    previous: Set<string>;
    sessionIsWorking: boolean;
    activeStreamingTurnId: string | null;
    activeStreamingTurnHasStop: boolean;
}

export const deriveAutoExpandedTurnIds = ({
    previous,
    sessionIsWorking,
    activeStreamingTurnId,
    activeStreamingTurnHasStop,
}: AutoExpandedTurnIdsInput): Set<string> => {
    if (!sessionIsWorking || !activeStreamingTurnId || activeStreamingTurnHasStop) {
        return previous.size === 0 ? previous : new Set();
    }

    if (previous.size === 1 && previous.has(activeStreamingTurnId)) {
        return previous;
    }

    return new Set([activeStreamingTurnId]);
};

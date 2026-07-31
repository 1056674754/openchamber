import type { Part } from '@opencode-ai/sdk/v2';

import { filterSyntheticParts } from '@/lib/messages/synthetic';
import { normalizeParts } from '../../message/partUtils';
import { projectTurnRecords } from './projectTurnRecords';
import type { ChatMessageEntry, TurnRecord } from './types';

export type StreamingTailEntry =
    | {
        kind: 'ungrouped';
        key: string;
        message: ChatMessageEntry;
        previousMessage?: ChatMessageEntry;
        nextMessage?: ChatMessageEntry;
    }
    | { kind: 'turn'; key: string; turn: TurnRecord; isLastTurn: boolean };

type BuildLiveStreamingEntryOptions = {
    activeStreamingMessageId: string | null | undefined;
    liveParts: Part[];
    showTextJustificationActivity: boolean;
    planModeEnabled: boolean;
};

const withLiveParts = (
    message: ChatMessageEntry,
    activeStreamingMessageId: string,
    liveParts: Part[],
): ChatMessageEntry => {
    if (message.info.id !== activeStreamingMessageId || message.parts === liveParts) {
        return message;
    }

    const parts = filterSyntheticParts(normalizeParts(liveParts));
    return {
        ...message,
        parts,
    };
};

export const buildLiveStreamingEntry = <TEntry extends StreamingTailEntry>(
    entry: TEntry,
    options: BuildLiveStreamingEntryOptions,
): TEntry => {
    const activeStreamingMessageId = options.activeStreamingMessageId;
    if (!activeStreamingMessageId) {
        return entry;
    }

    if (entry.kind === 'ungrouped') {
        const message = withLiveParts(entry.message, activeStreamingMessageId, options.liveParts);
        if (message === entry.message) {
            return entry;
        }
        return {
            ...entry,
            message,
        };
    }

    let changed = false;
    const assistantMessages = entry.turn.assistantMessages.map((message) => {
        const next = withLiveParts(message, activeStreamingMessageId, options.liveParts);
        if (next !== message) {
            changed = true;
        }
        return next;
    });

    if (!changed) {
        return entry;
    }

    const projectionMessages = entry.turn.messages.length > 0
        ? [...entry.turn.messages]
            .sort((left, right) => left.order - right.order)
            .map((record) => withLiveParts(record.message, activeStreamingMessageId, options.liveParts))
        : [entry.turn.userMessage, ...assistantMessages];
    const projection = projectTurnRecords(projectionMessages, {
        showTextJustificationActivity: options.showTextJustificationActivity,
        mergeHiddenUserTurns: { planModeEnabled: options.planModeEnabled },
    });
    const turn = projection.indexes.turnById.get(entry.turn.turnId) ?? {
        ...entry.turn,
        assistantMessages,
        assistantMessageIds: assistantMessages.map((message) => message.info.id),
    };

    return {
        ...entry,
        turn,
    };
};

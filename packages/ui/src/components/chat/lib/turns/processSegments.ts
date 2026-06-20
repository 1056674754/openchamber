import type { ChatMessageEntry } from './types';
import { getAuxiliaryUserMessageKind } from '@/lib/messages/real-user';

export type ProcessMessageSegment =
    | { kind: 'fold'; messages: ChatMessageEntry[] }
    | { kind: 'pinned-message'; message: ChatMessageEntry };

const normalizeToolName = (toolName: unknown): string => {
    if (typeof toolName !== 'string') {
        return '';
    }

    const trimmed = toolName.trim().toLowerCase();
    if (!trimmed) {
        return '';
    }

    const withoutIndex = trimmed.replace(/:\d+$/, '');
    if (!withoutIndex.includes('.')) {
        return withoutIndex;
    }

    const parts = withoutIndex.split('.').filter(Boolean);
    return parts[parts.length - 1] ?? withoutIndex;
};

export const messageHasQuestionTool = (message: ChatMessageEntry): boolean => {
    return message.parts.some((part) => {
        if (part.type !== 'tool') {
            return false;
        }

        return normalizeToolName((part as { tool?: unknown }).tool) === 'question';
    });
};

export const messagePinsProcessFold = (message: ChatMessageEntry): boolean => {
    return messageHasQuestionTool(message)
        || getAuxiliaryUserMessageKind(message.parts, message.info) !== null;
};

export const segmentProcessMessagesByPinnedBoundaries = (
    messages: readonly ChatMessageEntry[],
): ProcessMessageSegment[] => {
    const segments: ProcessMessageSegment[] = [];
    let currentFold: ChatMessageEntry[] = [];

    const flushFold = () => {
        if (currentFold.length === 0) {
            return;
        }
        segments.push({ kind: 'fold', messages: currentFold });
        currentFold = [];
    };

    for (const message of messages) {
        if (messagePinsProcessFold(message)) {
            flushFold();
            segments.push({ kind: 'pinned-message', message });
            continue;
        }

        currentFold.push(message);
    }

    flushFold();
    return segments;
};

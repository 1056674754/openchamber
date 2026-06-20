import type { ChatMessageEntry, TurnRecord } from './types';

const getMessageParentId = (message: ChatMessageEntry): string | undefined => {
    const parentId = (message.info as { parentID?: unknown }).parentID;
    return typeof parentId === 'string' && parentId.trim().length > 0 ? parentId : undefined;
};

const collectDirectiveMessages = (turn: TurnRecord): ChatMessageEntry[] => {
    return [turn.userMessage, ...turn.assistantMessages];
};

export const getDirectiveParentId = getMessageParentId;

export const mergeDirectiveMessagesAfterAnchors = (
    messages: ChatMessageEntry[],
    directiveTurns: readonly TurnRecord[] | undefined,
): ChatMessageEntry[] => {
    if (!directiveTurns || directiveTurns.length === 0) {
        return messages;
    }

    const directivesByParentId = new Map<string, TurnRecord[]>();
    const unanchoredDirectives: TurnRecord[] = [];
    for (const directiveTurn of directiveTurns) {
        const parentId = getMessageParentId(directiveTurn.userMessage);
        if (!parentId) {
            unanchoredDirectives.push(directiveTurn);
            continue;
        }
        const existing = directivesByParentId.get(parentId);
        if (existing) {
            existing.push(directiveTurn);
        } else {
            directivesByParentId.set(parentId, [directiveTurn]);
        }
    }

    const merged: ChatMessageEntry[] = [];
    for (const message of messages) {
        merged.push(message);
        const anchoredDirectives = directivesByParentId.get(message.info.id);
        if (!anchoredDirectives) {
            continue;
        }
        for (const directiveTurn of anchoredDirectives) {
            merged.push(...collectDirectiveMessages(directiveTurn));
        }
        directivesByParentId.delete(message.info.id);
    }

    for (const directiveTurnsForMissingAnchor of directivesByParentId.values()) {
        for (const directiveTurn of directiveTurnsForMissingAnchor) {
            merged.push(...collectDirectiveMessages(directiveTurn));
        }
    }
    for (const directiveTurn of unanchoredDirectives) {
        merged.push(...collectDirectiveMessages(directiveTurn));
    }

    return merged;
};

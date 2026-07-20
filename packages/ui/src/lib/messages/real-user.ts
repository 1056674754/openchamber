import type { Message, Part } from '@opencode-ai/sdk/v2';

import { isFullySyntheticMessage } from './synthetic';
import { isSystemDirectiveMessage } from './system-directive';

const LIVE_STEER_PREAMBLE = 'The user sent the following live steering message while the current response was already running:';
const LIVE_STEER_TRAILER = 'Treat this as the latest user direction and continue the current task accordingly.';

export type AuxiliaryUserMessageKind = 'live-steer' | 'system-directive' | 'subtask' | 'synthetic';

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const recordHasLiveSteerMarker = (record: Record<string, unknown>): boolean => {
    return record.openchamberLiveSteer === true
        || record.openchamberDeliveryMode === 'steer'
        || record.deliveryMode === 'steer';
};

const messageInfoHasLiveSteerMarker = (messageInfo: unknown): boolean => {
    if (!isRecord(messageInfo)) {
        return false;
    }

    if (recordHasLiveSteerMarker(messageInfo)) {
        return true;
    }

    const metadata = messageInfo.metadata;
    return isRecord(metadata) && recordHasLiveSteerMarker(metadata);
};

const partHasLiveSteerMarker = (part: Part): boolean => {
    const record = part as unknown as Record<string, unknown>;
    if (recordHasLiveSteerMarker(record)) {
        return true;
    }

    const metadata = record.metadata;
    return isRecord(metadata) && recordHasLiveSteerMarker(metadata);
};

const getPartText = (part: Part): string => {
    if (part.type !== 'text') {
        return '';
    }
    const text = (part as { text?: unknown }).text;
    if (typeof text === 'string') {
        return text;
    }
    const content = (part as { content?: unknown }).content;
    return typeof content === 'string' ? content : '';
};

const hasSystemReminderText = (parts: Part[] | undefined): boolean => {
    if (!Array.isArray(parts)) {
        return false;
    }
    return parts.some((part) => getPartText(part).includes('<system-reminder>'));
};

const stripLiveSteerWrapper = (text: string): string => {
    const preambleIndex = text.indexOf(LIVE_STEER_PREAMBLE);
    if (preambleIndex < 0) {
        return text.replace(/<\/?system-reminder>/g, '').trim();
    }

    let body = text.slice(preambleIndex + LIVE_STEER_PREAMBLE.length);
    const trailerIndex = body.indexOf(LIVE_STEER_TRAILER);
    if (trailerIndex >= 0) {
        body = body.slice(0, trailerIndex);
    }

    return body
        .replace(/<\/?system-reminder>/g, '')
        .trim();
};

export const hasSubtaskPart = (parts: Part[] | undefined): boolean => {
    if (!Array.isArray(parts)) {
        return false;
    }

    return parts.some((part) => part?.type === 'subtask');
};

export const hasOpenChamberLiveSteerMarker = (parts: Part[] | undefined, messageInfo?: unknown): boolean => {
    if (messageInfoHasLiveSteerMarker(messageInfo)) {
        return true;
    }

    if (!Array.isArray(parts) || parts.length === 0) {
        return false;
    }

    return parts.some((part) => {
        if (partHasLiveSteerMarker(part)) {
            return true;
        }

        const text = getPartText(part);
        return text.includes(LIVE_STEER_PREAMBLE);
    });
};

export const extractOpenChamberLiveSteerText = (parts: Part[] | undefined): string | null => {
    if (!Array.isArray(parts)) {
        return null;
    }

    for (const part of parts) {
        const text = getPartText(part);
        if (!text.trim()) {
            continue;
        }

        const stripped = stripLiveSteerWrapper(text);
        if (stripped.length > 0) {
            return stripped;
        }
    }

    return null;
};

export const getAuxiliaryUserMessageKind = (
    parts: Part[] | undefined,
    messageInfo?: unknown,
): AuxiliaryUserMessageKind | null => {
    if (hasOpenChamberLiveSteerMarker(parts, messageInfo)) {
        return 'live-steer';
    }
    if (isSystemDirectiveMessage(parts) || hasSystemReminderText(parts)) {
        return 'system-directive';
    }
    if (hasSubtaskPart(parts)) {
        return 'subtask';
    }
    if (isFullySyntheticMessage(parts)) {
        return 'synthetic';
    }
    return null;
};

export const hasAuxiliaryUserMessageParts = (parts: Part[] | undefined, messageInfo?: unknown): boolean => {
    return getAuxiliaryUserMessageKind(parts, messageInfo) !== null;
};

export const hasRealUserMessageParts = (parts: Part[] | undefined, messageInfo?: unknown): boolean => {
    return !hasAuxiliaryUserMessageParts(parts, messageInfo);
};

export const isRealUserMessage = (message: Message, parts: Part[] | undefined): boolean => {
    const info = message as Message & { clientRole?: unknown; role?: unknown };
    const role = typeof info.clientRole === 'string' ? info.clientRole : info.role;
    return role === 'user'
        && Array.isArray(parts)
        && parts.length > 0
        && hasRealUserMessageParts(parts, message);
};

export const findLatestRealUserMessage = (
    messages: readonly Message[],
    partsByMessage: Readonly<Record<string, Part[] | undefined>>,
): Message | undefined => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (isRealUserMessage(message, partsByMessage[message.id])) {
            return message;
        }
    }
    return undefined;
};

import type { Part } from '@opencode-ai/sdk/v2';

import type { ChatMessageEntry } from './turns/types';
import { isRealUserMessage } from '@/lib/messages/real-user';
import { normalizeUserDisplayParts } from '../message/normalizeUserDisplayParts';

const USER_SHELL_MARKER = 'The following tool was executed by the user';

export type PromptPreviewCache = {
    normalizedParts: WeakMap<Part[], Part[]>;
    shellParts: Map<string, { command: string; parts: Part[] }>;
    previous: Map<string, Part[]>;
};

export const createPromptPreviewCache = (): PromptPreviewCache => ({
    normalizedParts: new WeakMap<Part[], Part[]>(),
    shellParts: new Map<string, { command: string; parts: Part[] }>(),
    previous: new Map<string, Part[]>(),
});

const resolveMessageRole = (message: ChatMessageEntry): string | null => {
    const info = message.info as { clientRole?: unknown; role?: unknown };
    if (typeof info.clientRole === 'string') return info.clientRole;
    return typeof info.role === 'string' ? info.role : null;
};

const getMessageParentId = (message: ChatMessageEntry): string | null => {
    const parentID = (message.info as { parentID?: unknown }).parentID;
    return typeof parentID === 'string' && parentID.length > 0 ? parentID : null;
};

const isUserShellMarkerMessage = (message: ChatMessageEntry): boolean => {
    if (resolveMessageRole(message) !== 'user') return false;

    return message.parts.some((part) => {
        if (part.type !== 'text') return false;
        const textPart = part as { text?: unknown; synthetic?: unknown; shellAction?: unknown };
        const text = typeof textPart.text === 'string' ? textPart.text.trim() : '';
        const hasShellAction = typeof textPart.shellAction === 'object' && textPart.shellAction !== null;
        return (textPart.synthetic === true && text.startsWith(USER_SHELL_MARKER))
            || (hasShellAction && text === '/shell');
    });
};

const findShellCommandForMessage = (messages: ChatMessageEntry[], userIndex: number): string | null => {
    const userMessage = messages[userIndex];
    if (!userMessage) return null;

    for (let index = userIndex + 1; index < messages.length; index += 1) {
        const candidate = messages[index];
        if (resolveMessageRole(candidate) === 'user') break;
        if (resolveMessageRole(candidate) !== 'assistant' || getMessageParentId(candidate) !== userMessage.info.id) continue;
        if (candidate.parts.length !== 1) continue;

        const part = candidate.parts[0] as {
            type?: unknown;
            tool?: unknown;
            state?: { input?: { command?: unknown } };
        };
        if (part.type !== 'tool' || typeof part.tool !== 'string' || part.tool.toLowerCase() !== 'bash') continue;
        const command = part.state?.input?.command;
        return typeof command === 'string' && command.trim().length > 0 ? command.trim() : null;
    }

    return null;
};

export const getPromptPreview = (parts: Part[], maxLength = 160): string => {
    const text = parts
        .filter((part): part is Part & { type: 'text'; text: string } => (
            part.type === 'text' && typeof (part as { text?: unknown }).text === 'string'
        ))
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
};

export const buildPromptPreviews = (
    messages: ChatMessageEntry[],
    cache = createPromptPreviewCache(),
): Map<string, Part[]> => {
    const previews = new Map<string, Part[]>();

    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (resolveMessageRole(message) !== 'user') continue;

        if (isUserShellMarkerMessage(message)) {
            const command = findShellCommandForMessage(messages, index) ?? '';
            const cachedShell = cache.shellParts.get(message.info.id);
            if (cachedShell?.command === command) {
                previews.set(message.info.id, cachedShell.parts);
            } else {
                const parts = [{ type: 'text', text: command ? `$ ${command}` : '/shell' } as Part];
                cache.shellParts.set(message.info.id, { command, parts });
                previews.set(message.info.id, parts);
            }
            continue;
        }

        if (!isRealUserMessage(message.info, message.parts)) continue;
        let displayParts = cache.normalizedParts.get(message.parts);
        if (!displayParts) {
            displayParts = normalizeUserDisplayParts(message.parts);
            cache.normalizedParts.set(message.parts, displayParts);
        }
        if (displayParts.length > 0) previews.set(message.info.id, displayParts);
    }

    if (previews.size === cache.previous.size) {
        let unchanged = true;
        for (const [turnId, parts] of previews) {
            if (cache.previous.get(turnId) !== parts) {
                unchanged = false;
                break;
            }
        }
        if (unchanged) return cache.previous;
    }

    cache.previous = previews;
    return previews;
};

export const resolvePromptNavigatorActiveTurnId = (
    turnIds: string[],
    previewsByTurnId: Map<string, Part[]>,
    activeTurnId: string | null,
): string | null => {
    const promptTurnIds = turnIds.filter((turnId) => previewsByTurnId.has(turnId));
    if (promptTurnIds.length === 0) return null;
    if (!activeTurnId) return promptTurnIds[promptTurnIds.length - 1];
    if (previewsByTurnId.has(activeTurnId)) return activeTurnId;

    const activeTurnIndex = turnIds.indexOf(activeTurnId);
    if (activeTurnIndex < 0) return null;

    for (let index = activeTurnIndex; index >= 0; index -= 1) {
        const turnId = turnIds[index];
        if (previewsByTurnId.has(turnId)) return turnId;
    }

    return promptTurnIds[0];
};

export const resolvePromptNavigatorVisibleTurnIds = (
    turnIds: string[],
    previewsByTurnId: Map<string, Part[]>,
    visibleTurnIds: string[],
): string[] => {
    const resolved: string[] = [];
    for (const turnId of visibleTurnIds) {
        const promptTurnId = resolvePromptNavigatorActiveTurnId(turnIds, previewsByTurnId, turnId);
        if (promptTurnId && resolved[resolved.length - 1] !== promptTurnId) {
            resolved.push(promptTurnId);
        }
    }
    return resolved;
};

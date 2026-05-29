import type { Part } from '@opencode-ai/sdk/v2';
import type { PermissionRequest } from '@/types/permission';
import type { QuestionRequest } from '@/types/question';

interface SessionLinkRecord {
    id: string;
    parentID?: string;
}

type MessageRecordWithParts = {
    info: { id?: string };
    parts: Part[];
};

type ToolAnchoredBlockingRequest = {
    id: string;
    tool?: {
        messageID?: string;
        callID?: string;
    };
};

export type InlineBlockingRequests = {
    questions: QuestionRequest[];
    permissions: PermissionRequest[];
};

const TOOL_KEY_SEPARATOR = '\u0000';

export const getToolRequestKey = (messageID: string, callID: string): string => {
    return `${messageID}${TOOL_KEY_SEPARATOR}${callID}`;
};

export const getBlockingRequestToolKey = (request: ToolAnchoredBlockingRequest): string | null => {
    const messageID = request.tool?.messageID;
    const callID = request.tool?.callID;
    if (!messageID || !callID) return null;
    return getToolRequestKey(messageID, callID);
};

export const collectVisibleToolRequestKeys = (messages: readonly MessageRecordWithParts[]): Set<string> => {
    const keys = new Set<string>();
    for (const message of messages) {
        const fallbackMessageID = message.info.id;
        if (!fallbackMessageID) continue;
        for (const part of message.parts) {
            if (part.type !== 'tool') continue;
            const partID = (part as { id?: unknown }).id;
            if (typeof partID !== 'string' || partID.length === 0) continue;
            const messageID = (part as { messageID?: unknown }).messageID;
            keys.add(getToolRequestKey(
                typeof messageID === 'string' && messageID.length > 0 ? messageID : fallbackMessageID,
                partID,
            ));
        }
    }
    return keys;
};

export const splitBlockingRequestsByVisibleTool = (
    questions: readonly QuestionRequest[],
    permissions: readonly PermissionRequest[],
    visibleToolRequestKeys: ReadonlySet<string>,
): {
    inlineByTool: Map<string, InlineBlockingRequests>;
    trailingQuestions: QuestionRequest[];
    trailingPermissions: PermissionRequest[];
} => {
    const inlineByTool = new Map<string, InlineBlockingRequests>();
    const trailingQuestions: QuestionRequest[] = [];
    const trailingPermissions: PermissionRequest[] = [];

    const ensureBucket = (key: string): InlineBlockingRequests => {
        const existing = inlineByTool.get(key);
        if (existing) return existing;
        const next: InlineBlockingRequests = { questions: [], permissions: [] };
        inlineByTool.set(key, next);
        return next;
    };

    for (const question of questions) {
        const key = getBlockingRequestToolKey(question);
        if (key && visibleToolRequestKeys.has(key)) {
            ensureBucket(key).questions.push(question);
        } else {
            trailingQuestions.push(question);
        }
    }

    for (const permission of permissions) {
        const key = getBlockingRequestToolKey(permission);
        if (key && visibleToolRequestKeys.has(key)) {
            ensureBucket(key).permissions.push(permission);
        } else {
            trailingPermissions.push(permission);
        }
    }

    return { inlineByTool, trailingQuestions, trailingPermissions };
};

export const collectVisibleSessionIdsForBlockingRequests = (
    sessions: SessionLinkRecord[] | undefined,
    currentSessionId: string | null,
): string[] => {
    if (!currentSessionId) return [];
    if (!Array.isArray(sessions) || sessions.length === 0) return [currentSessionId];

    const current = sessions.find((session) => session.id === currentSessionId);
    if (!current) return [currentSessionId];

    const childrenByParent = new Map<string, string[]>();
    for (const session of sessions) {
        if (!session.parentID) {
            continue;
        }
        const existing = childrenByParent.get(session.parentID) ?? [];
        existing.push(session.id);
        childrenByParent.set(session.parentID, existing);
    }

    const scoped = [currentSessionId];
    const seen = new Set(scoped);
    for (const sessionId of scoped) {
        const children = childrenByParent.get(sessionId) ?? [];
        for (const childId of children) {
            if (seen.has(childId)) {
                continue;
            }
            seen.add(childId);
            scoped.push(childId);
        }
    }

    return scoped;
};

export const flattenBlockingRequests = <T extends { id: string }>(
    source: Map<string, T[]>,
    sessionIds: string[],
): T[] => {
    if (sessionIds.length === 0) return [];
    const seen = new Set<string>();
    const result: T[] = [];

    for (const sessionId of sessionIds) {
        const entries = source.get(sessionId);
        if (!entries || entries.length === 0) continue;
        for (const entry of entries) {
            if (seen.has(entry.id)) continue;
            seen.add(entry.id);
            result.push(entry);
        }
    }

    return result;
};

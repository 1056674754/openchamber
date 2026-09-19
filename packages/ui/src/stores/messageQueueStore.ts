import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { z } from 'zod';
import type { Event } from '@opencode-ai/sdk/v2';
import { createInputHistoryIdentity, createInputHistorySubmission, useInputHistoryStore } from './useInputHistoryStore';
import { createDeferredSafeJSONStorage } from './utils/safeStorage';
import type { AttachedFile } from './types/sessionTypes';
import { contextPartMetadataSchema, type ContextPartMetadata } from '@/lib/messages/contextParts';
import { getQueuedMessagePreview } from '@/lib/messages/queuedMessagePreview';
import { updateDesktopSettings } from '@/lib/persistence';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { isVSCodeRuntime } from '@/lib/desktop';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
    resolvePersistedFollowUpBehavior,
    type FollowUpBehavior,
} from '@/lib/followUpBehavior';

export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = 'steer';

/**
 * Who delivers the queue. Web, desktop, and mobile talk to an OpenChamber
 * server that owns the queue and sends it whether or not any UI is open. VS
 * Code has no server of its own, so the extension UI keeps the local queue
 * and the foreground auto-send hook.
 */
export const isServerOwnedMessageQueue = (): boolean => !isVSCodeRuntime();

export interface QueuedMessageSendConfig {
    providerID: string;
    modelID: string;
    agent?: string;
    variant?: string;
}

/**
 * Context captured with a queued message: whatever the composer had attached
 * when the message was queued. It leaves the composer with the message, so
 * delivery (by the server, or by the auto-send hook in VS Code) carries it and
 * editing the message brings it back.
 */
export type QueuedContextPart =
    | {
        /** An attached context item: a draft chip or a linked issue/PR. Restored on edit. */
        kind: 'context';
        text: string;
        metadata: ContextPartMetadata;
        /** Delivered as its own synthetic part right before this one (a linked PR's reading instructions). */
        instructions?: string;
    }
    | {
        /** Derived from the message text (the skill instruction); re-derived when the text is sent again, so never restored. */
        kind: 'instruction';
        text: string;
    }
    | {
        /** Handed to the composer by another surface (conflict resolution); restored as pending on edit. */
        kind: 'synthetic';
        text: string;
    };

/** A captured context part as an outgoing message part, in send order. */
export const queuedContextToMessageParts = (context: readonly QueuedContextPart[]): Array<{
    type: 'text';
    text: string;
    synthetic: true;
    metadata?: ContextPartMetadata;
}> => context.flatMap((part) => {
    if (part.kind !== 'context') return [{ type: 'text' as const, text: part.text, synthetic: true as const }];
    const synthetic: { type: 'text'; text: string; synthetic: true; metadata?: ContextPartMetadata } = {
        type: 'text',
        text: part.text,
        synthetic: true,
    };
    synthetic.metadata = part.metadata;
    return part.instructions
        ? [{ type: 'text' as const, text: part.instructions, synthetic: true as const }, synthetic]
        : [synthetic];
});

export interface QueuedMessage {
    id: string;
    content: string;
    /** What is delivered: `content` without its leading agent mention, file mentions already resolved. Defaults to `content`. */
    text?: string;
    /** Agent mentioned at the start of `content`, delivered as an agent part. */
    agentMention?: string;
    attachments?: AttachedFile[];
    /** Context captured at queue time; delivered (and restored on edit) with the message. */
    context?: QueuedContextPart[];
    /** Bounded display-only context summary retained in server projections. */
    contextPreview?: string;
    createdAt: number;
    /** Authoritative routing captured at queue time. */
    sendTarget?: {
        directory?: string;
        serverId?: string;
    };
    /** Send config captured at queue time — used as-is when auto-sending */
    sendConfig?: QueuedMessageSendConfig;
}

interface QueuedMessageInput {
    content: string;
    /** Defaults to `content`. */
    text?: string;
    agentMention?: string;
    attachments?: AttachedFile[];
    context?: QueuedContextPart[];
    sendTarget?: QueuedMessage['sendTarget'];
    sendConfig?: QueuedMessageSendConfig;
}

const MAX_MESSAGES_PER_QUEUE = 20;
const CONTENT_CHAR_LIMIT = 200_000;

// ---------------------------------------------------------------------------
// Server contract (packages/web/server/lib/message-queue)
// ---------------------------------------------------------------------------

const serverSendConfigSchema = z.object({
    providerID: z.string().min(1),
    modelID: z.string().min(1),
    agent: z.string().optional(),
    variant: z.string().optional(),
});

const serverAttachmentSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    source: z.enum(['local', 'server', 'vscode']),
    serverPath: z.string().optional(),
    /** Present only on a taken item; broadcasts and snapshots omit payloads. */
    dataUrl: z.string().optional(),
});

const serverContextPartSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('context'),
        text: z.string(),
        metadata: contextPartMetadataSchema,
        instructions: z.string().optional(),
    }),
    z.object({ kind: z.literal('instruction'), text: z.string() }),
    z.object({ kind: z.literal('synthetic'), text: z.string() }),
]);

const serverItemSchema = z.object({
    id: z.string().min(1),
    createdAt: z.number(),
    content: z.string(),
    text: z.string(),
    agentMention: z.string().optional(),
    attachments: z.array(serverAttachmentSchema),
    /** Present only on a taken item; broadcasts and snapshots omit it like attachment payloads. */
    context: z.array(serverContextPartSchema).optional(),
    contextPreview: z.string().optional(),
    sendConfig: serverSendConfigSchema,
});

const serverSessionSchema = z.object({
    sessionId: z.string().min(1),
    directory: z.string(),
    items: z.array(serverItemSchema),
    sendingId: z.string().nullable(),
});

const serverSnapshotSchema = z.object({
    revision: z.number(),
    sessions: z.array(serverSessionSchema),
});

const serverSessionResponseSchema = z.object({
    revision: z.number(),
    session: serverSessionSchema,
});

const serverTakeResponseSchema = serverSessionResponseSchema.extend({ item: serverItemSchema });
const serverTakeAllResponseSchema = serverSessionResponseSchema.extend({ items: z.array(serverItemSchema) });

type ServerQueueSession = z.infer<typeof serverSessionSchema>;
type ServerQueueItem = z.infer<typeof serverItemSchema>;
type ServerQueueAttachment = z.infer<typeof serverAttachmentSchema>;

const decodeDataUrl = (dataUrl: string): ArrayBuffer | null => {
    const commaIndex = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || commaIndex === -1) return null;
    const meta = dataUrl.slice(5, commaIndex);
    const payload = dataUrl.slice(commaIndex + 1);
    try {
        if (meta.endsWith(';base64')) {
            const binary = atob(payload);
            const buffer = new ArrayBuffer(binary.length);
            const bytes = new Uint8Array(buffer);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            return buffer;
        }
        const encoded = new TextEncoder().encode(decodeURIComponent(payload));
        const buffer = new ArrayBuffer(encoded.byteLength);
        new Uint8Array(buffer).set(encoded);
        return buffer;
    } catch {
        return null;
    }
};

/** A taken item carries its payload; a projection item has an empty file. */
const toAttachedFile = (attachment: ServerQueueAttachment): AttachedFile => {
    const dataUrl = attachment.dataUrl ?? '';
    const bytes = dataUrl ? decodeDataUrl(dataUrl) : null;
    const file: AttachedFile = {
        id: attachment.id,
        file: new File(bytes ? [bytes] : [], attachment.filename, { type: attachment.mimeType }),
        dataUrl,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
        size: attachment.size,
        source: attachment.source,
    };
    if (attachment.serverPath) file.serverPath = attachment.serverPath;
    return file;
};

const toQueuedMessage = (item: ServerQueueItem): QueuedMessage => {
    const message: QueuedMessage = {
        id: item.id,
        content: item.content,
        text: item.text,
        createdAt: item.createdAt,
        sendConfig: { ...item.sendConfig },
    };
    if (item.agentMention) message.agentMention = item.agentMention;
    if (item.attachments.length > 0) message.attachments = item.attachments.map(toAttachedFile);
    if (item.context) message.context = item.context;
    if (item.contextPreview) message.contextPreview = item.contextPreview;
    return message;
};

type ServerQueueAttachmentInput = Omit<ServerQueueAttachment, 'dataUrl'> & { dataUrl: string };

type ServerQueueItemInput = {
    content: string;
    text: string;
    agentMention?: string;
    attachments: ServerQueueAttachmentInput[];
    context: QueuedContextPart[];
    contextPreview?: string;
    sendConfig: QueuedMessageSendConfig;
};

type ServerQueueRequestBody =
    | { directory: string; item: ServerQueueItemInput }
    | { itemIds: string[] }
    | { held: boolean };

const toServerAttachment = (attachment: AttachedFile): ServerQueueAttachmentInput => {
    const input: ServerQueueAttachmentInput = {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        source: attachment.source,
        dataUrl: attachment.dataUrl,
    };
    if (attachment.serverPath) input.serverPath = attachment.serverPath;
    return input;
};

const toServerItemInput = (message: QueuedMessageInput, sendConfig: QueuedMessageSendConfig): ServerQueueItemInput => {
    const item: ServerQueueItemInput = {
        content: message.content,
        text: message.text ?? message.content,
        attachments: (message.attachments ?? []).filter((file) => Boolean(file.dataUrl)).map(toServerAttachment),
        context: message.context ?? [],
        sendConfig,
    };
    if (message.agentMention) item.agentMention = message.agentMention;
    const contextPreview = getQueuedMessagePreview({ content: '', context: message.context });
    if (contextPreview) item.contextPreview = contextPreview;
    return item;
};

const requestJson = async <T,>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> => {
    const response = await runtimeFetch(path, init);
    if (!response.ok) {
        const error: Error & { status?: number } = new Error(`Message queue request failed (${response.status})`);
        error.status = response.status;
        throw error;
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Invalid message queue response');
    return parsed.data;
};

const jsonInit = (method: string, body?: ServerQueueRequestBody): RequestInit => {
    if (body === undefined) return { method };
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
};

const sessionPath = (sessionId: string) => `/api/message-queue/sessions/${encodeURIComponent(sessionId)}`;

/**
 * Runtime keys whose queue the server owns, established by a successful
 * hydration. Their entries are a projection and must not be persisted: a
 * stale local copy would resurrect messages the server already delivered.
 */
const serverOwnedRuntimeKeys = new Set<string>();

/** Server revision last applied per session; older snapshots are ignored. */
const appliedRevisions = new Map<string, number>();
let hydrationGeneration = 0;

interface MessageQueueState {
    queuedMessages: Record<string, QueuedMessage[]>; // sessionId → queue
    followUpBehavior: FollowUpBehavior;
    /**
     * Queued messages whose send is currently awaiting delivery, per session.
     *
     * A queued item is removed only after its send resolves, so between
     * dispatch and resolution it is still visible to every other reader — and
     * a composer submit merges the whole queue into its own send. Dispatchers
     * must skip entries listed here.
     *
     * Never persisted: a restart has no in-flight sends, and a stale flag would
     * strand a queued message permanently. With a server-owned queue this
     * mirrors the server's in-flight item.
     */
    sendingIds: Record<string, string[]>;
}

interface MessageQueueActions {
    addToQueue: (sessionId: string, message: QueuedMessageInput) => Promise<void>;
    removeFromQueue: (sessionId: string, messageId: string) => void;
    reorderQueue: (sessionId: string, fromId: string, toId: string) => void;
    restoreMessages: (sessionId: string, messages: QueuedMessage[]) => void;
    /** Removes the message and returns it in full, attachments and captured context included. */
    popToInput: (sessionId: string, messageId: string) => Promise<QueuedMessage | null>;
    /**
     * Removes what the composer is about to send itself — one message or every
     * message not already being delivered — and returns it in full.
     */
    takeForSend: (sessionId: string, messageId?: string) => Promise<QueuedMessage[]>;
    clearQueue: (sessionId: string) => void;
    /** Drops the local projection only (the session is gone); never a server call. */
    forgetQueue: (sessionId: string) => void;
    clearAllQueues: () => void;
    markSending: (sessionId: string, messageId: string) => void;
    clearSending: (sessionId: string, messageId: string) => void;
    getSendableQueue: (sessionId: string) => QueuedMessage[];
    setFollowUpBehavior: (behavior: FollowUpBehavior) => void;
    getQueueForSession: (sessionId: string) => QueuedMessage[];
    /** Server-owned queue: load the authoritative queue for the active runtime. */
    hydrate: () => Promise<void>;
    /** Server-owned queue: re-read the server after the event stream had a gap. */
    resync: () => Promise<void>;
    /** Server-owned queue: apply one session's authoritative state (broadcast or response). */
    applyServerSession: (session: ServerQueueSession, revision: number, expectedRuntimeKey?: string) => void;
    /** Server-owned queue: tell the server to hold or release a session's delivery. */
    setServerHold: (sessionId: string, held: boolean) => Promise<void>;
    resetForRuntimeSwitch: (previousRuntimeKey: string | null | undefined) => void;
}

type MessageQueueStore = MessageQueueState & MessageQueueActions;

type MessageQueuePersistedState = Pick<MessageQueueState, 'queuedMessages' | 'followUpBehavior'>;

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const parseSendTarget = (value: unknown): QueuedMessage['sendTarget'] => {
    if (!isRecord(value)) return undefined;
    const directory = typeof value.directory === 'string' ? value.directory : undefined;
    const serverId = typeof value.serverId === 'string' ? value.serverId : undefined;
    return directory || serverId ? { directory, serverId } : undefined;
};

const parseSendConfig = (value: unknown): QueuedMessage['sendConfig'] => {
    if (!isRecord(value) || typeof value.providerID !== 'string' || typeof value.modelID !== 'string') {
        return undefined;
    }
    return {
        providerID: value.providerID,
        modelID: value.modelID,
        agent: typeof value.agent === 'string' ? value.agent : undefined,
        variant: typeof value.variant === 'string' ? value.variant : undefined,
    };
};

const parseAttachedFile = (value: unknown): AttachedFile | null => {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || typeof value.dataUrl !== 'string'
        || typeof value.mimeType !== 'string'
        || typeof value.filename !== 'string'
        || typeof value.size !== 'number'
        || (value.source !== 'local' && value.source !== 'server' && value.source !== 'vscode')
        || typeof File === 'undefined') {
        return null;
    }
    const file = value.file instanceof File
        ? value.file
        : new File([], value.filename, { type: value.mimeType });
    return {
        id: value.id,
        file,
        dataUrl: value.dataUrl,
        mimeType: value.mimeType,
        filename: value.filename,
        size: value.size,
        source: value.source,
        serverPath: typeof value.serverPath === 'string' ? value.serverPath : undefined,
        vscodePath: typeof value.vscodePath === 'string' ? value.vscodePath : undefined,
        vscodeSource: value.vscodeSource === 'file' || value.vscodeSource === 'selection'
            ? value.vscodeSource
            : undefined,
    };
};

const parseQueuedContextPart = (value: unknown): QueuedContextPart | null => {
    if (!isRecord(value) || typeof value.text !== 'string') return null;
    if (value.kind === 'instruction' || value.kind === 'synthetic') {
        return { kind: value.kind, text: value.text };
    }
    if (value.kind !== 'context') return null;
    const metadata = contextPartMetadataSchema.safeParse(value.metadata);
    if (!metadata.success) return null;
    const part: QueuedContextPart = { kind: 'context', text: value.text, metadata: metadata.data };
    if (typeof value.instructions === 'string') part.instructions = value.instructions;
    return part;
};

const parseQueuedMessage = (value: unknown): QueuedMessage | null => {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || typeof value.content !== 'string'
        || typeof value.createdAt !== 'number') {
        return null;
    }
    const attachments = Array.isArray(value.attachments)
        ? value.attachments.map(parseAttachedFile).filter((file): file is AttachedFile => file !== null)
        : undefined;
    const context = Array.isArray(value.context)
        ? value.context.map(parseQueuedContextPart).filter((part): part is QueuedContextPart => part !== null)
        : undefined;
    return {
        id: value.id,
        content: value.content,
        text: typeof value.text === 'string' ? value.text : undefined,
        agentMention: typeof value.agentMention === 'string' ? value.agentMention : undefined,
        createdAt: value.createdAt,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
        context: context && context.length > 0 ? context : undefined,
        sendTarget: parseSendTarget(value.sendTarget),
        sendConfig: parseSendConfig(value.sendConfig),
    };
};

const parseQueuedMessages = (value: unknown): Record<string, QueuedMessage[]> => {
    if (!isRecord(value)) return {};
    const result: Record<string, QueuedMessage[]> = {};
    for (const [sessionId, messages] of Object.entries(value)) {
        if (!Array.isArray(messages)) continue;
        const parsed = messages.map(parseQueuedMessage).filter((message): message is QueuedMessage => message !== null);
        if (parsed.length > 0) result[sessionId] = parsed;
    }
    return result;
};

export const migrateMessageQueuePersistedState = (value: unknown): MessageQueuePersistedState => {
    const persisted = isRecord(value) ? value : {};
    return {
        queuedMessages: parseQueuedMessages(persisted.queuedMessages),
        followUpBehavior: resolvePersistedFollowUpBehavior(
            persisted.followUpBehavior,
            persisted.queueModeEnabled,
        ),
    };
};

const withoutKey = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
    const { [key]: _removed, ...rest } = record;
    void _removed;
    return rest;
};

const removeMessageLocally = (
    state: Pick<MessageQueueState, 'queuedMessages'>,
    key: string,
    messageId: string,
): Pick<MessageQueueState, 'queuedMessages'> => {
    const newQueue = (state.queuedMessages[key] ?? []).filter((m) => m.id !== messageId);
    if (newQueue.length === 0) return { queuedMessages: withoutKey(state.queuedMessages, key) };
    return { queuedMessages: { ...state.queuedMessages, [key]: newQueue } };
};

export const useMessageQueueStore = create<MessageQueueStore>()(
    devtools(
        persist(
            (set, get) => {
                const applyServerSession = (
                    session: ServerQueueSession,
                    revision: number,
                    expectedRuntimeKey?: string,
                ) => {
                    if (expectedRuntimeKey !== undefined && expectedRuntimeKey !== getRuntimeKey()) return;
                    const key = session.sessionId;
                    if ((appliedRevisions.get(key) ?? -1) > revision) return;
                    appliedRevisions.set(key, revision);
                    set((state) => {
                        const queue = session.items.map(toQueuedMessage);
                        const queuedMessages = queue.length > 0
                            ? { ...state.queuedMessages, [key]: queue }
                            : withoutKey(state.queuedMessages, key);
                        const sendingIds = session.sendingId
                            ? { ...state.sendingIds, [key]: [session.sendingId] }
                            : withoutKey(state.sendingIds, key);
                        return { queuedMessages, sendingIds };
                    });
                };

                /** Server state wins; a failed round-trip re-reads it instead of guessing. */
                const refreshSession = async (sessionId: string) => {
                    try {
                        const snapshot = await requestJson(serverSnapshotSchema, '/api/message-queue');
                        const session = snapshot.sessions.find((entry) => entry.sessionId === sessionId)
                            ?? { sessionId, directory: '', items: [], sendingId: null };
                        applyServerSession(session, snapshot.revision);
                    } catch {
                        // Offline: keep the optimistic projection; the next broadcast or hydration corrects it.
                    }
                };

                const serverMutation = async (
                    sessionId: string,
                    path: string,
                    init: RequestInit,
                ) => {
                    try {
                        const result = await requestJson(serverSessionResponseSchema, path, init);
                        applyServerSession(result.session, result.revision);
                    } catch (error) {
                        console.warn('[queue] server update failed:', error);
                        await refreshSession(sessionId);
                    }
                };

                return {
                    queuedMessages: {},
                    followUpBehavior: DEFAULT_FOLLOW_UP_BEHAVIOR,
                    sendingIds: {},

                    addToQueue: async (sessionId, message) => {
                        const id = `queued-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                        const queuedMessage: QueuedMessage = {
                            id,
                            content: message.content,
                            text: message.text ?? message.content,
                            createdAt: Date.now(),
                            sendTarget: message.sendTarget,
                            sendConfig: message.sendConfig,
                        };
                        if (message.agentMention) queuedMessage.agentMention = message.agentMention;
                        if (message.attachments && message.attachments.length > 0) queuedMessage.attachments = message.attachments;
                        if (message.context && message.context.length > 0) queuedMessage.context = message.context;

                        set((state) => {
                            const currentQueue = state.queuedMessages[sessionId] ?? [];
                            return {
                                queuedMessages: {
                                    ...state.queuedMessages,
                                    [sessionId]: [...currentQueue, queuedMessage].slice(-MAX_MESSAGES_PER_QUEUE),
                                },
                            };
                        });

                        if (!isServerOwnedMessageQueue()) return;
                        if (!message.sendConfig) {
                            set((state) => removeMessageLocally(state, sessionId, id));
                            throw new Error('A queued message needs a provider and model to be delivered later.');
                        }
                        const directory = message.sendTarget?.directory;
                        try {
                            const result = await requestJson(serverSessionResponseSchema, `${sessionPath(sessionId)}/items`, jsonInit('POST', {
                                directory: directory ?? '',
                                item: toServerItemInput(message, message.sendConfig),
                            }));
                            // The optimistic entry is replaced by the server's copy of the queue.
                            set((state) => removeMessageLocally(state, sessionId, id));
                            applyServerSession(result.session, result.revision);
                            // Queue acceptance records the prompt so it still recalls
                            // after the server delivers it without this UI.
                            const historyIdentity = createInputHistoryIdentity(getRuntimeKey(), directory ?? '', sessionId);
                            if (historyIdentity) {
                                useInputHistoryStore.getState().appendSubmissions(historyIdentity, [
                                    createInputHistorySubmission(message.content, message.attachments ?? []),
                                ]);
                            }
                        } catch (error) {
                            set((state) => removeMessageLocally(state, sessionId, id));
                            throw error;
                        }
                    },

                    removeFromQueue: (sessionId, messageId) => {
                        set((state) => removeMessageLocally(state, sessionId, messageId));
                        if (isServerOwnedMessageQueue()) {
                            void serverMutation(sessionId, `${sessionPath(sessionId)}/items/${encodeURIComponent(messageId)}`, jsonInit('DELETE'));
                        }
                    },

                    reorderQueue: (sessionId, fromId, toId) => {
                        if (fromId === toId) return;

                        const currentQueue = get().queuedMessages[sessionId];
                        if (!currentQueue) return;

                        const fromIndex = currentQueue.findIndex((message) => message.id === fromId);
                        const toIndex = currentQueue.findIndex((message) => message.id === toId);
                        if (fromIndex === -1 || toIndex === -1) return;

                        const nextQueue = currentQueue.slice();
                        const [movedMessage] = nextQueue.splice(fromIndex, 1);
                        nextQueue.splice(toIndex, 0, movedMessage);

                        set((state) => ({
                            queuedMessages: {
                                ...state.queuedMessages,
                                [sessionId]: nextQueue,
                            },
                        }));
                        if (isServerOwnedMessageQueue()) {
                            const itemIds = nextQueue.map((message) => message.id);
                            void serverMutation(sessionId, `${sessionPath(sessionId)}/order`, jsonInit('PUT', { itemIds }));
                        }
                    },

                    restoreMessages: (sessionId, messages) => {
                        if (messages.length === 0) {
                            return;
                        }

                        set((state) => {
                            const currentQueue = state.queuedMessages[sessionId] ?? [];
                            const currentIds = new Set(currentQueue.map((message) => message.id));
                            const missingMessages = messages.filter((message) => !currentIds.has(message.id));
                            if (missingMessages.length === 0) {
                                return state;
                            }

                            const restoredQueue = [...currentQueue, ...missingMessages]
                                .sort((a, b) => a.createdAt - b.createdAt);

                            return {
                                queuedMessages: {
                                    ...state.queuedMessages,
                                    [sessionId]: restoredQueue,
                                },
                            };
                        });
                    },

                    popToInput: async (sessionId, messageId) => {
                        const [message] = await get().takeForSend(sessionId, messageId);
                        return message ?? null;
                    },

                    takeForSend: async (sessionId, messageId) => {
                        const key = sessionId;
                        if (isServerOwnedMessageQueue()) {
                            try {
                                if (messageId) {
                                    const result = await requestJson(
                                        serverTakeResponseSchema,
                                        `${sessionPath(sessionId)}/items/${encodeURIComponent(messageId)}/take`,
                                        jsonInit('POST'),
                                    );
                                    applyServerSession(result.session, result.revision);
                                    return [toQueuedMessage(result.item)];
                                }
                                const result = await requestJson(serverTakeAllResponseSchema, `${sessionPath(sessionId)}/take`, jsonInit('POST'));
                                applyServerSession(result.session, result.revision);
                                return result.items.map(toQueuedMessage);
                            } catch (error) {
                                // The take may have failed because the server already
                                // delivered or dropped the message; re-read it.
                                await refreshSession(sessionId);
                                throw error;
                            }
                        }

                        const state = get();
                        const sending = state.sendingIds[key] ?? [];
                        const taken = (state.queuedMessages[key] ?? []).filter((message) => (
                            (messageId ? message.id === messageId : true) && !sending.includes(message.id)
                        ));
                        if (taken.length === 0) return [];
                        const takenIds = new Set(taken.map((message) => message.id));
                        set((prevState) => {
                            const remaining = (prevState.queuedMessages[key] ?? []).filter((message) => !takenIds.has(message.id));
                            if (remaining.length === 0) return { queuedMessages: withoutKey(prevState.queuedMessages, key) };
                            return { queuedMessages: { ...prevState.queuedMessages, [key]: remaining } };
                        });
                        return taken;
                    },

                    clearQueue: (sessionId) => {
                        const key = sessionId;
                        set((state) => {
                            // Clearing drops what is still queued, never a message
                            // already handed to the server: that send will resolve
                            // and must find its entry to remove or restore.
                            const sending = state.sendingIds[key] ?? [];
                            const retained = (state.queuedMessages[key] ?? []).filter((m) => sending.includes(m.id));
                            if (retained.length > 0) {
                                return { queuedMessages: { ...state.queuedMessages, [key]: retained } };
                            }
                            return { queuedMessages: withoutKey(state.queuedMessages, key) };
                        });
                        if (isServerOwnedMessageQueue()) {
                            void serverMutation(sessionId, sessionPath(sessionId), jsonInit('DELETE'));
                        }
                    },

                    forgetQueue: (sessionId) => {
                        appliedRevisions.delete(sessionId);
                        set((state) => ({
                            queuedMessages: withoutKey(state.queuedMessages, sessionId),
                            sendingIds: withoutKey(state.sendingIds, sessionId),
                        }));
                    },

                    clearAllQueues: () => {
                        set({ queuedMessages: {}, sendingIds: {} });
                    },

                    markSending: (sessionId, messageId) => {
                        set((state) => {
                            const current = state.sendingIds[sessionId] ?? [];
                            if (current.includes(messageId)) return state;
                            return { sendingIds: { ...state.sendingIds, [sessionId]: [...current, messageId] } };
                        });
                    },

                    clearSending: (sessionId, messageId) => {
                        set((state) => {
                            const current = state.sendingIds[sessionId];
                            if (!current || !current.includes(messageId)) return state;
                            const next = current.filter((id) => id !== messageId);
                            if (next.length === 0) return { sendingIds: withoutKey(state.sendingIds, sessionId) };
                            return { sendingIds: { ...state.sendingIds, [sessionId]: next } };
                        });
                    },

                    getSendableQueue: (sessionId) => {
                        const state = get();
                        const queue = state.queuedMessages[sessionId] ?? [];
                        const sending = state.sendingIds[sessionId];
                        if (!sending || sending.length === 0) return queue;
                        return queue.filter((message) => !sending.includes(message.id));
                    },

                    setFollowUpBehavior: (behavior) => {
                        set({ followUpBehavior: behavior });
                        void updateDesktopSettings({ followUpBehavior: behavior });
                    },

                    getQueueForSession: (sessionId) => {
                        return get().queuedMessages[sessionId] ?? [];
                    },

                    hydrate: async () => {
                        if (!isServerOwnedMessageQueue()) return;
                        const runtimeKey = getRuntimeKey();
                        const generation = ++hydrationGeneration;
                        const isCurrent = () => generation === hydrationGeneration && runtimeKey === getRuntimeKey();

                        // Messages queued by an older build live in this browser only.
                        // Hand them to the server once so they are still delivered;
                        // whatever cannot be uploaded is superseded by the server's queue.
                        const legacyEntries = Object.entries(get().queuedMessages)
                            .filter((entry) => entry[1].length > 0 && !serverOwnedRuntimeKeys.has(runtimeKey));
                        for (const [sessionId, queue] of legacyEntries) {
                            for (const message of queue) {
                                const directory = message.sendTarget?.directory;
                                if (!message.sendConfig || !directory) continue;
                                try {
                                    await requestJson(serverSessionResponseSchema, `${sessionPath(sessionId)}/items`, jsonInit('POST', {
                                        directory,
                                        item: toServerItemInput(message, message.sendConfig),
                                    }));
                                } catch (error) {
                                    console.warn('[queue] failed to migrate a locally queued message to the server:', error);
                                }
                                if (!isCurrent()) return;
                            }
                        }

                        const snapshot = await requestJson(serverSnapshotSchema, '/api/message-queue');
                        if (!isCurrent()) return;
                        serverOwnedRuntimeKeys.add(runtimeKey);
                        set((state) => {
                            // Everything this runtime persisted is superseded by the
                            // server's authoritative queue — except a broadcast newer
                            // than this snapshot, which wins listed in it or not.
                            const isNewerThanSnapshot = (sessionId: string) => (appliedRevisions.get(sessionId) ?? -1) > snapshot.revision;
                            const queuedMessages: Record<string, QueuedMessage[]> = {};
                            const sendingIds: Record<string, string[]> = {};
                            for (const [sessionId, queue] of Object.entries(state.queuedMessages)) {
                                if (isNewerThanSnapshot(sessionId)) queuedMessages[sessionId] = queue;
                            }
                            for (const [sessionId, ids] of Object.entries(state.sendingIds)) {
                                if (isNewerThanSnapshot(sessionId)) sendingIds[sessionId] = ids;
                            }
                            for (const session of snapshot.sessions) {
                                if (isNewerThanSnapshot(session.sessionId)) continue;
                                appliedRevisions.set(session.sessionId, snapshot.revision);
                                const queue = session.items.map(toQueuedMessage);
                                if (queue.length > 0) queuedMessages[session.sessionId] = queue;
                                if (session.sendingId) sendingIds[session.sessionId] = [session.sendingId];
                            }
                            return { queuedMessages, sendingIds };
                        });
                    },

                    resync: async () => {
                        if (!serverOwnedRuntimeKeys.has(getRuntimeKey())) return;
                        await get().hydrate();
                    },

                    applyServerSession,

                    setServerHold: async (sessionId, held) => {
                        if (!isServerOwnedMessageQueue()) return;
                        const response = await runtimeFetch(`${sessionPath(sessionId)}/hold`, jsonInit('PUT', { held }));
                        if (!response.ok) throw new Error(`Message queue hold request failed (${response.status})`);
                    },

                    resetForRuntimeSwitch: (previousRuntimeKey) => {
                        hydrationGeneration += 1;
                        if (!previousRuntimeKey || !serverOwnedRuntimeKeys.has(previousRuntimeKey)) return;
                        // The previous runtime's projection belongs to its server;
                        // switching back re-hydrates it from there.
                        serverOwnedRuntimeKeys.delete(previousRuntimeKey);
                        set({ queuedMessages: {}, sendingIds: {} });
                    },
                };
            },
            {
                name: 'message-queue-store',
                version: 2,
                storage: createDeferredSafeJSONStorage(),
                partialize: (state) => ({
                    // A server-owned runtime's entries are a projection; persisting
                    // them would resurrect messages the server already delivered.
                    queuedMessages: isServerOwnedMessageQueue() ? {} : state.queuedMessages,
                    followUpBehavior: state.followUpBehavior,
                }),
                migrate: migrateMessageQueuePersistedState,
            }
        ),
        {
            name: 'message-queue-store',
        }
    )
);

const serverUpdatedEventSchema = z.object({
    properties: z.object({ revision: z.number(), session: serverSessionSchema }),
});

export type MessageQueueUpdatedEvent = {
    type: 'openchamber:message-queue.updated';
    properties: z.infer<typeof serverUpdatedEventSchema>['properties'];
};

/** `openchamber:message-queue.updated` broadcast → projection. */
export const applyMessageQueueUpdatedEvent = (payload: Event | MessageQueueUpdatedEvent, expectedRuntimeKey?: string): void => {
    if (!isServerOwnedMessageQueue()) return;
    const parsed = serverUpdatedEventSchema.safeParse(payload);
    if (!parsed.success) return;
    const { session, revision } = parsed.data.properties;
    useMessageQueueStore.getState().applyServerSession(session, revision, expectedRuntimeKey);
};

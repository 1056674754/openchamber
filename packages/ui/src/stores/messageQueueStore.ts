import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { createDeferredSafeJSONStorage } from './utils/safeStorage';
import type { AttachedFile } from './types/sessionTypes';
import { updateDesktopSettings } from '@/lib/persistence';
import {
    resolvePersistedFollowUpBehavior,
    type FollowUpBehavior,
} from '@/lib/followUpBehavior';

export interface QueuedMessage {
    id: string;
    content: string;
    attachments?: AttachedFile[];
    createdAt: number;
    /** Authoritative routing captured at queue time. */
    sendTarget?: {
        directory?: string;
        serverId?: string;
    };
    /** Send config captured at queue time — used as-is when auto-sending */
    sendConfig?: {
        providerID: string;
        modelID: string;
        agent?: string;
        variant?: string;
    };
}

interface MessageQueueState {
    queuedMessages: Record<string, QueuedMessage[]>; // sessionId → queue
    followUpBehavior: FollowUpBehavior;
}

interface MessageQueueActions {
    addToQueue: (sessionId: string, message: Omit<QueuedMessage, 'id' | 'createdAt'>) => void;
    removeFromQueue: (sessionId: string, messageId: string) => void;
    reorderQueue: (sessionId: string, fromId: string, toId: string) => void;
    restoreMessages: (sessionId: string, messages: QueuedMessage[]) => void;
    popToInput: (sessionId: string, messageId: string) => QueuedMessage | null;
    clearQueue: (sessionId: string) => void;
    clearAllQueues: () => void;
    setFollowUpBehavior: (behavior: FollowUpBehavior) => void;
    getQueueForSession: (sessionId: string) => QueuedMessage[];
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
    return {
        id: value.id,
        content: value.content,
        createdAt: value.createdAt,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
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

export const useMessageQueueStore = create<MessageQueueStore>()(
    devtools(
        persist(
            (set, get) => ({
                queuedMessages: {},
                followUpBehavior: 'steer',

                addToQueue: (sessionId, message) => {
                    const id = `queued-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                    const queuedMessage: QueuedMessage = {
                        id,
                        content: message.content,
                        attachments: message.attachments,
                        createdAt: Date.now(),
                        sendTarget: message.sendTarget,
                        sendConfig: message.sendConfig,
                    };

                    set((state) => {
                        const currentQueue = state.queuedMessages[sessionId] ?? [];
                        return {
                            queuedMessages: {
                                ...state.queuedMessages,
                                [sessionId]: [...currentQueue, queuedMessage],
                            },
                        };
                    });
                },

                removeFromQueue: (sessionId, messageId) => {
                    set((state) => {
                        const currentQueue = state.queuedMessages[sessionId] ?? [];
                        const newQueue = currentQueue.filter((m) => m.id !== messageId);
                        
                        if (newQueue.length === 0) {
                            const { [sessionId]: _removed, ...rest } = state.queuedMessages;
                            void _removed;
                            return { queuedMessages: rest };
                        }
                        
                        return {
                            queuedMessages: {
                                ...state.queuedMessages,
                                [sessionId]: newQueue,
                            },
                        };
                    });
                },

                reorderQueue: (sessionId, fromId, toId) => {
                    if (fromId === toId) return;

                    set((state) => {
                        const currentQueue = state.queuedMessages[sessionId];
                        if (!currentQueue) return state;

                        const fromIndex = currentQueue.findIndex((message) => message.id === fromId);
                        const toIndex = currentQueue.findIndex((message) => message.id === toId);
                        if (fromIndex === -1 || toIndex === -1) return state;

                        const nextQueue = currentQueue.slice();
                        const [movedMessage] = nextQueue.splice(fromIndex, 1);
                        nextQueue.splice(toIndex, 0, movedMessage);

                        return {
                            queuedMessages: {
                                ...state.queuedMessages,
                                [sessionId]: nextQueue,
                            },
                        };
                    });
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

                popToInput: (sessionId, messageId) => {
                    const state = get();
                    const currentQueue = state.queuedMessages[sessionId] ?? [];
                    const message = currentQueue.find((m) => m.id === messageId);
                    
                    if (!message) {
                        return null;
                    }

                    // Remove from queue
                    set((prevState) => {
                        const queue = prevState.queuedMessages[sessionId] ?? [];
                        const newQueue = queue.filter((m) => m.id !== messageId);
                        
                        if (newQueue.length === 0) {
                            const { [sessionId]: _removed, ...rest } = prevState.queuedMessages;
                            void _removed;
                            return { queuedMessages: rest };
                        }
                        
                        return {
                            queuedMessages: {
                                ...prevState.queuedMessages,
                                [sessionId]: newQueue,
                            },
                        };
                    });

                    return message;
                },

                clearQueue: (sessionId) => {
                    set((state) => {
                        const { [sessionId]: _removed, ...rest } = state.queuedMessages;
                        void _removed;
                        return { queuedMessages: rest };
                    });
                },

                clearAllQueues: () => {
                    set({ queuedMessages: {} });
                },

                setFollowUpBehavior: (behavior) => {
                    set({ followUpBehavior: behavior });
                    void updateDesktopSettings({ followUpBehavior: behavior });
                },

                getQueueForSession: (sessionId) => {
                    return get().queuedMessages[sessionId] ?? [];
                },
            }),
            {
                name: 'message-queue-store',
                storage: createDeferredSafeJSONStorage(),
                version: 1,
                migrate: migrateMessageQueuePersistedState,
                partialize: (state) => ({
                    queuedMessages: state.queuedMessages,
                    followUpBehavior: state.followUpBehavior,
                }),
            }
        ),
        {
            name: 'message-queue-store',
        }
    )
);

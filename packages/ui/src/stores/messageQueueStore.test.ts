import { beforeEach, describe, expect, test } from 'bun:test';
import {
    migrateMessageQueuePersistedState,
    useMessageQueueStore,
    type QueuedMessage,
} from './messageQueueStore';

const queuedMessage = (id: string, content: string, createdAt: number): QueuedMessage => ({
    id,
    content,
    createdAt,
});

describe('messageQueueStore', () => {
    beforeEach(() => {
        useMessageQueueStore.setState({
            queuedMessages: {},
            followUpBehavior: 'steer',
        });
    });

    test('migrates legacy queue mode without dropping captured routing', () => {
        const migrated = migrateMessageQueuePersistedState({
            queuedMessages: {
                'session-1': [{
                    id: 'queued-1',
                    content: 'keep this target',
                    createdAt: 1,
                    sendTarget: {
                        directory: '/remote/project',
                        serverId: 'remote-1',
                    },
                    sendConfig: {
                        providerID: 'provider-1',
                        modelID: 'model-1',
                        agent: 'review',
                        variant: 'high',
                    },
                }],
            },
            queueModeEnabled: true,
        });

        expect(migrated.followUpBehavior).toBe('queue');
        expect(migrated.queuedMessages['session-1']?.[0]?.sendTarget).toEqual({
            directory: '/remote/project',
            serverId: 'remote-1',
        });
        expect(migrated.queuedMessages['session-1']?.[0]?.sendConfig).toEqual({
            providerID: 'provider-1',
            modelID: 'model-1',
            agent: 'review',
            variant: 'high',
        });
    });

    test('restores missing queued messages without duplicating existing items', () => {
        const existing = queuedMessage('queued-2', 'second', 2);
        const older = queuedMessage('queued-1', 'first', 1);

        useMessageQueueStore.setState({
            queuedMessages: {
                'session-1': [existing],
            },
        });

        useMessageQueueStore.getState().restoreMessages('session-1', [older, existing]);

        expect(useMessageQueueStore.getState().queuedMessages['session-1']).toEqual([older, existing]);
    });

    test('removeFromQueue only removes the requested queued message', () => {
        const first = queuedMessage('queued-1', 'first', 1);
        const second = queuedMessage('queued-2', 'second', 2);

        useMessageQueueStore.setState({
            queuedMessages: {
                'session-1': [first, second],
            },
        });

        useMessageQueueStore.getState().removeFromQueue('session-1', 'queued-1');

        expect(useMessageQueueStore.getState().queuedMessages['session-1']).toEqual([second]);
    });

    test('reorders queued messages without rebuilding captured snapshots', () => {
        const first: QueuedMessage = {
            ...queuedMessage('queued-1', 'first', 1),
            sendTarget: { directory: '/remote/project', serverId: 'remote-1' },
            sendConfig: {
                providerID: 'provider-1',
                modelID: 'model-1',
                agent: 'review',
                variant: 'high',
            },
        };
        const second = queuedMessage('queued-2', 'second', 2);
        const third = queuedMessage('queued-3', 'third', 3);

        useMessageQueueStore.setState({
            queuedMessages: {
                'session-1': [first, second, third],
                'session-2': [queuedMessage('queued-other', 'other', 4)],
            },
        });

        useMessageQueueStore.getState().reorderQueue('session-1', 'queued-1', 'queued-3');

        const state = useMessageQueueStore.getState();
        expect(state.queuedMessages['session-1']).toEqual([second, third, first]);
        expect(state.queuedMessages['session-1']?.[2]).toBe(first);
        expect(state.queuedMessages['session-2']?.map((message) => message.id)).toEqual(['queued-other']);
    });
});

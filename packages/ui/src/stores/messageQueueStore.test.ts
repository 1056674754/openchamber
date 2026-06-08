import { beforeEach, describe, expect, test } from 'bun:test';
import { useMessageQueueStore, type QueuedMessage } from './messageQueueStore';

const queuedMessage = (id: string, content: string, createdAt: number): QueuedMessage => ({
    id,
    content,
    createdAt,
});

describe('messageQueueStore', () => {
    beforeEach(() => {
        useMessageQueueStore.setState({
            queuedMessages: {},
            queueModeEnabled: true,
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
});

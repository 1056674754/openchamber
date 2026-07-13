import { beforeEach, describe, expect, test } from 'bun:test';
import type { Agent } from '@opencode-ai/sdk/v2';
import type { QueuedMessage } from '../stores/messageQueueStore';
import { buildQueuedAutoSendPayload } from './queuedMessageAutoSendPayload';
import {
  getQueuedAutoSendRetryDelayMs,
  isQueuedAutoSendBackedOff,
  shouldDispatchQueuedAutoSend,
} from './queuedMessageAutoSendPolicy';

let visibleAgents: Agent[] = [];

describe('shouldDispatchQueuedAutoSend', () => {
  test('dispatches after an active session becomes idle', () => {
    expect(shouldDispatchQueuedAutoSend('busy', 'idle', false)).toBe(true);
    expect(shouldDispatchQueuedAutoSend('retry', 'idle', false)).toBe(true);
  });

  test('does not dispatch when an empty queue first observes idle', () => {
    expect(shouldDispatchQueuedAutoSend(undefined, 'idle', false)).toBe(false);
    expect(shouldDispatchQueuedAutoSend('idle', 'idle', false)).toBe(false);
  });

  test('dispatches when queued items arrive while the session is already idle', () => {
    expect(shouldDispatchQueuedAutoSend('idle', 'idle', true)).toBe(true);
  });
});

describe('queued auto-send retry backoff', () => {
  test('grows exponentially and caps retry delay', () => {
    expect(getQueuedAutoSendRetryDelayMs(1)).toBe(2_000);
    expect(getQueuedAutoSendRetryDelayMs(2)).toBe(4_000);
    expect(getQueuedAutoSendRetryDelayMs(3)).toBe(8_000);
    expect(getQueuedAutoSendRetryDelayMs(10)).toBe(60_000);
    expect(getQueuedAutoSendRetryDelayMs(100)).toBe(60_000);
  });

  test('backs off only the failed queue head within its retry window', () => {
    const failure = {
      messageId: 'queued-1',
      failures: 1,
      nextAttemptAt: 10_000,
    };

    expect(isQueuedAutoSendBackedOff(failure, 'queued-1', 9_999)).toBe(true);
    expect(isQueuedAutoSendBackedOff(failure, 'queued-1', 10_000)).toBe(false);
    expect(isQueuedAutoSendBackedOff(failure, 'queued-2', 9_999)).toBe(false);
    expect(isQueuedAutoSendBackedOff(undefined, 'queued-1', 0)).toBe(false);
  });
});

describe('buildQueuedAutoSendPayload', () => {
  beforeEach(() => {
    visibleAgents = [];
  });

  test('returns only the first queued message for auto-send', () => {
    const queue: QueuedMessage[] = [
      {
        id: 'queued-1',
        content: 'first queued message',
        createdAt: 1,
      },
      {
        id: 'queued-2',
        content: 'second queued message',
        createdAt: 2,
      },
    ];

    const payload = buildQueuedAutoSendPayload(queue);

    expect(payload).not.toBeNull();
    expect(payload?.queuedMessageId).toBe('queued-1');
    expect(payload?.primaryText).toBe('first queued message');
    expect(payload?.primaryAttachments).toEqual([]);
  });

  test('uses the configured visible agents when parsing queued mentions', () => {
    visibleAgents = [
      {
        name: 'Builder',
        mode: 'subagent',
        permission: [],
        options: {},
      } as Agent,
    ];

    const queue: QueuedMessage[] = [
      {
        id: 'queued-mention',
        content: '@Builder please take this',
        createdAt: 1,
      },
    ];

    const payload = buildQueuedAutoSendPayload(queue, visibleAgents);

    expect(payload).not.toBeNull();
    expect(payload?.agentMentionName).toBe('Builder');
    expect(payload?.primaryText).toBe('@Builder please take this');
  });

  test('preserves attachment-only queued messages as sendable payloads', () => {
    const queue: QueuedMessage[] = [
      {
        id: 'queued-attachments',
        content: '',
        createdAt: 1,
        attachments: [
          {
            id: 'file-1',
            filename: 'notes.txt',
            mimeType: 'text/plain',
            size: 5,
            source: 'local',
            file: new File(['hello'], 'notes.txt', { type: 'text/plain' }),
            dataUrl: 'data:text/plain;base64,aGVsbG8=',
          },
        ],
      },
      {
        id: 'queued-2',
        content: 'later queued message',
        createdAt: 2,
      },
    ];

    const payload = buildQueuedAutoSendPayload(queue);

    expect(payload).not.toBeNull();
    expect(payload?.queuedMessageId).toBe('queued-attachments');
    expect(payload?.primaryText).toBe('');
    expect(payload?.primaryAttachments).toHaveLength(1);
    expect(payload?.primaryAttachments[0]?.filename).toBe('notes.txt');
  });

  test('preserves queued routing target for auto-send', () => {
    const queue: QueuedMessage[] = [
      {
        id: 'queued-target',
        content: 'send later',
        createdAt: 1,
        sendTarget: {
          directory: '/remote/project',
          serverId: 'remote-1',
        },
      },
    ];

    const payload = buildQueuedAutoSendPayload(queue);

    expect(payload?.sendTarget).toEqual({
      directory: '/remote/project',
      serverId: 'remote-1',
    });
  });
});

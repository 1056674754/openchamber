import { describe, expect, test } from 'bun:test';
import type { Message } from '@opencode-ai/sdk/v2';

import { mergeDirectiveMessagesAfterAnchors } from './directiveProcessMessages';
import { projectTurnRecords } from './projectTurnRecords';
import { segmentProcessMessagesByPinnedBoundaries } from './processSegments';
import type { ChatMessageEntry, TurnRecord } from './types';

const entry = (id: string, role: 'user' | 'assistant', parentID?: string): ChatMessageEntry => ({
    info: {
        id,
        role,
        ...(parentID ? { parentID } : {}),
        sessionID: 'ses_1',
        time: { created: 1 },
    } as Message,
    parts: [],
});

const directiveTurn = (id: string, parentID: string, assistantId: string): TurnRecord => ({
    turnId: id,
    userMessageId: id,
    userMessage: entry(id, 'user', parentID),
    messages: [],
    assistantMessageIds: [assistantId],
    assistantMessages: [entry(assistantId, 'assistant', id)],
    isDirectiveTurn: true,
    activityParts: [],
    activitySegments: [],
    summary: {},
    hasTools: false,
    hasReasoning: false,
    stream: {
        isStreaming: false,
        isRetrying: false,
    },
});

describe('directive process message merge', () => {
    test('inserts directive turn messages after their anchored assistant message', () => {
        const before = entry('a1', 'assistant', 'u1');
        const after = entry('a2', 'assistant', 'u1');
        const steer = directiveTurn('st1', 'a1', 'sa1');

        expect(mergeDirectiveMessagesAfterAnchors([before, after], [steer]).map((message) => message.info.id)).toEqual([
            'a1',
            'st1',
            'sa1',
            'a2',
        ]);
    });

    test('keeps missing-anchor directives visible after process messages', () => {
        const before = entry('a1', 'assistant', 'u1');
        const steer = directiveTurn('st1', 'missing', 'sa1');

        expect(mergeDirectiveMessagesAfterAnchors([before], [steer]).map((message) => message.info.id)).toEqual([
            'a1',
            'st1',
            'sa1',
        ]);
    });

    test('keeps inferred live steer banners visible at their assistant anchor', () => {
        const user = entry('u1', 'user');
        const assistant = entry('a1', 'assistant', 'u1');
        const steer = entry('st1', 'user', 'a1');
        const projection = projectTurnRecords([user, assistant, steer], {
            showTextJustificationActivity: false,
        });
        const parentTurn = projection.turns[0];
        const steerTurn = projection.turns[1];

        const merged = mergeDirectiveMessagesAfterAnchors(parentTurn?.assistantMessages ?? [], steerTurn ? [steerTurn] : []);
        expect(segmentProcessMessagesByPinnedBoundaries(merged)).toEqual([
            { kind: 'fold', messages: [assistant] },
            { kind: 'pinned-message', message: steerTurn?.userMessage },
        ]);
    });
});

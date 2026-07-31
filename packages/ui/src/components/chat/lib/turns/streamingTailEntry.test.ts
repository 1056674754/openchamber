import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import { buildLiveStreamingEntry, type StreamingTailEntry } from './streamingTailEntry';
import { projectTurnRecords } from './projectTurnRecords';
import type { ChatMessageEntry, TurnRecord } from './types';

const message = (id: string, role: 'user' | 'assistant', parentID?: string, parts: Part[] = []): ChatMessageEntry => ({
    info: {
        id,
        role,
        sessionID: 'ses_1',
        ...(parentID ? { parentID } : {}),
        time: { created: 1 },
    } as Message,
    parts,
});

const textPart = (id: string, text: string): Part => ({
    id,
    type: 'text',
    text,
} as Part);

const syntheticTextPart = (id: string, text: string): Part => ({
    id,
    type: 'text',
    text,
    synthetic: true,
} as Part);

const reasoningPart = (id: string, text: string): Part => ({
    id,
    type: 'reasoning',
    text,
} as Part);

const turnEntry = (assistant: ChatMessageEntry): StreamingTailEntry => {
    const user = message('user_1', 'user');
    return {
        kind: 'turn',
        key: 'turn:user_1',
        isLastTurn: true,
        turn: {
            turnId: 'user_1',
            userMessageId: 'user_1',
            userMessage: user,
            headerMessageId: assistant.info.id,
            messages: [],
            assistantMessageIds: [assistant.info.id],
            assistantMessages: [assistant],
            isDirectiveTurn: false,
            activityParts: [],
            activitySegments: [],
            summary: {},
            hasTools: false,
            hasReasoning: false,
            stream: { isStreaming: true, isRetrying: false },
        } satisfies TurnRecord,
    };
};

describe('buildLiveStreamingEntry', () => {
    test('returns the same entry when the active message is not in the tail', () => {
        const assistant = message('assistant_1', 'assistant', 'user_1', [textPart('part_1', 'old')]);
        const entry = turnEntry(assistant);

        const next = buildLiveStreamingEntry(entry, {
            activeStreamingMessageId: 'assistant_other',
            liveParts: [textPart('part_live', 'live')],
            showTextJustificationActivity: true,
            planModeEnabled: false,
        });

        expect(next).toBe(entry);
    });

    test('rebuilds only the streaming turn with live parts', () => {
        const assistant = message('assistant_1', 'assistant', 'user_1', [textPart('part_1', 'hel')]);
        const entry = turnEntry(assistant);
        const liveParts = [reasoningPart('part_1_live', 'thinking')];

        const next = buildLiveStreamingEntry(entry, {
            activeStreamingMessageId: 'assistant_1',
            liveParts,
            showTextJustificationActivity: true,
            planModeEnabled: false,
        });

        expect(next).not.toBe(entry);
        expect(next.kind).toBe('turn');
        if (next.kind !== 'turn') return;
        expect(next.turn.assistantMessages[0]?.parts).toEqual(liveParts);
        expect(next.turn.activityParts.length).toBeGreaterThan(0);
    });

    test('updates an ungrouped streaming message with live parts', () => {
        const stale = message('assistant_1', 'assistant', undefined, [textPart('part_1', 'old')]);
        const entry: StreamingTailEntry = {
            kind: 'ungrouped',
            key: 'msg:assistant_1',
            message: stale,
        };
        const liveParts = [textPart('part_1_live', 'live')];

        const next = buildLiveStreamingEntry(entry, {
            activeStreamingMessageId: 'assistant_1',
            liveParts,
            showTextJustificationActivity: false,
            planModeEnabled: false,
        });

        expect(next).not.toBe(entry);
        expect(next.kind).toBe('ungrouped');
        if (next.kind !== 'ungrouped') return;
        expect(next.message.parts).toEqual(liveParts);
    });

    test('normalizes live tail parts with the display filtering path', () => {
        const stale = message('assistant_1', 'assistant', 'user_1', [textPart('part_1', 'old')]);
        const entry = turnEntry(stale);
        const visible = textPart('part_visible', 'visible');
        const synthetic = syntheticTextPart('part_synthetic', 'hidden while streaming');

        const next = buildLiveStreamingEntry(entry, {
            activeStreamingMessageId: 'assistant_1',
            liveParts: [synthetic, visible],
            showTextJustificationActivity: true,
            planModeEnabled: false,
        });

        expect(next.kind).toBe('turn');
        if (next.kind !== 'turn') return;
        expect(next.turn.assistantMessages[0]?.parts).toEqual([visible]);
    });

    test('preserves a streaming assistant parented by a hidden compaction continuation', () => {
        const user = message('user_1', 'user');
        const completed = message('assistant_1', 'assistant', 'user_1', [textPart('part_done', 'done')]);
        const continuation = message('user_continue', 'user', undefined, [
            syntheticTextPart('part_continue', '[SYSTEM DIRECTIVE: TODO CONTINUATION]'),
        ]);
        const streaming = message('assistant_2', 'assistant', 'user_continue', [
            reasoningPart('part_stale', 'starting'),
        ]);
        const projection = projectTurnRecords([user, completed, continuation, streaming], {
            mergeHiddenUserTurns: { planModeEnabled: false },
        });
        const projectedTurn = projection.turns[0];
        expect(projectedTurn?.assistantMessageIds).toEqual(['assistant_1', 'assistant_2']);
        if (!projectedTurn) return;

        const next = buildLiveStreamingEntry({
            kind: 'turn',
            key: 'turn:user_1',
            isLastTurn: true,
            turn: projectedTurn,
        }, {
            activeStreamingMessageId: 'assistant_2',
            liveParts: [reasoningPart('part_live', 'delegating task')],
            showTextJustificationActivity: true,
            planModeEnabled: false,
        });

        expect(next.kind).toBe('turn');
        if (next.kind !== 'turn') return;
        expect(next.turn.assistantMessageIds).toEqual(['assistant_1', 'assistant_2']);
        expect(next.turn.assistantMessages[1]?.parts).toEqual([
            reasoningPart('part_live', 'delegating task'),
        ]);
    });
});

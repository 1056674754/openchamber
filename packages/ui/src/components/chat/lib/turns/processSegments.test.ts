import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import { messageHasQuestionTool, messagePinsProcessFold, segmentProcessMessagesByPinnedBoundaries } from './processSegments';
import type { ChatMessageEntry } from './types';

const message = (id: string, parts: Part[] = []): ChatMessageEntry => ({
    info: {
        id,
        role: 'assistant',
        sessionID: 'ses_1',
        time: { created: 1 },
    } as Message,
    parts,
});

const toolPart = (tool: string): Part => ({
    id: `tool-${tool}`,
    type: 'tool',
    tool,
    callID: `call-${tool}`,
    state: { status: 'completed' },
} as unknown as Part);

describe('process message segments', () => {
    test('detects question tool messages', () => {
        expect(messageHasQuestionTool(message('a1', [toolPart('question')]))).toBe(true);
        expect(messageHasQuestionTool(message('a2', [toolPart('bash')]))).toBe(false);
    });

    test('keeps question tool messages pinned between process folds', () => {
        const before = message('before');
        const question = message('question', [toolPart('question')]);
        const after1 = message('after-1');
        const after2 = message('after-2');

        expect(segmentProcessMessagesByPinnedBoundaries([before, question, after1, after2])).toEqual([
            { kind: 'fold', messages: [before] },
            { kind: 'pinned-message', message: question },
            { kind: 'fold', messages: [after1, after2] },
        ]);
    });

    test('does not create empty fold segments around adjacent questions', () => {
        const question1 = message('question-1', [toolPart('question')]);
        const question2 = message('question-2', [toolPart('question')]);

        expect(segmentProcessMessagesByPinnedBoundaries([question1, question2])).toEqual([
            { kind: 'pinned-message', message: question1 },
            { kind: 'pinned-message', message: question2 },
        ]);
    });

    test('keeps live steer messages pinned between process folds', () => {
        const before = message('before');
        const steer = {
            ...message('steer', [{
                id: 'part-steer',
                sessionID: 'ses_1',
                messageID: 'steer',
                type: 'text',
                text: 'stay here',
                metadata: { openchamberLiveSteer: true },
            } as Part]),
            info: {
                ...message('steer').info,
                role: 'user',
            } as Message,
        };
        const after = message('after');

        expect(messagePinsProcessFold(steer)).toBe(true);
        expect(segmentProcessMessagesByPinnedBoundaries([before, steer, after])).toEqual([
            { kind: 'fold', messages: [before] },
            { kind: 'pinned-message', message: steer },
            { kind: 'fold', messages: [after] },
        ]);
    });
});

import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import { messageHasQuestionTool, segmentProcessMessagesByPinnedQuestions } from './processSegments';
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

        expect(segmentProcessMessagesByPinnedQuestions([before, question, after1, after2])).toEqual([
            { kind: 'fold', messages: [before] },
            { kind: 'pinned-question', message: question },
            { kind: 'fold', messages: [after1, after2] },
        ]);
    });

    test('does not create empty fold segments around adjacent questions', () => {
        const question1 = message('question-1', [toolPart('question')]);
        const question2 = message('question-2', [toolPart('question')]);

        expect(segmentProcessMessagesByPinnedQuestions([question1, question2])).toEqual([
            { kind: 'pinned-question', message: question1 },
            { kind: 'pinned-question', message: question2 },
        ]);
    });
});

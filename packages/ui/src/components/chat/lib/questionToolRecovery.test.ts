import { describe, expect, test } from 'bun:test';
import type { ToolPart as ToolPartType } from '@opencode-ai/sdk/v2';
import type { QuestionRequest } from '@/types/question';
import {
    findPendingQuestionRequestForRecoveredTool,
    recoverQuestionRequestFromToolPart,
} from './questionToolRecovery';

const makeQuestionToolPart = (overrides: Partial<ToolPartType> = {}): ToolPartType => ({
    id: 'part-1',
    sessionID: 'ses-1',
    messageID: 'msg-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'question',
    state: {
        status: 'running',
        input: {
            questions: [
                {
                    header: 'Pick mode',
                    question: 'Which mode?',
                    options: [{ label: 'safe', description: 'Default' }],
                    multiple: false,
                },
            ],
        },
        time: { start: 1 },
    },
    ...overrides,
});

describe('recoverQuestionRequestFromToolPart', () => {
    test('recovers a question request from an unfinished question tool part', () => {
        const recovered = recoverQuestionRequestFromToolPart({
            part: makeQuestionToolPart(),
            messageID: 'msg-visible',
            sessionID: 'ses-visible',
            normalizedToolName: 'question',
        });

        expect(recovered).toEqual({
            id: 'recovered-question:msg-visible:call-1',
            sessionID: 'ses-visible',
            questions: [
                {
                    header: 'Pick mode',
                    question: 'Which mode?',
                    options: [{ label: 'safe', description: 'Default' }],
                    multiple: false,
                },
            ],
            tool: {
                messageID: 'msg-visible',
                callID: 'call-1',
            },
        });
    });

    test('does not recover answered question tool parts', () => {
        const recovered = recoverQuestionRequestFromToolPart({
            part: makeQuestionToolPart({
                state: {
                    status: 'completed',
                    input: {
                        questions: [
                            {
                                header: 'Pick mode',
                                question: 'Which mode?',
                                options: [{ label: 'safe', description: 'Default' }],
                                multiple: false,
                            },
                        ],
                    },
                    output: 'User has answered your questions: "Which mode?"="safe". You can now continue with the user answers in mind.',
                    title: 'Question',
                    metadata: { answers: [['safe']] },
                    time: { start: 1, end: 2 },
                },
            }),
            normalizedToolName: 'question',
        });

        expect(recovered).toBeNull();
    });

    test('does not recover a question whose tool part terminated in error without an answer', () => {
        const recovered = recoverQuestionRequestFromToolPart({
            part: makeQuestionToolPart({
                state: {
                    status: 'error',
                    input: {
                        questions: [
                            {
                                header: 'Pick mode',
                                question: 'Which mode?',
                                options: [{ label: 'safe', description: 'Default' }],
                                multiple: false,
                            },
                        ],
                    },
                    error: 'Something unexpected happened',
                    metadata: {},
                    time: { start: 1, end: 2 },
                },
            }),
            normalizedToolName: 'question',
        });

        expect(recovered).toBeNull();
    });

    test('does not recover questions the user already dismissed', () => {
        const recovered = recoverQuestionRequestFromToolPart({
            part: makeQuestionToolPart({
                state: {
                    status: 'error',
                    input: {
                        questions: [
                            {
                                header: 'Pick mode',
                                question: 'Which mode?',
                                options: [{ label: 'safe', description: 'Default' }],
                                multiple: false,
                            },
                        ],
                    },
                    error: 'The user dismissed this question',
                    metadata: {},
                    time: { start: 1, end: 2 },
                },
            }),
            normalizedToolName: 'question',
        });

        expect(recovered).toBeNull();
    });

    test('does not recover questions dismissed via expanded error markers (case-insensitive)', () => {
        const markers = ['aborted', 'cancelled', 'canceled', 'dismissed', 'Aborted', 'CANCELLED'];
        for (const marker of markers) {
            const recovered = recoverQuestionRequestFromToolPart({
                part: makeQuestionToolPart({
                    state: {
                        status: 'error',
                        input: {
                            questions: [
                                {
                                    header: 'Pick mode',
                                    question: 'Which mode?',
                                    options: [{ label: 'safe', description: 'Default' }],
                                    multiple: false,
                                },
                            ],
                        },
                        error: `Tool was ${marker} by the runtime`,
                        metadata: {},
                        time: { start: 1, end: 2 },
                    },
                }),
                normalizedToolName: 'question',
            });

            expect(recovered).toBeNull();
        }
    });
});

describe('findPendingQuestionRequestForRecoveredTool', () => {
    const recovered: QuestionRequest = {
        id: 'recovered-question:msg-1:call-1',
        sessionID: 'ses-1',
        questions: [
            {
                header: 'Pick mode',
                question: 'Which mode?',
                options: [{ label: 'safe', description: 'Default' }],
                multiple: false,
            },
        ],
        tool: {
            messageID: 'msg-1',
            callID: 'call-1',
        },
    };

    test('matches live pending requests by tool call id', () => {
        const pending: QuestionRequest[] = [
            {
                ...recovered,
                id: 'que-live',
            },
        ];

        expect(findPendingQuestionRequestForRecoveredTool(recovered, pending)?.id).toBe('que-live');
    });

    test('falls back to exact question content only when the match is unique', () => {
        const pending: QuestionRequest[] = [
            {
                ...recovered,
                id: 'que-live',
                tool: undefined,
            },
        ];

        expect(findPendingQuestionRequestForRecoveredTool(recovered, pending)?.id).toBe('que-live');
        expect(findPendingQuestionRequestForRecoveredTool(recovered, [...pending, { ...pending[0], id: 'que-ambiguous' }])).toBeNull();
    });
});

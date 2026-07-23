import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import {
    extractOpenChamberLiveSteerText,
    findLatestRealUserMessage,
    getAuxiliaryUserMessageKind,
    hasRealUserMessageParts,
    hasSubtaskPart,
} from './real-user';

const textPart = (text: string): Part => ({ type: 'text', text } as Part);
const userMessage = (id: string, agent: string): Message => ({
    id,
    sessionID: 'session-1',
    role: 'user',
    time: { created: 1 },
    agent,
    model: { providerID: 'provider-1', modelID: 'model-1' },
} as Message);

describe('real user message parts', () => {
    test('accepts ordinary text user parts', () => {
        expect(hasRealUserMessageParts([textPart('hello')])).toBe(true);
    });

    test('rejects system directives', () => {
        expect(hasRealUserMessageParts([
            textPart('[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]\ncontinue'),
        ])).toBe(false);
    });

    test('rejects injected directory context', () => {
        expect(hasRealUserMessageParts([
            textPart('[Directory Context: /repo/AGENTS.md]\n# Project instructions'),
        ])).toBe(false);
    });

    test('rejects skill instruction directives', () => {
        expect(hasRealUserMessageParts([
            textPart('<skill-instruction>\nBase directory for this skill: /tmp/skills/example/\n\nDo the thing.\n</skill-instruction>\n\n<user-request>\nhello\n</user-request>'),
        ])).toBe(false);
    });

    test('rejects delegated subtask parts', () => {
        const parts = [{ type: 'subtask' } as Part];

        expect(hasSubtaskPart(parts)).toBe(true);
        expect(hasRealUserMessageParts(parts)).toBe(false);
    });

    test('rejects live steer messages marked on message metadata', () => {
        const parts = [textPart('change direction')];
        const info = { metadata: { openchamberLiveSteer: true } };

        expect(getAuxiliaryUserMessageKind(parts, info)).toBe('live-steer');
        expect(hasRealUserMessageParts(parts, info)).toBe(false);
    });

    test('extracts live steer text from the injected system reminder wrapper', () => {
        const parts = [textPart([
            '<system-reminder>',
            'The user sent the following live steering message while the current response was already running:',
            'print meow once',
            '',
            'Treat this as the latest user direction and continue the current task accordingly.',
            '</system-reminder>',
        ].join('\n'))];

        expect(getAuxiliaryUserMessageKind(parts)).toBe('live-steer');
        expect(hasRealUserMessageParts(parts)).toBe(false);
        expect(extractOpenChamberLiveSteerText(parts)).toBe('print meow once');
    });

    test('rejects fully synthetic user messages', () => {
        const parts = [{ ...textPart('generated context'), synthetic: true } as Part];

        expect(getAuxiliaryUserMessageKind(parts)).toBe('synthetic');
        expect(hasRealUserMessageParts(parts)).toBe(false);
    });

    test('keeps the latest human choice when an OMO continuation injects another user-role message', () => {
        const humanChoice = userMessage('message-1', 'Hephaestus - Deep Agent');
        const omoContinuation = userMessage('message-2', 'Atlas - Plan Executor');
        const partsByMessage = {
            [humanChoice.id]: [textPart('用中文回答我做的怎么样了?')],
            [omoContinuation.id]: [{
                ...textPart('<system-reminder>BOULDER COMPLETE</system-reminder>'),
                synthetic: true,
            } as Part],
        };

        expect(findLatestRealUserMessage([humanChoice, omoContinuation], partsByMessage)?.id).toBe(humanChoice.id);
    });
});

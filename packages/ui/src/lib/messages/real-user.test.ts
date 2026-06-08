import { describe, expect, test } from 'bun:test';
import type { Part } from '@opencode-ai/sdk/v2';

import { hasRealUserMessageParts, hasSubtaskPart } from './real-user';

const textPart = (text: string): Part => ({ type: 'text', text } as Part);

describe('real user message parts', () => {
    test('accepts ordinary text user parts', () => {
        expect(hasRealUserMessageParts([textPart('hello')])).toBe(true);
    });

    test('rejects system directives', () => {
        expect(hasRealUserMessageParts([
            textPart('[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]\ncontinue'),
        ])).toBe(false);
    });

    test('rejects delegated subtask parts', () => {
        const parts = [{ type: 'subtask' } as Part];

        expect(hasSubtaskPart(parts)).toBe(true);
        expect(hasRealUserMessageParts(parts)).toBe(false);
    });
});

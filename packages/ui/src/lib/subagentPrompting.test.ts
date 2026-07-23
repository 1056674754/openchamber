import { describe, expect, test } from 'bun:test';

import { resolvePromptReadOnly } from './subagentPrompting';

describe('resolvePromptReadOnly', () => {
    test('keeps ordinary sessions governed by the container read-only state', () => {
        expect(resolvePromptReadOnly(false, false, false)).toBe(false);
        expect(resolvePromptReadOnly(true, false, true)).toBe(true);
    });

    test('keeps subagent sessions read-only by default', () => {
        expect(resolvePromptReadOnly(false, true, false)).toBe(true);
        expect(resolvePromptReadOnly(true, true, false)).toBe(true);
    });

    test('allows direct subagent prompting when explicitly enabled', () => {
        expect(resolvePromptReadOnly(false, true, true)).toBe(false);
        expect(resolvePromptReadOnly(true, true, true)).toBe(false);
    });
});

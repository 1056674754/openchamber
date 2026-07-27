import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import type { ChatMessageEntry } from './turns/types';
import {
    buildPromptPreviews,
    createPromptPreviewCache,
    getPromptPreview,
    resolvePromptNavigatorWindowStart,
    resolvePromptNavigatorActiveTurnId,
    resolvePromptNavigatorVisibleTurnIds,
} from './promptNavigatorModel';

const createMessage = (
    id: string,
    role: 'user' | 'assistant',
    parts: Part[],
    parentID?: string,
): ChatMessageEntry => ({
    info: { id, role, parentID } as unknown as Message,
    parts,
});

describe('promptNavigatorModel', () => {
    test('normalizes whitespace and truncates previews', () => {
        const parts = [{ type: 'text', text: 'first\n\nsecond   third' } as Part];

        expect(getPromptPreview(parts)).toBe('first second third');
        expect(getPromptPreview(parts, 12)).toBe('first second…');
    });

    test('keeps real prompts, skips auxiliary user messages, and extracts shell commands', () => {
        const messages = [
            createMessage('real', 'user', [{ type: 'text', text: 'inspect this code' } as Part]),
            createMessage('directive', 'user', [{ type: 'text', text: 'continue loop', synthetic: true } as unknown as Part]),
            createMessage('system-reminder', 'user', [{
                type: 'text',
                text: '<system-reminder>[BACKGROUND TASK COMPLETED]</system-reminder>',
            } as Part]),
            createMessage('shell', 'user', [{
                type: 'text',
                text: 'The following tool was executed by the user',
                synthetic: true,
            } as unknown as Part]),
            createMessage('shell-result', 'assistant', [{
                type: 'tool',
                tool: 'bash',
                state: { input: { command: 'bun test' } },
            } as unknown as Part], 'shell'),
        ];

        const previews = buildPromptPreviews(messages);

        expect([...previews.keys()]).toEqual(['real', 'shell']);
        expect(getPromptPreview(previews.get('shell') ?? [])).toBe('$ bun test');
    });

    test('maps a synthetic active turn back to the preceding real prompt', () => {
        const previews = new Map<string, Part[]>([
            ['one', [{ type: 'text', text: 'one' } as Part]],
            ['three', [{ type: 'text', text: 'three' } as Part]],
        ]);

        expect(resolvePromptNavigatorActiveTurnId(['one', 'two', 'three'], previews, 'two')).toBe('one');
        expect(resolvePromptNavigatorActiveTurnId(['one', 'two', 'three'], previews, 'three')).toBe('three');
    });

    test('keeps an active prompt that is present in complete history but absent from the local turn index', () => {
        const previews = new Map<string, Part[]>([
            ['older', [{ type: 'text', text: 'older' } as Part]],
            ['latest', [{ type: 'text', text: 'latest' } as Part]],
        ]);

        expect(resolvePromptNavigatorActiveTurnId(['latest'], previews, 'older')).toBe('older');
        expect(resolvePromptNavigatorActiveTurnId(['latest'], previews, 'missing')).toBeNull();
    });

    test('maps the visible turn window to distinct real prompts', () => {
        const previews = new Map<string, Part[]>([
            ['one', [{ type: 'text', text: 'one' } as Part]],
            ['three', [{ type: 'text', text: 'three' } as Part]],
        ]);

        expect(resolvePromptNavigatorVisibleTurnIds(
            ['one', 'two', 'three'],
            previews,
            ['one', 'two', 'three'],
        )).toEqual(['one', 'three']);
    });

    test('keeps a bounded tick window movable when the full prompt history is longer', () => {
        expect(resolvePromptNavigatorWindowStart({
            promptCount: 45,
            visibleCount: 30,
            activeIndex: 35,
        })).toBe(15);
    });

    test('reuses the preview map when streaming updates do not change user prompts', () => {
        const cache = createPromptPreviewCache();
        const userMessage = createMessage('user', 'user', [{ type: 'text', text: 'stable prompt' } as Part]);
        const first = buildPromptPreviews([userMessage], cache);
        const second = buildPromptPreviews([
            userMessage,
            createMessage('assistant', 'assistant', [{ type: 'text', text: 'streaming response' } as Part], 'user'),
        ], cache);

        expect(second).toBe(first);
    });
});

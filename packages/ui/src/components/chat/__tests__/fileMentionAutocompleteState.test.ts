import { describe, expect, test } from 'bun:test';

import {
    getFileMentionAutocompleteQuery,
    getPastedInsertedText,
} from '../fileMentionAutocompleteState';

describe('getFileMentionAutocompleteQuery', () => {
    test('opens file mention autocomplete for manually typed boundary @ text', () => {
        expect(getFileMentionAutocompleteQuery({
            value: '@config',
            cursorPosition: '@config'.length,
            inputSource: 'manual',
        })).toBe('config');

        expect(getFileMentionAutocompleteQuery({
            value: 'check @main.ts',
            cursorPosition: 'check @main.ts'.length,
            inputSource: 'manual',
        })).toBe('main.ts');
    });

    test('does not open file mention autocomplete when pasted text contains @', () => {
        for (const value of ['@config', '@/path/to/file', 'Use @main.ts', 'user@email.com', 'npx @scope/pkg@latest']) {
            expect(getFileMentionAutocompleteQuery({
                value,
                cursorPosition: value.length,
                inputSource: 'paste',
                insertedText: value,
            })).toBeNull();
        }
    });

    test('keeps autocomplete open when pasting a query fragment after a manually typed @', () => {
        expect(getFileMentionAutocompleteQuery({
            value: '@config',
            cursorPosition: '@config'.length,
            inputSource: 'paste',
            insertedText: 'config',
        })).toBe('config');
    });

    test('recovers pasted text from the paste marker when inputType is not insertFromPaste', () => {
        expect(getPastedInsertedText({
            previousValue: 'before ',
            nextValue: 'before Use @main.ts',
            inputType: 'insertText',
            pasteMarked: true,
        })).toBe('Use @main.ts');

        expect(getPastedInsertedText({
            previousValue: 'before ',
            nextValue: 'before Use @main.ts',
            inputType: 'insertText',
            pasteMarked: false,
        })).toBe('');
    });
});

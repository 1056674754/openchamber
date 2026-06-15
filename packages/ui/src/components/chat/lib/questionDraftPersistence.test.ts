import { describe, expect, test } from 'bun:test';
import {
    clearQuestionDraft,
    isQuestionHandled,
    isQuestionHandledByTool,
    loadQuestionDraft,
    markQuestionHandled,
    markQuestionHandledByTool,
    saveQuestionDraft,
    type QuestionDraftSnapshot,
} from './questionDraftPersistence';

class MemoryStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

const draft = (overrides: Partial<QuestionDraftSnapshot> = {}): QuestionDraftSnapshot => ({
    activeTab: '1',
    selectedOptions: { 0: ['A'], 1: ['B', 'C'] },
    customMode: { 2: true },
    customText: { 2: 'custom answer' },
    ...overrides,
});

describe('question draft persistence', () => {
    test('restores partially completed question answers', () => {
        const storage = new MemoryStorage();

        saveQuestionDraft('recovered-question:msg:call', draft(), storage);

        expect(loadQuestionDraft('recovered-question:msg:call', storage)).toEqual(draft());
    });

    test('clears empty drafts instead of persisting noise', () => {
        const storage = new MemoryStorage();

        saveQuestionDraft('que-empty', draft({ activeTab: '0', selectedOptions: {}, customMode: {}, customText: {} }), storage);

        expect(loadQuestionDraft('que-empty', storage)).toBeNull();
    });

    test('ignores malformed stored data', () => {
        const storage = new MemoryStorage();
        storage.setItem('openchamber:question-card-draft:v1:que-bad', '{not json');

        expect(loadQuestionDraft('que-bad', storage)).toBeNull();
    });

    test('marks handled questions and removes their draft', () => {
        const storage = new MemoryStorage();

        saveQuestionDraft('que-done', draft(), storage);
        markQuestionHandled('que-done', storage);

        expect(isQuestionHandled('que-done', storage)).toBe(true);
        expect(loadQuestionDraft('que-done', storage)).toBeNull();
    });

    test('clears only the draft state', () => {
        const storage = new MemoryStorage();

        saveQuestionDraft('que-clear', draft(), storage);
        clearQuestionDraft('que-clear', storage);

        expect(loadQuestionDraft('que-clear', storage)).toBeNull();
        expect(isQuestionHandled('que-clear', storage)).toBe(false);
    });

    test('tool-anchor handled state survives id change between live and recovered cards', () => {
        const storage = new MemoryStorage();
        const tool = { messageID: 'msg-1', callID: 'call-1' };

        markQuestionHandledByTool(tool, storage);

        expect(isQuestionHandledByTool(tool, storage)).toBe(true);
    });

    test('tool-anchor handled state is independent of request-id handled state', () => {
        const storage = new MemoryStorage();
        const tool = { messageID: 'msg-1', callID: 'call-1' };

        markQuestionHandledByTool(tool, storage);

        expect(isQuestionHandled('que-live', storage)).toBe(false);
        expect(isQuestionHandledByTool(tool, storage)).toBe(true);
    });

    test('tool-anchor handled state keys by messageID and callID', () => {
        const storage = new MemoryStorage();

        markQuestionHandledByTool({ messageID: 'msg-1', callID: 'call-1' }, storage);

        expect(isQuestionHandledByTool({ messageID: 'msg-1', callID: 'call-1' }, storage)).toBe(true);
        expect(isQuestionHandledByTool({ messageID: 'msg-1', callID: 'call-2' }, storage)).toBe(false);
        expect(isQuestionHandledByTool({ messageID: 'msg-2', callID: 'call-1' }, storage)).toBe(false);
    });
});

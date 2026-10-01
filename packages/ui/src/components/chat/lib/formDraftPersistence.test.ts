import { describe, expect, test } from 'bun:test';
import {
    clearFormDraft,
    isFormHandled,
    isFormHandledByTool,
    loadFormDraft,
    markFormHandled,
    markFormHandledByTool,
    saveFormDraft,
    type FormDraftSnapshot,
} from './formDraftPersistence';

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

const draft = (overrides: Partial<FormDraftSnapshot> = {}): FormDraftSnapshot => ({
    activeTab: '1',
    selectedOptions: { 0: ['A'], 1: ['B', 'C'] },
    customMode: { 2: true },
    customText: { 2: 'custom answer' },
    ...overrides,
});

describe('question draft persistence', () => {
    test('restores partially completed question answers', () => {
        const storage = new MemoryStorage();

        saveFormDraft('recovered-question:msg:call', draft(), storage);

        expect(loadFormDraft('recovered-question:msg:call', storage)).toEqual(draft());
    });

    test('clears empty drafts instead of persisting noise', () => {
        const storage = new MemoryStorage();

        saveFormDraft('que-empty', draft({ activeTab: '0', selectedOptions: {}, customMode: {}, customText: {} }), storage);

        expect(loadFormDraft('que-empty', storage)).toBeNull();
    });

    test('ignores malformed stored data', () => {
        const storage = new MemoryStorage();
        storage.setItem('openchamber:question-card-draft:v1:que-bad', '{not json');

        expect(loadFormDraft('que-bad', storage)).toBeNull();
    });

    test('marks handled questions and removes their draft', () => {
        const storage = new MemoryStorage();

        saveFormDraft('que-done', draft(), storage);
        markFormHandled('que-done', storage);

        expect(isFormHandled('que-done', storage)).toBe(true);
        expect(loadFormDraft('que-done', storage)).toBeNull();
    });

    test('clears only the draft state', () => {
        const storage = new MemoryStorage();

        saveFormDraft('que-clear', draft(), storage);
        clearFormDraft('que-clear', storage);

        expect(loadFormDraft('que-clear', storage)).toBeNull();
        expect(isFormHandled('que-clear', storage)).toBe(false);
    });

    test('tool-anchor handled state survives id change between live and recovered cards', () => {
        const storage = new MemoryStorage();
        const tool = { messageID: 'msg-1', callID: 'call-1' };

        markFormHandledByTool(tool, storage);

        expect(isFormHandledByTool(tool, storage)).toBe(true);
    });

    test('tool-anchor handled state is independent of request-id handled state', () => {
        const storage = new MemoryStorage();
        const tool = { messageID: 'msg-1', callID: 'call-1' };

        markFormHandledByTool(tool, storage);

        expect(isFormHandled('que-live', storage)).toBe(false);
        expect(isFormHandledByTool(tool, storage)).toBe(true);
    });

    test('tool-anchor handled state keys by messageID and callID', () => {
        const storage = new MemoryStorage();

        markFormHandledByTool({ messageID: 'msg-1', callID: 'call-1' }, storage);

        expect(isFormHandledByTool({ messageID: 'msg-1', callID: 'call-1' }, storage)).toBe(true);
        expect(isFormHandledByTool({ messageID: 'msg-1', callID: 'call-2' }, storage)).toBe(false);
        expect(isFormHandledByTool({ messageID: 'msg-2', callID: 'call-1' }, storage)).toBe(false);
    });
});

import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';
import { projectTurnRecords } from './projectTurnRecords';
import type { ChatMessageEntry } from './types';

function createMessageEntry({
    id,
    role,
    parentID,
    createdAt,
    parts,
}: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    parentID?: string;
    createdAt: number;
    parts?: Part[];
}): ChatMessageEntry {
    return {
        info: {
            id,
            role,
            ...(parentID ? { parentID } : {}),
            time: { created: createdAt },
        } as Message,
        parts: parts ?? ([] as Part[]),
    };
}

function createDirectivePart(): Part {
    return {
        type: 'text',
        text: '[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]\nplease continue',
    } as Part;
}

describe('projectTurnRecords', () => {
    test('groups assistant replies under their parent user turn', () => {
        const user = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });

        const projection = projectTurnRecords([user, assistant]);

        expect(projection.turns).toHaveLength(1);
        expect(projection.turns[0]?.turnId).toBe('u1');
        expect(projection.turns[0]?.assistantMessageIds).toEqual(['a1']);
        expect(projection.turns[0]?.isDirectiveTurn).toBe(false);
        expect(projection.ungroupedMessageIds.size).toBe(0);
    });

    test('keeps out-of-order assistant replies attached to their parent user turn', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant1 = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const assistant2 = createMessageEntry({ id: 'a2', role: 'assistant', parentID: 'u2', createdAt: 4 });
        const user2 = createMessageEntry({ id: 'u2', role: 'user', createdAt: 3 });

        const projection = projectTurnRecords([user1, assistant1, assistant2, user2]);

        expect(projection.turns).toHaveLength(2);
        expect(projection.turns[0]?.turnId).toBe('u1');
        expect(projection.turns[0]?.assistantMessageIds).toEqual(['a1']);
        expect(projection.turns[1]?.turnId).toBe('u2');
        expect(projection.turns[1]?.assistantMessageIds).toEqual(['a2']);
        expect(projection.ungroupedMessageIds.size).toBe(0);
    });

    test('keeps assistant replies visible while their parent user turn is missing', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant1 = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const assistant2 = createMessageEntry({ id: 'a2', role: 'assistant', parentID: 'u2', createdAt: 4 });

        const projection = projectTurnRecords([user1, assistant1, assistant2]);

        expect(projection.turns).toHaveLength(1);
        expect(projection.turns[0]?.turnId).toBe('u1');
        expect(projection.turns[0]?.assistantMessageIds).toEqual(['a1']);
        expect(projection.ungroupedMessageIds.has('a2')).toBe(true);
        expect(projection.indexes.messageToTurnId.has('a2')).toBe(false);
    });

    test('renders orphan assistant messages as standalone ungrouped entries', () => {
        const assistant = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'missing-user', createdAt: 1 });

        const projection = projectTurnRecords([assistant]);

        expect(projection.turns).toHaveLength(0);
        expect(projection.ungroupedMessageIds.has('a1')).toBe(true);
        expect(projection.indexes.messageToTurnId.has('a1')).toBe(false);
    });

    test('keeps non-assistant orphan messages available as ungrouped entries', () => {
        const system = createMessageEntry({ id: 's1', role: 'system', createdAt: 1 });

        const projection = projectTurnRecords([system]);

        expect(projection.turns).toHaveLength(0);
        expect(projection.ungroupedMessageIds.has('s1')).toBe(true);
    });

    test('directive creates its own turn marked isDirectiveTurn with grouped assistant', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant1 = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const directive = createMessageEntry({
            id: 'd1',
            role: 'user',
            createdAt: 3,
            parts: [createDirectivePart()],
        });
        const assistantToDirective = createMessageEntry({
            id: 'a2',
            role: 'assistant',
            parentID: 'd1',
            createdAt: 4,
        });

        const projection = projectTurnRecords([user1, assistant1, directive, assistantToDirective]);

        expect(projection.turns).toHaveLength(2);

        // Turn 1: real user
        expect(projection.turns[0]?.turnId).toBe('u1');
        expect(projection.turns[0]?.isDirectiveTurn).toBe(false);
        expect(projection.turns[0]?.assistantMessageIds).toEqual(['a1']);

        // Turn 2: directive — has its own turn so a2 groups correctly
        expect(projection.turns[1]?.turnId).toBe('d1');
        expect(projection.turns[1]?.isDirectiveTurn).toBe(true);
        expect(projection.turns[1]?.assistantMessageIds).toEqual(['a2']);

        // All messages grouped, none ungrouped
        expect(projection.ungroupedMessageIds.size).toBe(0);
    });

    test('multiple directives each get their own turn with correct assistant pairing', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const a1 = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const d1 = createMessageEntry({ id: 'd1', role: 'user', createdAt: 3, parts: [createDirectivePart()] });
        const d2 = createMessageEntry({ id: 'd2', role: 'user', createdAt: 4, parts: [createDirectivePart()] });
        const ad1 = createMessageEntry({ id: 'ad1', role: 'assistant', parentID: 'd1', createdAt: 5 });
        const ad2 = createMessageEntry({ id: 'ad2', role: 'assistant', parentID: 'd2', createdAt: 6 });

        const projection = projectTurnRecords([user1, a1, d1, d2, ad1, ad2]);

        expect(projection.turns).toHaveLength(3);
        expect(projection.turns.map((t) => t.turnId)).toEqual(['u1', 'd1', 'd2']);
        expect(projection.turns[0]?.isDirectiveTurn).toBe(false);
        expect(projection.turns[1]?.isDirectiveTurn).toBe(true);
        expect(projection.turns[2]?.isDirectiveTurn).toBe(true);
        expect(projection.turns[1]?.assistantMessageIds).toEqual(['ad1']);
        expect(projection.turns[2]?.assistantMessageIds).toEqual(['ad2']);
        expect(projection.ungroupedMessageIds.size).toBe(0);
    });
});

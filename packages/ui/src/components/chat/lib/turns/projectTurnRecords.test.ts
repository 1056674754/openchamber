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
    metadata,
}: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    parentID?: string;
    createdAt: number;
    parts?: Part[];
    metadata?: Record<string, unknown>;
}): ChatMessageEntry {
    return {
        info: {
            id,
            role,
            ...(parentID ? { parentID } : {}),
            ...(metadata ? { metadata } : {}),
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

function createSkillDirectivePart(): Part {
    return {
        type: 'text',
        text: '<skill-instruction>\nBase directory for this skill: /tmp/skills/example/\nFile references (@path) in this skill are relative to this directory.\n\nUse the example skill.\n</skill-instruction>\n\n<user-request>\nplease run it\n</user-request>',
    } as Part;
}

function createSubtaskPart(): Part {
    return { type: 'subtask' } as Part;
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

    test('skill instruction directive creates a directive turn with grouped assistant', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const skillDirective = createMessageEntry({
            id: 'd1',
            role: 'user',
            parentID: 'u1',
            createdAt: 2,
            parts: [createSkillDirectivePart()],
        });
        const assistantToDirective = createMessageEntry({
            id: 'a1',
            role: 'assistant',
            parentID: 'd1',
            createdAt: 3,
        });

        const projection = projectTurnRecords([user1, skillDirective, assistantToDirective]);

        expect(projection.turns).toHaveLength(2);
        expect(projection.turns[0]?.isDirectiveTurn).toBe(false);
        expect(projection.turns[1]?.turnId).toBe('d1');
        expect(projection.turns[1]?.isDirectiveTurn).toBe(true);
        expect(projection.turns[1]?.assistantMessageIds).toEqual(['a1']);
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

    test('subtask continuation user message folds under parent turn (isDirectiveTurn)', () => {
        const user = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const subtaskContinuation = createMessageEntry({
            id: 's1',
            role: 'user',
            parentID: 'a1',
            createdAt: 3,
            parts: [createSubtaskPart()],
        });
        const assistantToSubtask = createMessageEntry({
            id: 'a2',
            role: 'assistant',
            parentID: 's1',
            createdAt: 4,
        });

        const projection = projectTurnRecords([user, assistant, subtaskContinuation, assistantToSubtask]);

        expect(projection.turns).toHaveLength(2);

        expect(projection.turns[0]?.turnId).toBe('u1');
        expect(projection.turns[0]?.isDirectiveTurn).toBe(false);
        expect(projection.turns[0]?.assistantMessageIds).toEqual(['a1']);

        // The subtask continuation turn is marked foldable so MessageList
        // attaches it under its parent real-user turn instead of rendering
        // a new sticky-header conversation block.
        expect(projection.turns[1]?.turnId).toBe('s1');
        expect(projection.turns[1]?.isDirectiveTurn).toBe(true);
        expect(projection.turns[1]?.assistantMessageIds).toEqual(['a2']);

        expect(projection.ungroupedMessageIds.size).toBe(0);
    });

    test('live steer user message folds under parent turn (isDirectiveTurn)', () => {
        const user = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const steer = createMessageEntry({
            id: 'st1',
            role: 'user',
            parentID: 'a1',
            createdAt: 3,
            metadata: { openchamberLiveSteer: true },
            parts: [{
                type: 'text',
                text: 'steer this running turn',
            } as Part],
        });
        const assistantToSteer = createMessageEntry({
            id: 'a2',
            role: 'assistant',
            parentID: 'st1',
            createdAt: 4,
        });

        const projection = projectTurnRecords([user, assistant, steer, assistantToSteer]);

        expect(projection.turns).toHaveLength(2);
        expect(projection.turns[0]?.turnId).toBe('u1');
        expect(projection.turns[0]?.isDirectiveTurn).toBe(false);
        expect(projection.turns[1]?.turnId).toBe('st1');
        expect(projection.turns[1]?.isDirectiveTurn).toBe(true);
        expect(projection.turns[1]?.assistantMessageIds).toEqual(['a2']);
        expect(projection.ungroupedMessageIds.size).toBe(0);
    });

    test('assistant-parented user message is inferred as live steer when metadata is missing', () => {
        const user = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const steer = createMessageEntry({
            id: 'st1',
            role: 'user',
            parentID: 'a1',
            createdAt: 3,
            parts: [{
                type: 'text',
                text: 'steer this running turn',
            } as Part],
        });

        const projection = projectTurnRecords([user, assistant, steer]);

        expect(projection.turns).toHaveLength(2);
        expect(projection.turns[1]?.turnId).toBe('st1');
        expect(projection.turns[1]?.isDirectiveTurn).toBe(true);
        expect((projection.turns[1]?.userMessage.info as unknown as { metadata?: Record<string, unknown> }).metadata?.openchamberLiveSteer).toBe(true);
        expect(projection.ungroupedMessageIds.size).toBe(0);
    });

    test('real user message after a subtask continuation is NOT foldable', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const a1 = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const subtask = createMessageEntry({
            id: 's1',
            role: 'user',
            parentID: 'a1',
            createdAt: 3,
            parts: [createSubtaskPart()],
        });
        const a2 = createMessageEntry({ id: 'a2', role: 'assistant', parentID: 's1', createdAt: 4 });
        const user2 = createMessageEntry({ id: 'u2', role: 'user', createdAt: 5 });
        const a3 = createMessageEntry({ id: 'a3', role: 'assistant', parentID: 'u2', createdAt: 6 });

        const projection = projectTurnRecords([user1, a1, subtask, a2, user2, a3]);

        expect(projection.turns).toHaveLength(3);
        expect(projection.turns.map((t) => t.turnId)).toEqual(['u1', 's1', 'u2']);
        expect(projection.turns[0]?.isDirectiveTurn).toBe(false);
        expect(projection.turns[1]?.isDirectiveTurn).toBe(true);
        expect(projection.turns[2]?.isDirectiveTurn).toBe(false);
        expect(projection.turns[2]?.assistantMessageIds).toEqual(['a3']);
        expect(projection.ungroupedMessageIds.size).toBe(0);
    });

    test('merges turns started by hidden user messages when merging is enabled', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        user1.parts = [{ id: 'p1', type: 'text', text: 'visible prompt' } as Part];
        const assistant1 = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const hiddenUser = createMessageEntry({ id: 'u2', role: 'user', createdAt: 3 });
        const assistant2 = createMessageEntry({ id: 'a2', role: 'assistant', parentID: 'u2', createdAt: 4 });

        const projection = projectTurnRecords([user1, assistant1, hiddenUser, assistant2], {
            mergeHiddenUserTurns: { planModeEnabled: false },
        });

        expect(projection.turns).toHaveLength(1);
        expect(projection.turns[0]?.turnId).toBe('u1');
        expect(projection.turns[0]?.assistantMessageIds).toEqual(['a1', 'a2']);
        expect(projection.ungroupedMessageIds.has('u2')).toBe(false);
    });

    test('keeps hidden user messages as separate turns when merging is disabled', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant1 = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const hiddenUser = createMessageEntry({ id: 'u2', role: 'user', createdAt: 3 });
        const assistant2 = createMessageEntry({ id: 'a2', role: 'assistant', parentID: 'u2', createdAt: 4 });

        const projection = projectTurnRecords([user1, assistant1, hiddenUser, assistant2]);

        expect(projection.turns).toHaveLength(2);
        expect(projection.turns[1]?.turnId).toBe('u2');
    });

    test('does not merge a hidden user message when there is no previous turn', () => {
        const hiddenUser = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const assistant = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });

        const projection = projectTurnRecords([hiddenUser, assistant], {
            mergeHiddenUserTurns: { planModeEnabled: false },
        });

        expect(projection.turns).toHaveLength(1);
        expect(projection.turns[0]?.turnId).toBe('u1');
        expect(projection.turns[0]?.assistantMessageIds).toEqual(['a1']);
    });

    test('chains merges across consecutive hidden user messages', () => {
        const user1 = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        user1.parts = [{ id: 'p1', type: 'text', text: 'visible prompt' } as Part];
        const assistant1 = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const hidden1 = createMessageEntry({ id: 'u2', role: 'user', createdAt: 3 });
        const assistant2 = createMessageEntry({ id: 'a2', role: 'assistant', parentID: 'u2', createdAt: 4 });
        const hidden2 = createMessageEntry({ id: 'u3', role: 'user', createdAt: 5 });
        const assistant3 = createMessageEntry({ id: 'a3', role: 'assistant', parentID: 'u3', createdAt: 6 });

        const projection = projectTurnRecords([user1, assistant1, hidden1, assistant2, hidden2, assistant3], {
            mergeHiddenUserTurns: { planModeEnabled: false },
        });

        expect(projection.turns).toHaveLength(1);
        expect(projection.turns[0]?.assistantMessageIds).toEqual(['a1', 'a2', 'a3']);
    });

    test('treats compaction summary text as justification activity in sorted mode', () => {
        const user = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        user.parts = [{ id: 'p1', type: 'text', text: 'prompt' } as Part];
        const compaction = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        (compaction.info as { summary?: boolean; finish?: string }).summary = true;
        (compaction.info as { summary?: boolean; finish?: string }).finish = 'stop';
        compaction.parts = [{ id: 'cp1', type: 'text', text: 'compacted context summary' } as Part];
        const assistant = createMessageEntry({ id: 'a2', role: 'assistant', parentID: 'u1', createdAt: 3 });
        (assistant.info as { finish?: string }).finish = 'stop';
        assistant.parts = [{ id: 'ap1', type: 'text', text: 'final answer' } as Part];

        const projection = projectTurnRecords([user, compaction, assistant], {
            showTextJustificationActivity: true,
        });

        const turn = projection.turns[0];
        expect(turn?.summaryText).toBe('final answer');
        const compactionActivity = turn?.activityParts.find((activity) => activity.messageId === 'a1');
        expect(compactionActivity?.kind).toBe('justification');
        const finalActivity = turn?.activityParts.find((activity) => activity.messageId === 'a2');
        expect(finalActivity).toBe(undefined);
    });
});

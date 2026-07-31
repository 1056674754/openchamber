import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';
import {
    deriveAutoExpandedTurnIds,
    deriveProcessFoldState,
    resolveProcessFoldExpansion,
    setProcessFoldOverride,
    turnHasStopSummary,
} from './processFold';
import { projectTurnRecords } from './projectTurnRecords';
import type { ChatMessageEntry, TurnRecord } from './types';

function createMessageEntry({
    id,
    role,
    parentID,
    finish,
    stepFinish,
    createdAt,
}: {
    id: string;
    role: 'user' | 'assistant';
    parentID?: string;
    finish?: string;
    stepFinish?: string;
    createdAt: number;
}): ChatMessageEntry {
    return {
        info: {
            id,
            role,
            ...(parentID ? { parentID } : {}),
            ...(finish ? { finish } : {}),
            time: { created: createdAt },
        } as Message,
        parts: stepFinish
            ? [{
                id: `${id}-step-finish`,
                sessionID: 'ses_1',
                messageID: id,
                type: 'step-finish',
                reason: stepFinish,
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            } as Part]
            : [] as Part[],
    };
}

function createTurn({ withStop = false }: { withStop?: boolean } = {}): TurnRecord {
    const user = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
    const process = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
    const messages = withStop
        ? [
            user,
            process,
            createMessageEntry({ id: 'a2', role: 'assistant', parentID: 'u1', finish: 'stop', createdAt: 3 }),
        ]
        : [user, process];
    const turn = projectTurnRecords(messages).turns[0];
    if (!turn) {
        throw new Error('Expected turn fixture to be projected');
    }
    return turn;
}

describe('process fold state', () => {
    test('detects a stop summary on the final assistant message', () => {
        expect(turnHasStopSummary(createTurn({ withStop: true }))).toBe(true);
        expect(turnHasStopSummary(createTurn())).toBe(false);
    });

    test('detects a stop summary from a step-finish part', () => {
        const user = createMessageEntry({ id: 'u1', role: 'user', createdAt: 1 });
        const process = createMessageEntry({ id: 'a1', role: 'assistant', parentID: 'u1', createdAt: 2 });
        const summary = createMessageEntry({
            id: 'a2',
            role: 'assistant',
            parentID: 'u1',
            stepFinish: 'stop',
            createdAt: 3,
        });
        const turn = projectTurnRecords([user, process, summary]).turns[0];

        expect(turn ? turnHasStopSummary(turn) : false).toBe(true);
    });

    test('does not force-open a historical tail turn just because the session is working', () => {
        const turn = createTurn();

        expect(deriveProcessFoldState({
            turn,
            sessionIsWorking: true,
            defaultActivityExpanded: false,
            autoExpandedTurnIds: new Set(),
            activeStreamingTurnId: null,
            lastTurnId: 'other-turn',
        })).toEqual({
            expanded: false,
            enabled: true,
        });
    });

    test('force-opens only the incomplete turn containing the active streaming message', () => {
        const turn = createTurn();

        expect(deriveProcessFoldState({
            turn,
            sessionIsWorking: true,
            defaultActivityExpanded: false,
            autoExpandedTurnIds: new Set(),
            activeStreamingTurnId: turn.turnId,
            lastTurnId: turn.turnId,
        })).toEqual({
            expanded: true,
            enabled: false,
        });
    });

    test('does not force-open a stale active turn when it is no longer last', () => {
        const turn = createTurn();

        expect(deriveProcessFoldState({
            turn,
            sessionIsWorking: true,
            defaultActivityExpanded: false,
            autoExpandedTurnIds: new Set([turn.turnId]),
            activeStreamingTurnId: turn.turnId,
            lastTurnId: 'newer-turn',
        })).toEqual({
            expanded: false,
            enabled: true,
        });
    });

    test('keeps a completed active tail turn collapsed by default', () => {
        const turn = createTurn({ withStop: true });

        expect(deriveProcessFoldState({
            turn,
            sessionIsWorking: true,
            defaultActivityExpanded: false,
            autoExpandedTurnIds: new Set([turn.turnId]),
            activeStreamingTurnId: turn.turnId,
            lastTurnId: turn.turnId,
        })).toEqual({
            expanded: false,
            enabled: true,
        });
    });

    test('keeps an interacted live process open when the turn becomes completed', () => {
        const userExpanded = true;

        expect(resolveProcessFoldExpansion({
            foldDefault: { expanded: false, enabled: true },
            userExpanded,
        })).toBe(true);
    });

    test('keeps a process override in hoisted turn state across a renderer remount', () => {
        const liveRendererState = setProcessFoldOverride(undefined, 'fold-0', true);
        const staticRendererState = setProcessFoldOverride(liveRendererState, 'fold-1', false);

        expect(staticRendererState.get('fold-0')).toBe(true);
        expect(staticRendererState.get('fold-1')).toBe(false);
    });

    test('ignores stale auto-expanded turn ids once the session is not working', () => {
        const turn = createTurn();

        expect(deriveProcessFoldState({
            turn,
            sessionIsWorking: false,
            defaultActivityExpanded: false,
            autoExpandedTurnIds: new Set([turn.turnId]),
            activeStreamingTurnId: null,
            lastTurnId: turn.turnId,
        })).toEqual({
            expanded: false,
            enabled: true,
        });
    });

    test('clears stale auto-expanded turn ids when there is no active streaming turn', () => {
        const previous = new Set(['u1', 'u2']);

        expect(Array.from(deriveAutoExpandedTurnIds({
            previous,
            sessionIsWorking: true,
            activeStreamingTurnId: null,
            activeStreamingTurnHasStop: false,
        }))).toEqual([]);
    });

    test('keeps only the active streaming turn in auto-expanded state', () => {
        const previous = new Set(['old']);

        expect(Array.from(deriveAutoExpandedTurnIds({
            previous,
            sessionIsWorking: true,
            activeStreamingTurnId: 'u1',
            activeStreamingTurnHasStop: false,
        }))).toEqual(['u1']);
    });
});

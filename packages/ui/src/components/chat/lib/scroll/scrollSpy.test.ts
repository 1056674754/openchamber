import { describe, expect, test } from 'bun:test';

import { pickActiveTurnId, pickOffsetTurnId, pickVisibleTurnIds } from './scrollSpy';

const offsets = [
    { id: 'turn-1', top: 0 },
    { id: 'turn-2', top: 700 },
    { id: 'turn-3', top: 1600 },
];

describe('scrollSpy', () => {
    test('selects the last turn above the reading line', () => {
        expect(pickOffsetTurnId(offsets, 800)).toBe('turn-2');
        expect(pickActiveTurnId(offsets, {
            scrollTop: 700,
            scrollHeight: 2400,
            clientHeight: 800,
        })).toBe('turn-2');
    });

    test('anchors the final turn throughout the near-bottom zone', () => {
        const bottomOffsets = [
            { id: 'turn-1', top: 0 },
            { id: 'turn-2', top: 700 },
            { id: 'turn-3', top: 1700 },
        ];

        expect(pickActiveTurnId(bottomOffsets, {
            scrollTop: 1600,
            scrollHeight: 2400,
            clientHeight: 800,
        })).toBe('turn-3');
        expect(pickActiveTurnId(bottomOffsets, {
            scrollTop: 1520,
            scrollHeight: 2400,
            clientHeight: 800,
        })).toBe('turn-3');
        expect(pickActiveTurnId(bottomOffsets, {
            scrollTop: 1519,
            scrollHeight: 2400,
            clientHeight: 800,
        })).toBe('turn-2');
        expect(pickActiveTurnId(bottomOffsets, {
            scrollTop: 870,
            scrollHeight: 1000,
            clientHeight: 100,
        })).toBe('turn-3');
    });

    test('returns every turn intersecting the viewport', () => {
        const measuredOffsets = [
            { id: 'turn-1', top: 0, bottom: 700 },
            { id: 'turn-2', top: 700, bottom: 1600 },
            { id: 'turn-3', top: 1600, bottom: 2400 },
        ];

        expect(pickVisibleTurnIds(measuredOffsets, {
            scrollTop: 650,
            scrollHeight: 2400,
            clientHeight: 800,
        })).toEqual(['turn-1', 'turn-2']);
    });

    test('keeps one visible turn when a single turn fills the viewport', () => {
        expect(pickVisibleTurnIds([
            { id: 'turn-1', top: 0, bottom: 2000 },
            { id: 'turn-2', top: 2000, bottom: 2400 },
        ], {
            scrollTop: 900,
            scrollHeight: 2400,
            clientHeight: 800,
        })).toEqual(['turn-1']);
    });
});

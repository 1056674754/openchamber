import { describe, expect, test } from 'bun:test';

import { pickActiveTurnId, pickOffsetTurnId } from './scrollSpy';

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

    test('anchors the final turn at the physical bottom', () => {
        expect(pickActiveTurnId(offsets, {
            scrollTop: 1600,
            scrollHeight: 2400,
            clientHeight: 800,
        })).toBe('turn-3');
        expect(pickActiveTurnId(offsets, {
            scrollTop: 1593,
            scrollHeight: 2400,
            clientHeight: 800,
        })).toBe('turn-3');
    });
});

import { describe, expect, test } from 'bun:test';

import {
    CHAT_LIST_ANCHOR_OFFSET,
    getAnchoredTurnOverflow,
    resolveAnchoredScrollTop,
} from './anchoredTurn';

const base = {
    scroll: 0,
    scrollLength: 800,
};

describe('getAnchoredTurnOverflow', () => {
    test('a turn that fits keeps the viewport parked', () => {
        // Anchor at top, content ends 500px down — fits in 800-16.
        const result = getAnchoredTurnOverflow({ ...base, anchorTop: 100, contentEnd: 600 });
        expect(result.turnHeight).toBe(500);
        expect(result.usableViewportHeight).toBe(800 - CHAT_LIST_ANCHOR_OFFSET);
        expect(result.overflows).toBe(false);
        expect(result.targetScrollToRevealEnd).toBe(0);
    });

    test('a turn that outgrows the usable viewport overflows and yields a reveal target', () => {
        // Anchor at 100, content ends at 1200 → turn 1100 > 784 usable.
        const result = getAnchoredTurnOverflow({ ...base, anchorTop: 100, contentEnd: 1200 });
        expect(result.overflows).toBe(true);
        expect(result.targetScrollToRevealEnd).toBe(1200 - (800 - CHAT_LIST_ANCHOR_OFFSET));
    });

    test('a growing turn crosses the overflow boundary exactly at usable height', () => {
        const anchorTop = 100;
        const usable = 800 - CHAT_LIST_ANCHOR_OFFSET;
        const fits = getAnchoredTurnOverflow({ ...base, anchorTop, contentEnd: anchorTop + usable });
        expect(fits.overflows).toBe(false);

        const over = getAnchoredTurnOverflow({ ...base, anchorTop, contentEnd: anchorTop + usable + 1 });
        expect(over.overflows).toBe(true);
    });

    test('the reveal target never scrolls backwards when the end is already visible', () => {
        // Scrolled deep; end already on screen — target must clamp to 0+.
        const result = getAnchoredTurnOverflow({ scroll: 500, scrollLength: 800, anchorTop: 300, contentEnd: 900 });
        expect(result.overflows).toBe(false);
        expect(result.targetScrollToRevealEnd).toBe(900 - (800 - CHAT_LIST_ANCHOR_OFFSET));
    });

    test('zero-height content yields a zero turn that fits', () => {
        const result = getAnchoredTurnOverflow({ ...base, anchorTop: 0, contentEnd: 0 });
        expect(result.turnHeight).toBe(0);
        expect(result.overflows).toBe(false);
    });
});

describe('resolveAnchoredScrollTop', () => {
    test('parks the anchor below the top offset', () => {
        expect(resolveAnchoredScrollTop(500)).toBe(500 - CHAT_LIST_ANCHOR_OFFSET);
    });

    test('never scrolls above the top', () => {
        expect(resolveAnchoredScrollTop(4)).toBe(0);
        expect(resolveAnchoredScrollTop(0)).toBe(0);
    });

    test('honors a custom anchor offset', () => {
        expect(resolveAnchoredScrollTop(100, 40)).toBe(60);
    });
});

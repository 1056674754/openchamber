import { describe, expect, test } from 'bun:test';

import {
    getOlderHistoryPrefetchThreshold,
    isVerticallyScrollable,
    shouldPrefetchOlderHistory,
    shouldStartOlderHistoryPrefetch,
    shouldCompensateVirtualItemResize,
    shouldPauseAutoScrollAtBoundary,
    shouldPauseAutoScrollOnWheel,
} from './scrollIntent';

describe('older history prefetch', () => {
    test('starts before the user reaches the top of a typical chat viewport', () => {
        expect(shouldPrefetchOlderHistory({
            scrollTop: 2000,
            clientHeight: 800,
        })).toBe(true);
        expect(shouldPrefetchOlderHistory({
            scrollTop: 2401,
            clientHeight: 800,
        })).toBe(false);
    });

    test('scales the lead distance for tall viewports', () => {
        expect(getOlderHistoryPrefetchThreshold(1600)).toBe(4800);
    });

    test('does not repeat an automatic request for an unchanged history version', () => {
        expect(shouldStartOlderHistoryPrefetch({
            historyVersion: 'session-a:oldest-1:150',
            attemptedVersion: 'session-a:oldest-1:150',
            requestPending: false,
            isLoadingOlder: false,
            isWithinRange: true,
        })).toBe(false);
        expect(shouldStartOlderHistoryPrefetch({
            historyVersion: 'session-a:oldest-2:300',
            attemptedVersion: 'session-a:oldest-1:150',
            requestPending: false,
            isLoadingOlder: false,
            isWithinRange: true,
        })).toBe(true);
    });
});

describe('auto-follow wheel intent', () => {
    test('releases for a downward wheel while more content remains below', () => {
        const root = {
            scrollTop: 400,
            clientHeight: 600,
            scrollHeight: 1600,
        } as HTMLElement;

        expect(shouldPauseAutoScrollOnWheel({ root, target: null, delta: 120 })).toBe(true);
    });

    test('keeps following for a downward wheel that is already at the bottom', () => {
        const root = {
            scrollTop: 1000,
            clientHeight: 600,
            scrollHeight: 1600,
        } as HTMLElement;

        expect(shouldPauseAutoScrollOnWheel({ root, target: null, delta: 120 })).toBe(false);
    });

    test('releases immediately for an upward wheel', () => {
        const root = {
            scrollTop: 1000,
            clientHeight: 600,
            scrollHeight: 1600,
        } as HTMLElement;

        expect(shouldPauseAutoScrollOnWheel({ root, target: null, delta: -120 })).toBe(true);
    });

    test('leaves a nested scroller in control while it has room', () => {
        const root = {
            scrollTop: 400,
            clientHeight: 600,
            scrollHeight: 1600,
        } as HTMLElement;
        const nested = {
            scrollTop: 120,
            clientHeight: 200,
            scrollHeight: 600,
        } as HTMLElement;

        expect(shouldPauseAutoScrollAtBoundary({ root, boundary: nested, delta: -40 })).toBe(false);
        expect(shouldPauseAutoScrollAtBoundary({ root, boundary: nested, delta: 40 })).toBe(false);
    });

    test('releases when a nested scroller reaches the gesture boundary', () => {
        const root = {
            scrollTop: 400,
            clientHeight: 600,
            scrollHeight: 1600,
        } as HTMLElement;
        const nestedAtTop = {
            scrollTop: 0,
            clientHeight: 200,
            scrollHeight: 600,
        } as HTMLElement;
        const nestedAtBottom = {
            scrollTop: 400,
            clientHeight: 200,
            scrollHeight: 600,
        } as HTMLElement;

        expect(shouldPauseAutoScrollAtBoundary({ root, boundary: nestedAtTop, delta: -40 })).toBe(true);
        expect(shouldPauseAutoScrollAtBoundary({ root, boundary: nestedAtBottom, delta: 40 })).toBe(true);
    });

    test('recognizes an unmarked overflow surface by computed geometry', () => {
        expect(isVerticallyScrollable({
            scrollHeight: 600,
            clientHeight: 200,
            overflowY: 'auto',
        })).toBe(true);
        expect(isVerticallyScrollable({
            scrollHeight: 200,
            clientHeight: 200,
            overflowY: 'auto',
        })).toBe(false);
        expect(isVerticallyScrollable({
            scrollHeight: 600,
            clientHeight: 200,
            overflowY: 'hidden',
        })).toBe(false);
    });
});

describe('virtualized chat resize compensation', () => {
    test('does not write against an active scroll gesture', () => {
        expect(shouldCompensateVirtualItemResize({
            isScrolling: true,
            scrollInteractionActive: false,
            processFoldTransitionActive: false,
            isAtEnd: false,
            itemIndex: 2,
            firstVisibleIndex: 8,
        })).toBe(false);
    });

    test('keeps the gesture protected until delayed measurements settle', () => {
        expect(shouldCompensateVirtualItemResize({
            isScrolling: false,
            scrollInteractionActive: true,
            processFoldTransitionActive: false,
            isAtEnd: false,
            itemIndex: 2,
            firstVisibleIndex: 8,
        })).toBe(false);
    });

    test('preserves a settled viewport when an earlier item changes height', () => {
        expect(shouldCompensateVirtualItemResize({
            isScrolling: false,
            scrollInteractionActive: false,
            processFoldTransitionActive: false,
            isAtEnd: false,
            itemIndex: 2,
            firstVisibleIndex: 8,
        })).toBe(true);
    });

    test('does not compensate fold transitions or bottom-pinned history', () => {
        const base = {
            isScrolling: false,
            scrollInteractionActive: false,
            itemIndex: 2,
            firstVisibleIndex: 8,
        };

        expect(shouldCompensateVirtualItemResize({
            ...base,
            processFoldTransitionActive: true,
            isAtEnd: false,
        })).toBe(false);
        expect(shouldCompensateVirtualItemResize({
            ...base,
            processFoldTransitionActive: false,
            isAtEnd: true,
        })).toBe(false);
    });
});

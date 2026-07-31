import { describe, expect, test } from 'bun:test';

import {
    getMessageListOverscan,
    getOlderHistoryPrefetchThreshold,
    isMatchingAutoScrollPosition,
    isVerticallyScrollable,
    resolveSessionEntryScrollAction,
    shouldRevealInitialLatestViewport,
    shouldPrefetchOlderHistory,
    shouldStartOlderHistoryPrefetch,
    shouldCompensateVirtualItemResize,
    shouldApplyPassiveAutoFollow,
    shouldPinFollowedViewportOnWorkingChange,
    shouldPauseAutoScrollAtBoundary,
    shouldPauseAutoScrollOnWheel,
} from './scrollIntent';

describe('session entry scroll', () => {
    test('waits for renderable history before placing the viewport', () => {
        expect(resolveSessionEntryScrollAction({
            hasRenderableSnapshot: false,
            hasHashTarget: false,
        })).toBe('wait');
    });

    test('opens a cached historical session at its latest message', () => {
        expect(resolveSessionEntryScrollAction({
            hasRenderableSnapshot: true,
            hasHashTarget: false,
        })).toBe('latest');
    });

    test('leaves hash-targeted history to message navigation', () => {
        expect(resolveSessionEntryScrollAction({
            hasRenderableSnapshot: true,
            hasHashTarget: true,
        })).toBe('hash');
    });

    test('keeps latest history hidden until the bottom range is quiet', () => {
        const base = {
            atBottom: true,
            hasLastHistoryEntry: true,
            startedAt: 100,
            lastLayoutChangeAt: 900,
            quietPeriodMs: 250,
            maxWaitMs: 2000,
        };

        expect(shouldRevealInitialLatestViewport({
            ...base,
            now: 1000,
        })).toBe(false);
        expect(shouldRevealInitialLatestViewport({
            ...base,
            now: 1150,
        })).toBe(true);
        expect(shouldRevealInitialLatestViewport({
            ...base,
            now: 2200,
            hasLastHistoryEntry: false,
        })).toBe(false);
    });

    test('reveals a continuously changing live session only after the bounded wait', () => {
        expect(shouldRevealInitialLatestViewport({
            atBottom: true,
            hasLastHistoryEntry: true,
            startedAt: 100,
            lastLayoutChangeAt: 2050,
            now: 2100,
            quietPeriodMs: 250,
            maxWaitMs: 2000,
        })).toBe(true);
    });

    test('BUG: max-wait fires while layout is still actively changing', () => {
        const startedAt = 0;
        const maxWaitMs = 2000;
        const quietPeriodMs = 250;

        expect(shouldRevealInitialLatestViewport({
            atBottom: true,
            hasLastHistoryEntry: true,
            startedAt,
            lastLayoutChangeAt: 1940,
            now: 1990,
            quietPeriodMs,
            maxWaitMs,
        })).toBe(false);

        expect(shouldRevealInitialLatestViewport({
            atBottom: true,
            hasLastHistoryEntry: true,
            startedAt,
            lastLayoutChangeAt: 1990,
            now: 2010,
            quietPeriodMs,
            maxWaitMs,
        })).toBe(true);
    });

    test('BUG: convergence can fire on a partially-measured virtualized list', () => {
        expect(shouldRevealInitialLatestViewport({
            atBottom: true,
            hasLastHistoryEntry: true,
            startedAt: 0,
            lastLayoutChangeAt: 1980,
            now: 2010,
            quietPeriodMs: 250,
            maxWaitMs: 2000,
        })).toBe(true);
    });
});

describe('passive chat auto-follow', () => {
    test('runs only while a followed session is working or settling', () => {
        expect(shouldApplyPassiveAutoFollow({
            state: 'following',
            sessionIsWorking: true,
            settling: false,
            processFoldTransitionActive: false,
        })).toBe(true);
        expect(shouldApplyPassiveAutoFollow({
            state: 'following',
            sessionIsWorking: false,
            settling: true,
            processFoldTransitionActive: false,
        })).toBe(true);
        expect(shouldApplyPassiveAutoFollow({
            state: 'following',
            sessionIsWorking: false,
            settling: false,
            processFoldTransitionActive: false,
        })).toBe(false);
        expect(shouldApplyPassiveAutoFollow({
            state: 'released',
            sessionIsWorking: true,
            settling: false,
            processFoldTransitionActive: false,
        })).toBe(false);
        expect(shouldApplyPassiveAutoFollow({
            state: 'following',
            sessionIsWorking: true,
            settling: false,
            processFoldTransitionActive: true,
        })).toBe(false);
    });

    test('pins a followed viewport when a running turn finishes', () => {
        expect(shouldPinFollowedViewportOnWorkingChange({
            state: 'following',
            sameSession: true,
            wasWorking: true,
            sessionIsWorking: false,
        })).toBe(true);
        expect(shouldPinFollowedViewportOnWorkingChange({
            state: 'released',
            sameSession: true,
            wasWorking: true,
            sessionIsWorking: false,
        })).toBe(false);
        expect(shouldPinFollowedViewportOnWorkingChange({
            state: 'following',
            sameSession: true,
            wasWorking: false,
            sessionIsWorking: false,
        })).toBe(false);
        expect(shouldPinFollowedViewportOnWorkingChange({
            state: 'following',
            sameSession: false,
            wasWorking: true,
            sessionIsWorking: false,
        })).toBe(false);
    });
});

describe('message list overscan', () => {
    test('keeps more rows mounted for touch momentum scrolling', () => {
        expect(getMessageListOverscan(false)).toBe(6);
        expect(getMessageListOverscan(true)).toBe(12);
    });
});

describe('auto-follow programmatic marker', () => {
    test('matches only the recent programmatic destination', () => {
        expect(isMatchingAutoScrollPosition({
            currentTop: 1000,
            markedTop: 1001,
            markedAt: 500,
            currentTime: 1800,
            ttl: 1500,
            tolerance: 2,
        })).toBe(true);
        expect(isMatchingAutoScrollPosition({
            currentTop: 900,
            markedTop: 1000,
            markedAt: 500,
            currentTime: 1800,
            ttl: 1500,
            tolerance: 2,
        })).toBe(false);
        expect(isMatchingAutoScrollPosition({
            currentTop: 1000,
            markedTop: 1000,
            markedAt: 500,
            currentTime: 2101,
            ttl: 1500,
            tolerance: 2,
        })).toBe(false);
    });
});

describe('older history prefetch', () => {
    test('merges the prepared page within one typical chat viewport of the top', () => {
        expect(shouldPrefetchOlderHistory({
            scrollTop: 700,
            clientHeight: 800,
        })).toBe(true);
        expect(shouldPrefetchOlderHistory({
            scrollTop: 801,
            clientHeight: 800,
        })).toBe(false);
    });

    test('scales the lead distance for tall viewports', () => {
        expect(getOlderHistoryPrefetchThreshold(1600)).toBe(1600);
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

    test('does not rewrite a settled reading viewport when an earlier item changes height', () => {
        expect(shouldCompensateVirtualItemResize({
            isScrolling: false,
            scrollInteractionActive: false,
            processFoldTransitionActive: false,
            isAtEnd: false,
            itemIndex: 2,
            firstVisibleIndex: 8,
        })).toBe(false);
    });

    test('keeps a settled bottom-pinned viewport anchored as rows finish measuring', () => {
        const base = {
            isScrolling: false,
            scrollInteractionActive: false,
            itemIndex: 2,
            firstVisibleIndex: 8,
        };

        expect(shouldCompensateVirtualItemResize({
            ...base,
            processFoldTransitionActive: false,
            isAtEnd: true,
        })).toBe(true);
    });

    test('does not compensate fold transitions', () => {
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
    });
});

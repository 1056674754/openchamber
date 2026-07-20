export const normalizeWheelDelta = (input: {
    deltaY: number;
    deltaMode: number;
    rootHeight?: number;
}): number => {
    if (input.deltaMode === 1) {
        return input.deltaY * 40;
    }
    if (input.deltaMode === 2) {
        return input.deltaY * (input.rootHeight ?? 120);
    }
    return input.deltaY;
};

export const shouldMarkBoundaryGesture = (input: {
    delta: number;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}): boolean => {
    const max = input.scrollHeight - input.clientHeight;
    if (max <= 1) {
        return true;
    }

    if (!input.delta) {
        return false;
    }

    if (input.delta < 0) {
        return input.scrollTop + input.delta <= 0;
    }

    const remaining = max - input.scrollTop;
    return input.delta > remaining;
};

export const isVerticallyScrollable = (input: {
    scrollHeight: number;
    clientHeight: number;
    overflowY: string;
}): boolean => {
    return input.scrollHeight > input.clientHeight + 1
        && /^(auto|scroll|overlay)$/.test(input.overflowY);
};

export const boundaryTarget = (root: HTMLElement, target: EventTarget | null): HTMLElement => {
    const current = typeof Element !== 'undefined' && target instanceof Element ? target : undefined;
    const marked = current?.closest('[data-scrollable]');
    if (marked && marked !== root && marked instanceof HTMLElement) {
        return marked;
    }

    let candidate = current;
    while (candidate && candidate !== root) {
        if (candidate instanceof HTMLElement) {
            const overflowY = typeof window !== 'undefined'
                ? window.getComputedStyle(candidate).overflowY
                : '';
            if (isVerticallyScrollable({
                scrollHeight: candidate.scrollHeight,
                clientHeight: candidate.clientHeight,
                overflowY,
            })) {
                return candidate;
            }
        }
        candidate = candidate.parentElement ?? undefined;
    }

    return root;
};

export const shouldPauseAutoScrollAtBoundary = (input: {
    root: HTMLElement;
    boundary: HTMLElement;
    delta: number;
}): boolean => {
    if (input.delta === 0) {
        return false;
    }

    if (input.boundary === input.root) {
        if (input.delta < 0) {
            return true;
        }
        return input.boundary.scrollTop + input.boundary.clientHeight < input.boundary.scrollHeight - 1;
    }

    return shouldMarkBoundaryGesture({
        delta: input.delta,
        scrollTop: input.boundary.scrollTop,
        scrollHeight: input.boundary.scrollHeight,
        clientHeight: input.boundary.clientHeight,
    });
};

export const shouldPauseAutoScrollOnWheel = (input: {
    root: HTMLElement;
    target: EventTarget | null;
    delta: number;
}): boolean => {
    return shouldPauseAutoScrollAtBoundary({
        root: input.root,
        boundary: boundaryTarget(input.root, input.target),
        delta: input.delta,
    });
};

export const isNearTop = (scrollTop: number, threshold: number): boolean => {
    return scrollTop <= threshold;
};

const OLDER_HISTORY_PREFETCH_MIN_PX = 2400;
const OLDER_HISTORY_PREFETCH_VIEWPORT_RATIO = 3;

export const getOlderHistoryPrefetchThreshold = (clientHeight: number): number => {
    return Math.max(OLDER_HISTORY_PREFETCH_MIN_PX, clientHeight * OLDER_HISTORY_PREFETCH_VIEWPORT_RATIO);
};

export const shouldPrefetchOlderHistory = (input: {
    readonly scrollTop: number;
    readonly clientHeight: number;
}): boolean => {
    return isNearTop(input.scrollTop, getOlderHistoryPrefetchThreshold(input.clientHeight));
};

export const shouldStartOlderHistoryPrefetch = (input: {
    readonly historyVersion: string;
    readonly attemptedVersion: string | null;
    readonly requestPending: boolean;
    readonly isLoadingOlder: boolean;
    readonly isWithinRange: boolean;
}): boolean => {
    return input.isWithinRange
        && !input.requestPending
        && !input.isLoadingOlder
        && input.attemptedVersion !== input.historyVersion;
};

export const isNearBottom = (distanceFromBottom: number, threshold: number): boolean => {
    return distanceFromBottom <= threshold;
};

export const shouldCompensateVirtualItemResize = (input: {
    isScrolling: boolean;
    scrollInteractionActive: boolean;
    processFoldTransitionActive: boolean;
    isAtEnd: boolean;
    itemIndex: number;
    firstVisibleIndex: number | undefined;
}): boolean => {
    if (
        input.isScrolling
        || input.scrollInteractionActive
        || input.processFoldTransitionActive
        || input.isAtEnd
    ) {
        return false;
    }

    return input.firstVisibleIndex !== undefined && input.itemIndex < input.firstVisibleIndex;
};

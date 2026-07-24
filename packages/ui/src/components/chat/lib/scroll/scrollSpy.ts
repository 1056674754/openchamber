export type OffsetTurn = {
    id: string;
    top: number;
    bottom?: number;
};

type ScrollSpyInput = {
    onActive: (id: string, visibleIds: string[]) => void;
    raf?: (cb: FrameRequestCallback) => number;
    caf?: (id: number) => void;
    ResizeObserver?: typeof globalThis.ResizeObserver;
    MutationObserver?: typeof globalThis.MutationObserver;
};

export const pickOffsetTurnId = (list: OffsetTurn[], cutoff: number): string | undefined => {
    if (list.length === 0) {
        return undefined;
    }

    let lo = 0;
    let hi = list.length - 1;
    let out = 0;

    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const top = list[mid]?.top;
        if (top === undefined) {
            break;
        }

        if (top <= cutoff) {
            out = mid;
            lo = mid + 1;
            continue;
        }

        hi = mid - 1;
    }

    return list[out]?.id;
};

const READ_LINE_OFFSET_PX = 100;
const BOTTOM_ANCHOR_EPSILON_PX = 8;

export const pickActiveTurnId = (
    offsets: OffsetTurn[],
    viewport: { scrollTop: number; scrollHeight: number; clientHeight: number },
): string | undefined => {
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom <= BOTTOM_ANCHOR_EPSILON_PX) {
        return offsets[offsets.length - 1]?.id;
    }

    return pickOffsetTurnId(offsets, viewport.scrollTop + READ_LINE_OFFSET_PX);
};

export const pickVisibleTurnIds = (
    offsets: OffsetTurn[],
    viewport: { scrollTop: number; scrollHeight: number; clientHeight: number },
): string[] => {
    const viewportTop = viewport.scrollTop;
    const viewportBottom = viewport.scrollTop + viewport.clientHeight;
    const visible = offsets.filter((turn, index) => {
        const nextTop = offsets[index + 1]?.top;
        const turnBottom = turn.bottom ?? nextTop ?? viewport.scrollHeight;
        return turnBottom > viewportTop && turn.top < viewportBottom;
    }).map((turn) => turn.id);

    if (visible.length > 0) {
        return visible;
    }

    const active = pickActiveTurnId(offsets, viewport);
    return active ? [active] : [];
};

export const createScrollSpy = (input: ScrollSpyInput) => {
    const raf = input.raf ?? requestAnimationFrame;
    const caf = input.caf ?? cancelAnimationFrame;
    const CtorRO = input.ResizeObserver ?? globalThis.ResizeObserver;
    const CtorMO = input.MutationObserver ?? globalThis.MutationObserver;

    let root: HTMLDivElement | undefined;
    let ro: ResizeObserver | undefined;
    let mo: MutationObserver | undefined;
    let frame: number | undefined;
    let roDebounce: ReturnType<typeof setTimeout> | undefined;
    let active: string | undefined;
    let visibleIds: string[] = [];
    let dirty = true;

    const nodes = new Map<string, HTMLElement>();
    let offsets: OffsetTurn[] = [];

    const schedule = () => {
        if (frame !== undefined) {
            return;
        }
        frame = raf(() => {
            frame = undefined;
            update();
        });
    };

    const refreshOffsets = () => {
        const container = root;
        if (!container) {
            offsets = [];
            dirty = false;
            return;
        }

        const baseTop = container.getBoundingClientRect().top;
        offsets = [...nodes].map(([key, element]) => {
            const rect = element.getBoundingClientRect();
            return {
                id: key,
                top: rect.top - baseTop + container.scrollTop,
                bottom: rect.bottom - baseTop + container.scrollTop,
            };
        });
        offsets.sort((a, b) => a.top - b.top);
        dirty = false;
    };

    const update = () => {
        const container = root;
        if (!container) {
            return;
        }

        if (dirty) {
            refreshOffsets();
        }

        const next = pickActiveTurnId(offsets, container);
        const nextVisibleIds = pickVisibleTurnIds(offsets, container);

        if (!next) {
            return;
        }

        const visibleUnchanged = nextVisibleIds.length === visibleIds.length
            && nextVisibleIds.every((id, index) => id === visibleIds[index]);
        if (next === active && visibleUnchanged) {
            return;
        }

        active = next;
        visibleIds = nextVisibleIds;
        input.onActive(next, nextVisibleIds);
    };

    const observe = () => {
        const container = root;
        if (!container) {
            return;
        }

        clearTimeout(roDebounce);
        roDebounce = undefined;
        ro?.disconnect();
        ro = undefined;
        if (CtorRO) {
            ro = new CtorRO(() => {
                clearTimeout(roDebounce);
                roDebounce = setTimeout(() => {
                    dirty = true;
                    schedule();
                }, 100);
            });
            ro.observe(container);
            for (const element of nodes.values()) {
                ro.observe(element);
            }
        }

        mo?.disconnect();
        mo = undefined;
        if (CtorMO) {
            mo = new CtorMO(() => {
                dirty = true;
                schedule();
            });
            const moConfig: MutationObserverInit = {
                subtree: true,
                childList: true,
            };
            if (!CtorRO) {
                moConfig.characterData = true;
                moConfig.characterDataOldValue = false;
            }
            mo.observe(container, moConfig);
        }

        dirty = true;
        schedule();
    };

    const setContainer = (element?: HTMLDivElement) => {
        if (root === element) {
            return;
        }

        root = element;
        active = undefined;
        observe();
    };

    const register = (element: HTMLElement, key: string) => {
        const previous = nodes.get(key);
        if (previous && previous !== element) {
            ro?.unobserve(previous);
        }

        nodes.set(key, element);
        if (ro) {
            ro.observe(element);
        }
        dirty = true;
        schedule();
    };

    const unregister = (key: string) => {
        const element = nodes.get(key);
        if (!element) {
            return;
        }

        ro?.unobserve(element);
        nodes.delete(key);
        dirty = true;
        schedule();
    };

    const markDirty = () => {
        dirty = true;
        schedule();
    };

    const clear = () => {
        for (const element of nodes.values()) {
            ro?.unobserve(element);
        }

        nodes.clear();
        offsets = [];
        active = undefined;
        visibleIds = [];
        dirty = true;
    };

    const destroy = () => {
        if (frame !== undefined) {
            caf(frame);
        }
        frame = undefined;
        clearTimeout(roDebounce);
        roDebounce = undefined;
        clear();
        ro?.disconnect();
        mo?.disconnect();
        ro = undefined;
        mo = undefined;
        root = undefined;
    };

    return {
        setContainer,
        register,
        unregister,
        onScroll: schedule,
        markDirty,
        clear,
        destroy,
        getActiveId: () => active,
        getVisibleIds: () => visibleIds,
    };
};

export const PROCESS_FOLD_TRANSITION_CLASS = 'openchamber-process-fold-transition';

export interface ProcessFoldViewportAnchor {
    container: HTMLElement;
    element: HTMLElement;
    viewportTop: number;
}

let activeTransitionCount = 0;
let transitionClassRemovalTimer: ReturnType<typeof setTimeout> | null = null;

export const beginProcessFoldTransition = (): (() => void) => {
    if (typeof document === 'undefined') {
        return () => undefined;
    }

    if (transitionClassRemovalTimer !== null) {
        clearTimeout(transitionClassRemovalTimer);
        transitionClassRemovalTimer = null;
    }
    activeTransitionCount += 1;
    document.documentElement.classList.add(PROCESS_FOLD_TRANSITION_CLASS);

    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        activeTransitionCount = Math.max(0, activeTransitionCount - 1);
        if (activeTransitionCount === 0) {
            transitionClassRemovalTimer = setTimeout(() => {
                transitionClassRemovalTimer = null;
                if (activeTransitionCount === 0) {
                    document.documentElement.classList.remove(PROCESS_FOLD_TRANSITION_CLASS);
                }
            }, 100);
        }
    };
};

export const isProcessFoldTransitionActive = (): boolean => (
    typeof document !== 'undefined'
    && document.documentElement.classList.contains(PROCESS_FOLD_TRANSITION_CLASS)
);

export const captureProcessFoldViewportAnchor = (
    container: HTMLElement,
    element: HTMLElement,
): ProcessFoldViewportAnchor => ({
    container,
    element,
    viewportTop: element.getBoundingClientRect().top,
});

export const restoreProcessFoldViewportAnchor = (
    anchor: ProcessFoldViewportAnchor,
): boolean => {
    if (!anchor.element.isConnected || !anchor.container.isConnected) {
        return false;
    }

    const delta = anchor.element.getBoundingClientRect().top - anchor.viewportTop;
    if (Math.abs(delta) >= 0.5) {
        anchor.container.scrollTop += delta;
    }
    return true;
};

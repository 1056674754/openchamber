import React from 'react';

import { isProcessFoldTransitionActive } from '@/components/chat/lib/scroll/processFoldViewport';

import { MessageFreshnessDetector } from '@/lib/messageFreshness';
import { createScrollSpy } from '@/components/chat/lib/scroll/scrollSpy';
import {
    isMatchingAutoScrollPosition,
    normalizeWheelDelta,
    shouldApplyPassiveAutoFollow,
    shouldPinFollowedViewportOnWorkingChange,
    shouldPauseAutoScrollOnWheel,
} from '@/components/chat/lib/scroll/scrollIntent';
import { useViewportStore, type SessionMemoryState } from '@/sync/viewport-store';
import { CHAT_BOTTOM_ZONE_DESKTOP_PX, CHAT_BOTTOM_ZONE_MOBILE_PX } from '@/components/chat/lib/scroll/bottomSpacing';
import { getAnchoredTurnOverflow, resolveAnchoredScrollTop } from '@/components/chat/lib/scroll/anchoredTurn';
import { CHAT_BOTTOM_ZONE_DESKTOP_PX as SPACER_DESKTOP, CHAT_BOTTOM_ZONE_MOBILE_PX as SPACER_MOBILE } from '@/components/chat/lib/scroll/bottomSpacing';

export type AutoFollowState = 'following' | 'released';

export type ContentChangeReason = 'text' | 'structural' | 'permission';

export interface AnimationHandlers {
    onChunk: () => void;
    onComplete: () => void;
    onStreamingCandidate?: () => void;
    onAnimationStart?: () => void;
    onReservationCancelled?: () => void;
    onReasoningBlock?: () => void;
    onAnimatedHeightChange?: (height: number) => void;
}

interface UseChatAutoFollowOptions {
    currentSessionId: string | null;
    sessionMessageCount: number;
    sessionIsWorking: boolean;
    isMobile: boolean;
    /** Off: streaming growth never moves the viewport; only explicit user
     *  scroll actions (pill, drag) move it, and they do not re-arm following. */
    streamingAutoFollow?: boolean;
    onActiveTurnChange?: (turnId: string | null, visibleTurnIds: string[]) => void;
}

export interface UseChatAutoFollowResult {
    scrollRef: React.RefObject<HTMLDivElement | null>;
    state: AutoFollowState;
    isPinned: boolean;
    isOverflowing: boolean;
    isFollowingProgrammatically: boolean;
    showScrollButton: boolean;
    notifyContentChange: (reason?: ContentChangeReason) => void;
    notifyViewportStabilize: () => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    goToBottom: (mode?: 'instant' | 'smooth') => void;
    releaseAutoFollow: () => void;
    saveSnapshotNow: () => void;
    restoreSnapshot: () => Promise<boolean>;
}

const SAVE_DEBOUNCE_MS = 150;
const TOUCH_RELEASE_THRESHOLD_PX = 2;
const WHEEL_RELEASE_THRESHOLD_PX = 2;
const AUTO_MARK_TTL_MS = 1500;
const AUTO_MATCH_TOLERANCE_PX = 2;
const PASSIVE_FOLLOW_SETTLE_MS = 300;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Keep this aligned with the small visual gutter rendered below the live
// assistant status row, so "near bottom" matches what the user sees.
const computeBottomZoneThreshold = (isMobile: boolean): number => {
    return isMobile ? CHAT_BOTTOM_ZONE_MOBILE_PX : CHAT_BOTTOM_ZONE_DESKTOP_PX;
};

const distanceFromBottom = (el: HTMLElement): number => {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
};

const canScroll = (el: HTMLElement): boolean => {
    return el.scrollHeight - el.clientHeight > 1;
};

const isNearBottom = (el: HTMLElement, isMobile: boolean): boolean => {
    return distanceFromBottom(el) <= computeBottomZoneThreshold(isMobile);
};

const isReleaseKey = (event: KeyboardEvent): boolean => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
        return false;
    }
    switch (event.key) {
        case 'ArrowUp':
        case 'PageUp':
        case 'Home':
            return true;
        default:
            return false;
    }
};

const isAtBottomSnapshot = (snapshot: NonNullable<SessionMemoryState['scrollPosition']>, isMobile: boolean): boolean => {
    const max = Math.max(0, snapshot.scrollHeight - snapshot.clientHeight);
    if (max <= 0) return true;
    const threshold = computeBottomZoneThreshold(isMobile);
    return max - snapshot.scrollTop <= threshold;
};

export const useChatAutoFollow = ({
    currentSessionId,
    sessionMessageCount,
    sessionIsWorking,
    isMobile,
    streamingAutoFollow = true,
    onActiveTurnChange,
}: UseChatAutoFollowOptions): UseChatAutoFollowResult => {
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const [containerEl, setContainerEl] = React.useState<HTMLDivElement | null>(null);
    const lastSeenContainerRef = React.useRef<HTMLDivElement | null>(null);

    const [state, setState] = React.useState<AutoFollowState>('following');
    const [isOverflowing, setIsOverflowing] = React.useState(false);
    const [showScrollButton, setShowScrollButton] = React.useState(false);
    const [isFollowingProgrammatically, setIsFollowingProgrammatically] = React.useState(false);

    const stateRef = React.useRef<AutoFollowState>('following');
    const isMobileRef = React.useRef(isMobile);
    isMobileRef.current = isMobile;
    const sessionIsWorkingRef = React.useRef(sessionIsWorking);
    sessionIsWorkingRef.current = sessionIsWorking;
    const streamingAutoFollowRef = React.useRef(streamingAutoFollow);
    streamingAutoFollowRef.current = streamingAutoFollow;
    // Anchored-new-turn: while set and working, the viewport stays parked at
    // the sent message until the turn outgrows the usable viewport, after
    // which following the end takes over. Cleared on release, explicit jump,
    // working end, and session change.
    const anchoredTurnActiveRef = React.useRef(false);
    const anchorRafRef = React.useRef<number | null>(null);
    const previousWorkingStateRef = React.useRef({
        sessionId: currentSessionId,
        isWorking: sessionIsWorking,
    });
    const settlingRef = React.useRef(false);
    const settleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionMessageCountRef = React.useRef(sessionMessageCount);
    sessionMessageCountRef.current = sessionMessageCount;
    const currentSessionIdRef = React.useRef(currentSessionId);
    currentSessionIdRef.current = currentSessionId;

    const lastSessionIdRef = React.useRef<string | null>(null);
    const autoRef = React.useRef<{ top: number; time: number } | null>(null);
    const autoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSaveRef = React.useRef<{ sessionId: string; anchor: number; metrics: { scrollTop: number; scrollHeight: number; clientHeight: number } } | null>(null);
    // When restoreSnapshot is invoked while ChatViewport is still hydrating
    // (skeleton rendered, no scroll container yet), we record the session here
    // so a follow-up effect can replay the restore once the container mounts.
    const pendingInitialRestoreRef = React.useRef<string | null>(null);

    const updateViewportAnchor = useViewportStore((s) => s.updateViewportAnchor);

    // Detect when the scroll container DOM element changes (mount, unmount, remount).
    // Without this, listener-attach effects would only ever bind to the element that
    // existed at the hook's first render, missing later mounts (e.g. after first send
    // promotes a draft session to a real chat with messages).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useLayoutEffect(() => {
        if (scrollRef.current !== lastSeenContainerRef.current) {
            lastSeenContainerRef.current = scrollRef.current;
            setContainerEl(scrollRef.current);
        }
    });

    const setStateValue = React.useCallback((next: AutoFollowState) => {
        if (stateRef.current === next) return;
        stateRef.current = next;
        setState(next);
    }, []);

    const clearAutoMarker = React.useCallback(() => {
        autoRef.current = null;
        if (autoTimerRef.current !== null) {
            clearTimeout(autoTimerRef.current);
            autoTimerRef.current = null;
        }
    }, []);

    const markAuto = React.useCallback((target: number) => {
        autoRef.current = { top: target, time: now() };
        if (autoTimerRef.current !== null) {
            clearTimeout(autoTimerRef.current);
        }
        autoTimerRef.current = setTimeout(() => {
            autoRef.current = null;
            autoTimerRef.current = null;
        }, AUTO_MARK_TTL_MS);
    }, []);

    const isAuto = React.useCallback((container: HTMLElement): boolean => {
        const marker = autoRef.current;
        if (!marker) return false;
        const currentTime = now();
        if (currentTime - marker.time > AUTO_MARK_TTL_MS) {
            clearAutoMarker();
            return false;
        }
        return isMatchingAutoScrollPosition({
            currentTop: container.scrollTop,
            markedTop: marker.top,
            markedAt: marker.time,
            currentTime,
            ttl: AUTO_MARK_TTL_MS,
            tolerance: AUTO_MATCH_TOLERANCE_PX,
        });
    }, [clearAutoMarker]);

    const isPassiveFollowActive = React.useCallback((): boolean => {
        // With auto-follow off, streaming growth never moves the viewport.
        if (!streamingAutoFollowRef.current) return false;
        return shouldApplyPassiveAutoFollow({
            state: stateRef.current,
            sessionIsWorking: sessionIsWorkingRef.current,
            settling: settlingRef.current,
            processFoldTransitionActive: isProcessFoldTransitionActive(),
        });
    }, []);

    const writeScrollTopInstant = React.useCallback((target: number) => {
        const container = scrollRef.current;
        if (!container) return;
        const max = Math.max(0, container.scrollHeight - container.clientHeight);
        // When pinning to the bottom, overshoot so the browser clamps to the
        // exact fractional maximum. Integer `scrollHeight` otherwise leaves a
        // 0–1px remainder that jitters bottom-anchored rows during streaming.
        if (target >= max - AUTO_MATCH_TOLERANCE_PX) {
            container.scrollTop = container.scrollHeight + 4096;
            markAuto(container.scrollTop);
            return;
        }
        const clamped = Math.max(0, Math.min(target, max));
        markAuto(clamped);
        container.scrollTop = clamped;
    }, [markAuto]);

    // The composer stack sits below the scroll container (not overlaying),
    // so the content end correction here is only the trailing bottom spacer;
    // the ZONE constants add the status gutter that also lives inside it.
    const trailingSpacerHeight = (): number =>
        (isMobileRef.current ? SPACER_MOBILE : SPACER_DESKTOP);

    /** The last turn row in the container, with its top relative to content. */
    const measureLastTurnRow = (container: HTMLDivElement): { anchorTop: number } | null => {
        const rows = container.querySelectorAll<HTMLElement>('[data-turn-entry]');
        const anchorEl = rows[rows.length - 1];
        if (!anchorEl) return null;
        const anchorTop =
            anchorEl.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        return { anchorTop };
    };

    // Anchored-new-turn: park the just-sent user turn near the top of the
    // viewport so the reply streams into the space below it. Returns false
    // when there is nothing measurable (caller falls back to pinning).
    const beginAnchoredTurn = React.useCallback((): boolean => {
        const container = scrollRef.current;
        if (!container) return false;
        const measurement = measureLastTurnRow(container);
        if (!measurement) return false;
        writeScrollTopInstant(resolveAnchoredScrollTop(measurement.anchorTop));
        anchoredTurnActiveRef.current = true;
        return true;
    }, [measureLastTurnRow, writeScrollTopInstant]);

    const stickToBottomIfFollowing = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container || stateRef.current !== 'following') {
            return;
        }
        if (isProcessFoldTransitionActive()) {
            return;
        }

        // Anchored-new-turn: while the turn (sent message + growing reply)
        // still fits the usable viewport, the viewport stays parked and the
        // content grows into the space below. Once it overflows, following
        // the end takes over permanently for the rest of the turn.
        if (anchoredTurnActiveRef.current) {
            if (!sessionIsWorkingRef.current) {
                anchoredTurnActiveRef.current = false;
            } else {
                const measurement = measureLastTurnRow(container);
                if (measurement) {
                    const overflow = getAnchoredTurnOverflow({
                        anchorTop: measurement.anchorTop,
                        contentEnd: container.scrollHeight - trailingSpacerHeight(),
                        scrollLength: container.clientHeight,
                        scroll: container.scrollTop,
                    });
                    if (!overflow.overflows) {
                        return;
                    }
                }
                anchoredTurnActiveRef.current = false;
            }
        }

        // Always re-pin, even within tolerance, so sub-pixel growth during
        // streaming does not leave bottom-anchored rows drifting.
        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        writeScrollTopInstant(target);
    }, [writeScrollTopInstant]);

    const releaseAutoFollow = React.useCallback(() => {
        setStateValue('released');
    }, [setStateValue]);

    const releaseFromUserIntent = React.useCallback(() => {
        anchoredTurnActiveRef.current = false;
        if (stateRef.current === 'following') {
            setStateValue('released');
        }
    }, [setStateValue]);

    const goToBottom = React.useCallback((mode: 'instant' | 'smooth' = 'instant') => {
        const container = scrollRef.current;
        // An explicit jump is honored with auto-follow off too — it scrolls to
        // the end once but does not re-arm live following.
        anchoredTurnActiveRef.current = false;
        if (streamingAutoFollowRef.current) {
            setStateValue('following');
        }
        settlingRef.current = true;
        if (settleTimerRef.current !== null) {
            clearTimeout(settleTimerRef.current);
        }
        settleTimerRef.current = setTimeout(() => {
            settlingRef.current = false;
            settleTimerRef.current = null;
        }, PASSIVE_FOLLOW_SETTLE_MS);
        if (!container) return;
        if (mode === 'smooth') {
            const target = Math.max(0, container.scrollHeight - container.clientHeight);
            markAuto(target);
            container.scrollTo({ top: target, behavior: 'smooth' });
            return;
        }
        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        writeScrollTopInstant(target);
    }, [markAuto, setStateValue, writeScrollTopInstant]);

    const notifyViewportStabilize = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;
        const distFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
        // Re-pin if actively following OR if near bottom (content grew during loading)
        if (!streamingAutoFollowRef.current && stateRef.current !== 'following') return;
        if (stateRef.current !== 'following' && distFromBottom > 2000) return;
        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        writeScrollTopInstant(target);
    }, [writeScrollTopInstant]);

    const flushSave = React.useCallback(() => {
        if (saveTimerRef.current !== null) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const pending = pendingSaveRef.current;
        if (!pending) return;
        pendingSaveRef.current = null;
        // A switch re-pointed scrollRef at the new container before this
        // debounced flush ran: the captured metrics describe the old session,
        // but reading the container now would capture the NEW one's pixels.
        // Keep the captured values; just attribute them correctly.
        if (pending.sessionId !== currentSessionIdRef.current) {
            updateViewportAnchor(pending.sessionId, pending.anchor, pending.metrics);
            return;
        }
        const container = scrollRef.current;
        if (!container) return;
        updateViewportAnchor(pending.sessionId, pending.anchor, {
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
        });
    }, [updateViewportAnchor]);

    const queueSave = React.useCallback(() => {
        const sessionId = currentSessionIdRef.current;
        if (!sessionId) return;
        const container = scrollRef.current;
        if (!container) return;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const anchorRatio = scrollHeight > 0
            ? (scrollTop + clientHeight / 2) / scrollHeight
            : 0;
        const anchor = Math.floor(anchorRatio * sessionMessageCountRef.current);

        // Snapshot the metrics NOW: the debounced flush can land after a
        // session switch re-pointed scrollRef at the new container, and
        // reading it there would write the new session's pixels under the
        // old session's key.
        pendingSaveRef.current = { sessionId, anchor, metrics: { scrollTop, scrollHeight, clientHeight } };
        if (saveTimerRef.current !== null) return;
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            flushSave();
        }, SAVE_DEBOUNCE_MS);
    }, [flushSave]);

    const saveSnapshotNow = React.useCallback(() => {
        flushSave();
    }, [flushSave]);

    const restoreSnapshot = React.useCallback(async (): Promise<boolean> => {
        const sessionId = currentSessionIdRef.current;
        if (!sessionId) return false;

        const container = scrollRef.current;
        if (!container) {
            // ChatViewport not mounted yet (e.g., session still hydrating).
            // Record the request so the container-attach effect can replay it.
            pendingInitialRestoreRef.current = sessionId;
            setStateValue('following');
            return false;
        }
        pendingInitialRestoreRef.current = null;

        const saved = useViewportStore.getState().sessionMemoryState.get(sessionId)?.scrollPosition;

        if (!saved || isAtBottomSnapshot(saved, isMobile)) {
            setStateValue('following');
            const target = Math.max(0, container.scrollHeight - container.clientHeight);
            writeScrollTopInstant(target);
            return false;
        }

        const savedMaxScroll = Math.max(0, saved.scrollHeight - saved.clientHeight);
        const ratio = savedMaxScroll > 0 ? saved.scrollTop / savedMaxScroll : 0;
        const currentMaxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        const targetTop = Math.round(ratio * currentMaxScroll);

        setStateValue('released');
        writeScrollTopInstant(targetTop);

        const memState = useViewportStore.getState().sessionMemoryState.get(sessionId);
        updateViewportAnchor(sessionId, memState?.viewportAnchor ?? 0, {
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
        });

        return true;
    }, [isMobile, setStateValue, updateViewportAnchor, writeScrollTopInstant]);

    React.useEffect(() => {
        if (!currentSessionId || currentSessionId === lastSessionIdRef.current) {
            return;
        }
        lastSessionIdRef.current = currentSessionId;
        MessageFreshnessDetector.getInstance().recordSessionStart(currentSessionId);
        flushSave();
        clearAutoMarker();
        // Drop any pending restore request inherited from a different session.
        if (pendingInitialRestoreRef.current && pendingInitialRestoreRef.current !== currentSessionId) {
            pendingInitialRestoreRef.current = null;
        }
    }, [clearAutoMarker, currentSessionId, flushSave]);

    React.useLayoutEffect(() => {
        const previousWorkingState = previousWorkingStateRef.current;
        previousWorkingStateRef.current = {
            sessionId: currentSessionId,
            isWorking: sessionIsWorking,
        };

        settlingRef.current = false;
        // A turn that was anchored keeps the parked viewport through its end:
        // the user is reading at the anchor, and snapping to the bottom would
        // yank them away from it.
        const wasAnchoredTurn = anchoredTurnActiveRef.current;
        anchoredTurnActiveRef.current = false;
        if (settleTimerRef.current !== null) {
            clearTimeout(settleTimerRef.current);
            settleTimerRef.current = null;
        }

        if (sessionIsWorking) {
            if (streamingAutoFollowRef.current && stateRef.current === 'following' && !isProcessFoldTransitionActive()) {
                // Anchor the just-sent turn once its row has rendered; fall
                // back to pinning when there is nothing measurable yet. The
                // rAF chain is session-scoped and cancellable: a switch that
                // lands inside the two frames must not anchor the new
                // session's container for the old one's send.
                const scheduledSessionId = currentSessionId;
                const first = requestAnimationFrame(() => {
                    const second = requestAnimationFrame(() => {
                        if (
                            !anchoredTurnActiveRef.current
                            && stateRef.current === 'following'
                            && sessionIsWorkingRef.current
                            && currentSessionIdRef.current === scheduledSessionId
                        ) {
                            if (!beginAnchoredTurn()) {
                                stickToBottomIfFollowing();
                            }
                        }
                    });
                    anchorRafRef.current = second;
                });
                anchorRafRef.current = first;
            }
            return;
        }

        settlingRef.current = true;
        if (!wasAnchoredTurn && streamingAutoFollowRef.current && shouldPinFollowedViewportOnWorkingChange({
            state: stateRef.current,
            sameSession: previousWorkingState.sessionId === currentSessionId,
            wasWorking: previousWorkingState.isWorking,
            sessionIsWorking,
        }) && !isProcessFoldTransitionActive()) {
            stickToBottomIfFollowing();
        }
        settleTimerRef.current = setTimeout(() => {
            settlingRef.current = false;
            settleTimerRef.current = null;
        }, PASSIVE_FOLLOW_SETTLE_MS);
    }, [beginAnchoredTurn, currentSessionId, sessionIsWorking, stickToBottomIfFollowing]);

    React.useEffect(() => {
        return () => {
            if (anchorRafRef.current !== null) {
                cancelAnimationFrame(anchorRafRef.current);
                anchorRafRef.current = null;
            }
        };
    }, []);

    React.useEffect(() => {
        setIsFollowingProgrammatically(state === 'following' && sessionIsWorking);
    }, [sessionIsWorking, state]);

    // Replay a deferred restoreSnapshot once ChatViewport mounts.
    React.useLayoutEffect(() => {
        if (!containerEl) return;
        if (pendingInitialRestoreRef.current && pendingInitialRestoreRef.current === currentSessionId) {
            void restoreSnapshot();
        }
    }, [containerEl, currentSessionId, restoreSnapshot]);

    const updateOverflowAndButton = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container) {
            setIsOverflowing(false);
            setShowScrollButton(false);
            return;
        }
        const overflowing = container.scrollHeight > container.clientHeight + 1;
        setIsOverflowing(overflowing);
        if (!overflowing) {
            setShowScrollButton(false);
            return;
        }
        const showButton = stateRef.current === 'released' && !isNearBottom(container, isMobile);
        setShowScrollButton(showButton);
    }, [isMobile]);

    const handleScrollEvent = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;

        updateOverflowAndButton();

        if (!canScroll(container)) {
            setStateValue('following');
            return;
        }

        if (stateRef.current === 'following' && settlingRef.current) {
            stickToBottomIfFollowing();
            queueSave();
            return;
        }

        if (isNearBottom(container, isMobileRef.current)) {
            // With auto-follow off, being at the bottom does not re-arm
            // following — streaming growth still leaves the view alone.
            if (streamingAutoFollowRef.current) {
                setStateValue('following');
            }
            queueSave();
            return;
        }

        if (stateRef.current === 'following' && !isAuto(container)) {
            releaseFromUserIntent();
        }

        queueSave();
    }, [
        isAuto,
        queueSave,
        releaseFromUserIntent,
        setStateValue,
        stickToBottomIfFollowing,
        updateOverflowAndButton,
    ]);

    React.useEffect(() => {
        const container = containerEl;
        if (!container) return;

        const handleWheel = (event: WheelEvent) => {
            const delta = normalizeWheelDelta({
                deltaY: event.deltaY,
                deltaMode: event.deltaMode,
                rootHeight: container.clientHeight,
            });
            if (Math.abs(delta) < WHEEL_RELEASE_THRESHOLD_PX) return;
            if (!shouldPauseAutoScrollOnWheel({ root: container, target: event.target, delta })) return;
            releaseFromUserIntent();
        };

        let touchLastY: number | null = null;
        const handleTouchStart = (event: TouchEvent) => {
            const touch = event.touches.item(0);
            touchLastY = touch ? touch.clientY : null;
        };
        const handleTouchMove = (event: TouchEvent) => {
            const touch = event.touches.item(0);
            if (!touch) {
                touchLastY = null;
                return;
            }
            const previousY = touchLastY;
            touchLastY = touch.clientY;
            if (previousY === null) return;
            const scrollDelta = previousY - touch.clientY;
            if (Math.abs(scrollDelta) <= TOUCH_RELEASE_THRESHOLD_PX) return;
            if (!shouldPauseAutoScrollOnWheel({ root: container, target: event.target, delta: scrollDelta })) return;
            releaseFromUserIntent();
        };
        const handleTouchEnd = () => {
            touchLastY = null;
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isReleaseKey(event)) return;
            releaseFromUserIntent();
        };

        const handlePointerDownIntent = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (!target.closest('[data-overlay-scrollbar-thumb]')) return;
            releaseFromUserIntent();
        };

        container.addEventListener('scroll', handleScrollEvent, { passive: true });
        container.addEventListener('wheel', handleWheel, { passive: true });
        container.addEventListener('touchstart', handleTouchStart, { passive: true });
        container.addEventListener('touchmove', handleTouchMove, { passive: true });
        container.addEventListener('touchend', handleTouchEnd, { passive: true });
        container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
        container.addEventListener('keydown', handleKeyDown);
        if (typeof window !== 'undefined') {
            window.addEventListener('pointerdown', handlePointerDownIntent, true);
        }

        return () => {
            container.removeEventListener('scroll', handleScrollEvent);
            container.removeEventListener('wheel', handleWheel);
            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            container.removeEventListener('touchend', handleTouchEnd);
            container.removeEventListener('touchcancel', handleTouchEnd);
            container.removeEventListener('keydown', handleKeyDown);
            if (typeof window !== 'undefined') {
                window.removeEventListener('pointerdown', handlePointerDownIntent, true);
            }
        };
    }, [containerEl, handleScrollEvent, releaseFromUserIntent]);

    React.useEffect(() => {
        const container = containerEl;
        if (!container || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            updateOverflowAndButton();
            if (isPassiveFollowActive()) {
                stickToBottomIfFollowing();
            }
        });
        observer.observe(container);
        const inner = container.firstElementChild;
        if (inner instanceof Element) {
            observer.observe(inner);
        }
        return () => observer.disconnect();
    }, [containerEl, isPassiveFollowActive, stickToBottomIfFollowing, updateOverflowAndButton]);

    React.useEffect(() => {
        updateOverflowAndButton();
    }, [sessionMessageCount, updateOverflowAndButton]);

    const notifyContentChange = React.useCallback((_reason?: ContentChangeReason) => {
        void _reason;
        updateOverflowAndButton();
    }, [updateOverflowAndButton]);

    const animationHandlersRef = React.useRef<Map<string, AnimationHandlers>>(new Map());

    const getAnimationHandlers = React.useCallback((messageId: string): AnimationHandlers => {
        const cached = animationHandlersRef.current.get(messageId);
        if (cached) return cached;

        const handlers: AnimationHandlers = {
            onChunk: () => {},
            onComplete: () => {
                updateOverflowAndButton();
            },
            onStreamingCandidate: () => {},
            onAnimationStart: () => {},
            onAnimatedHeightChange: () => {},
            onReservationCancelled: () => {},
            onReasoningBlock: () => {},
        };
        animationHandlersRef.current.set(messageId, handlers);
        return handlers;
    }, [updateOverflowAndButton]);

    React.useEffect(() => {
        return () => {
            clearAutoMarker();
            flushSave();
            if (saveTimerRef.current !== null) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            if (settleTimerRef.current !== null) {
                clearTimeout(settleTimerRef.current);
                settleTimerRef.current = null;
            }
        };
    }, [clearAutoMarker, flushSave]);

    React.useEffect(() => {
        if (!onActiveTurnChange) return;
        const container = containerEl;
        if (!container) return;

        let lastActiveTurnId: string | null = null;
        let lastVisibleTurnIds: string[] = [];
        const spy = createScrollSpy({
            onActive: (turnId, visibleTurnIds) => {
                const visibleUnchanged = visibleTurnIds.length === lastVisibleTurnIds.length
                    && visibleTurnIds.every((id, index) => id === lastVisibleTurnIds[index]);
                if (turnId === lastActiveTurnId && visibleUnchanged) return;
                lastActiveTurnId = turnId;
                lastVisibleTurnIds = visibleTurnIds;
                onActiveTurnChange(turnId, visibleTurnIds);
            },
        });
        spy.setContainer(container);

        const elementByTurnId = new Map<string, HTMLElement>();
        const registerTurnNode = (node: HTMLElement) => {
            const turnId = node.dataset.turnId;
            if (!turnId) return false;
            elementByTurnId.set(turnId, node);
            spy.register(node, turnId);
            return true;
        };
        const unregisterTurnNode = (node: HTMLElement) => {
            const turnId = node.dataset.turnId;
            if (!turnId) return false;
            if (elementByTurnId.get(turnId) !== node) return false;
            elementByTurnId.delete(turnId);
            spy.unregister(turnId);
            return true;
        };
        const collectTurnNodes = (node: Node): HTMLElement[] => {
            if (!(node instanceof HTMLElement)) return [];
            const collected: HTMLElement[] = [];
            if (node.matches('[data-turn-id]')) collected.push(node);
            node.querySelectorAll<HTMLElement>('[data-turn-id]').forEach((el) => collected.push(el));
            return collected;
        };

        container.querySelectorAll<HTMLElement>('[data-turn-id]').forEach(registerTurnNode);
        spy.markDirty();

        const mutationObserver = new MutationObserver((records) => {
            let changed = false;
            records.forEach((record) => {
                record.removedNodes.forEach((node) => {
                    collectTurnNodes(node).forEach((turnNode) => {
                        if (unregisterTurnNode(turnNode)) changed = true;
                    });
                });
                record.addedNodes.forEach((node) => {
                    collectTurnNodes(node).forEach((turnNode) => {
                        if (registerTurnNode(turnNode)) changed = true;
                    });
                });
            });
            if (changed) spy.markDirty();
        });
        mutationObserver.observe(container, { subtree: true, childList: true });

        const onScroll = () => spy.onScroll();
        container.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            container.removeEventListener('scroll', onScroll);
            mutationObserver.disconnect();
            spy.destroy();
        };
    }, [containerEl, onActiveTurnChange]);

    return {
        scrollRef,
        state,
        isPinned: state === 'following',
        isOverflowing,
        isFollowingProgrammatically,
        showScrollButton,
        notifyContentChange,
        getAnimationHandlers,
        goToBottom,
        releaseAutoFollow,
        saveSnapshotNow,
        restoreSnapshot,
        notifyViewportStabilize,
    };
};

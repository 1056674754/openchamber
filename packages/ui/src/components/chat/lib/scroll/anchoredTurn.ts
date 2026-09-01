// Anchored-turn scroll geometry for the chat timeline (fork adaptation of
// upstream's pure anchoring module onto DOM measurements).
//
// When the user sends a message while following, the sent user turn parks
// near the TOP of the viewport and the reply streams into the space below
// it. The viewport stays put while the whole turn (sent message + streaming
// reply) fits in the usable viewport; once it outgrows that, following the
// end is the only way to keep the newest content readable.
//
// "Usable viewport" is the visible height minus the anchor offset. The
// trailing bottom spacer (rendered inside the scroll container) is excluded
// from the content end so the reveal target does not over-scroll into blank
// space.

export const CHAT_LIST_ANCHOR_OFFSET = 16;

export interface AnchoredTurnMeasurements {
    /** Anchor row top, relative to the scroll container's content top. */
    readonly anchorTop: number;
    /** Bottom of the real content (container scrollHeight minus trailing spacer). */
    readonly contentEnd: number;
    /** Visible height of the scroll container (clientHeight). */
    readonly scrollLength: number;
    /** Current scrollTop. */
    readonly scroll: number;
}

export interface AnchoredTurnOverflow {
    readonly turnHeight: number;
    readonly usableViewportHeight: number;
    /** The turn no longer fits — follow the end to keep the newest content readable. */
    readonly overflows: boolean;
    /** Scroll position that puts the content end just above the usable viewport bottom. */
    readonly targetScrollToRevealEnd: number;
}

export const getAnchoredTurnOverflow = (
    measurements: AnchoredTurnMeasurements,
): AnchoredTurnOverflow => {
    const usableViewportHeight = Math.max(0, measurements.scrollLength - CHAT_LIST_ANCHOR_OFFSET);
    const turnHeight = Math.max(0, measurements.contentEnd - measurements.anchorTop);
    // Revealing the end must never scroll the timeline backwards.
    const targetScrollToRevealEnd = Math.max(0, measurements.contentEnd - usableViewportHeight);
    return {
        turnHeight,
        usableViewportHeight,
        overflows: turnHeight > usableViewportHeight,
        targetScrollToRevealEnd,
    };
};

/** Scroll position that parks the anchor row near the top of the viewport. */
export const resolveAnchoredScrollTop = (anchorTop: number, anchorOffset = CHAT_LIST_ANCHOR_OFFSET): number =>
    Math.max(0, anchorTop - anchorOffset);

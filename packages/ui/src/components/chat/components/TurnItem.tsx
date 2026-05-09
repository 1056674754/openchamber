import React from 'react';

import type { ChatMessageEntry, Turn, TurnRecord } from '../lib/turns/types';

interface TurnItemProps {
    turn: Turn;
    stickyUserHeader?: boolean;
    renderMessage: (message: ChatMessageEntry) => React.ReactNode;
    directiveTurns?: TurnRecord[];
}

// [sscity-mod] Two-layer sticky architecture:
//
//   <section>  ← bounded to real user turn + all following directive turns
//     <sticky P1: real user message, top:0 z:20>
//     <div: real user's assistant messages>
//     <div: directive1 sub-scope>
//       <sticky P2: directive1 card, top:var(--oc-user-sticky-h) z:10>
//       <div: directive1's assistant messages>
//     </div>
//     <div: directive2 sub-scope>
//       <sticky P2: directive2 card>
//       <div: directive2's assistant messages>
//     </div>
//   </section>
//
// Each directive's sticky range is bounded by its own sub-scope div. As you
// scroll, the current directive sticks at P2 and gets pushed out when the next
// sub-scope enters — only one directive is visible in P2 at a time. The real
// user message in P1 stays active for the entire section.
const TurnItem: React.FC<TurnItemProps> = ({
    turn,
    stickyUserHeader = true,
    renderMessage,
    directiveTurns,
}) => {
    const sectionRef = React.useRef<HTMLElement | null>(null);
    const userRef = React.useRef<HTMLDivElement | null>(null);

    const hasDirectives = directiveTurns && directiveTurns.length > 0;

    React.useLayoutEffect(() => {
        if (!stickyUserHeader || !hasDirectives) return;
        const section = sectionRef.current;
        const userEl = userRef.current;
        if (!section || !userEl) return;

        const writeHeight = (height: number) => {
            section.style.setProperty(
                '--oc-user-sticky-h',
                `${Math.max(0, Math.ceil(height))}px`,
            );
        };

        writeHeight(userEl.offsetHeight);

        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) writeHeight(entry.contentRect.height);
        });
        observer.observe(userEl);
        return () => observer.disconnect();
    }, [stickyUserHeader, hasDirectives]);

    return (
        <section
            ref={sectionRef}
            className="relative w-full"
            id={`turn-${turn.turnId}`}
            data-turn-id={turn.turnId}
            data-scroll-spy-id={turn.turnId}
        >
            {stickyUserHeader ? (
                <div
                    ref={userRef}
                    className="sticky top-0 z-20 relative bg-[var(--surface-background)] [overflow-anchor:none]"
                >
                    <div className="relative z-10">
                        {renderMessage(turn.userMessage)}
                    </div>
                    {!hasDirectives && (
                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-0 top-full z-0 h-4 bg-gradient-to-b from-[var(--surface-background)] to-transparent sm:h-8"
                        />
                    )}
                </div>
            ) : (
                renderMessage(turn.userMessage)
            )}

            {/* Fade shadow below P1 — sits outside P1's z-20 stacking context.
                Uses z-[5] so it's above regular content (z-0) but below P2 (z-10).
                When P2 becomes sticky it naturally covers this gradient. */}
            {stickyUserHeader && hasDirectives && (
                <div
                    aria-hidden="true"
                    className="sticky z-[5] pointer-events-none h-0 [overflow-anchor:none]"
                    style={{ top: 'var(--oc-user-sticky-h, 0px)' }}
                >
                    <div className="h-4 bg-gradient-to-b from-[var(--surface-background)] to-transparent sm:h-8" />
                </div>
            )}

            <div className="relative z-0">
                {turn.assistantMessages.map((message) => renderMessage(message))}
            </div>

            {hasDirectives && directiveTurns.map((dTurn) => (
                <div key={dTurn.turnId} data-directive-turn-id={dTurn.turnId}>
                    {stickyUserHeader ? (
                        <div
                            className="sticky z-10 bg-[var(--surface-background)] [overflow-anchor:none]"
                            style={{ top: 'var(--oc-user-sticky-h, 0px)' }}
                        >
                            {renderMessage(dTurn.userMessage)}
                        </div>
                    ) : (
                        renderMessage(dTurn.userMessage)
                    )}
                    <div className="relative z-0">
                        {dTurn.assistantMessages.map((message) => renderMessage(message))}
                    </div>
                </div>
            ))}
        </section>
    );
};

export default React.memo(TurnItem);

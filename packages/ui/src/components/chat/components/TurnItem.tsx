import React from 'react';

import { Icon } from '@/components/icon/Icon';
import type { ChatMessageEntry, Turn, TurnRecord } from '../lib/turns/types';
import { useI18n } from '@/lib/i18n';

interface RenderMessageOptions {
    hideAssistantBody?: boolean;
}

interface TurnItemProps {
    turn: Turn;
    stickyUserHeader?: boolean;
    renderMessage: (message: ChatMessageEntry, options?: RenderMessageOptions) => React.ReactNode;
    directiveTurns?: TurnRecord[];
    processExpanded?: boolean;
    onToggleProcess?: () => void;
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
const getAssistantFinish = (message: ChatMessageEntry): string | undefined => {
    const finish = (message.info as unknown as { finish?: unknown }).finish;
    return typeof finish === 'string' ? finish : undefined;
};

const splitProcessMessages = (messages: ChatMessageEntry[]) => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && getAssistantFinish(lastMessage) === 'stop') {
        return {
            processMessages: messages.slice(0, -1),
            summaryMessage: lastMessage,
        };
    }

    return {
        processMessages: messages,
        summaryMessage: undefined,
    };
};

const ProcessToggle: React.FC<{
    expanded: boolean;
    onToggle: () => void;
}> = ({ expanded, onToggle }) => {
    const { t } = useI18n();

    return (
        <div className="chat-message-column">
            <button
                type="button"
                className="group/process-toggle flex items-center gap-1.5 py-1.5 pl-px pr-2 text-left text-muted-foreground/60 transition-colors hover:text-muted-foreground/80"
                aria-expanded={expanded}
                onClick={onToggle}
            >
                <span className="typography-ui-label font-semibold">
                    {t('chat.messageBody.activity.process')}
                </span>
                <Icon name={expanded ? 'arrow-up-s' : 'arrow-down-s'} className="h-3.5 w-3.5" />
            </button>
        </div>
    );
};

const TurnItem: React.FC<TurnItemProps> = ({
    turn,
    stickyUserHeader = true,
    renderMessage,
    directiveTurns,
    processExpanded = false,
    onToggleProcess,
}) => {
    const sectionRef = React.useRef<HTMLElement | null>(null);
    const userRef = React.useRef<HTMLDivElement | null>(null);

    const hasDirectives = directiveTurns && directiveTurns.length > 0;
    const renderAssistantMessages = React.useCallback((assistantMessages: ChatMessageEntry[]) => {
        const { processMessages, summaryMessage } = splitProcessMessages(assistantMessages);
        if (processMessages.length === 0) {
            return summaryMessage ? renderMessage(summaryMessage) : null;
        }

        const toggle = onToggleProcess ? (
            <ProcessToggle
                key="process-toggle"
                expanded={processExpanded}
                onToggle={onToggleProcess}
            />
        ) : null;

        if (!processExpanded) {
            const firstProcessMessage = processMessages[0];
            return (
                <>
                    {firstProcessMessage ? renderMessage(firstProcessMessage, { hideAssistantBody: true }) : null}
                    {toggle}
                    {summaryMessage ? renderMessage(summaryMessage) : null}
                </>
            );
        }

        return (
            <>
                {processMessages.map((message) => renderMessage(message))}
                {toggle}
                {summaryMessage ? renderMessage(summaryMessage) : null}
            </>
        );
    }, [onToggleProcess, processExpanded, renderMessage]);

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
                    data-sticky-message-wrapper="true"
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
                {renderAssistantMessages(turn.assistantMessages)}
            </div>

            {hasDirectives && directiveTurns.map((dTurn) => (
                <div key={dTurn.turnId} data-directive-turn-id={dTurn.turnId}>
                    {stickyUserHeader ? (
                        <div
                            className="sticky z-10 bg-[var(--surface-background)] [overflow-anchor:none]"
                            style={{ top: 'var(--oc-user-sticky-h, 0px)' }}
                            data-sticky-message-wrapper="true"
                        >
                            {renderMessage(dTurn.userMessage)}
                        </div>
                    ) : (
                        renderMessage(dTurn.userMessage)
                    )}
                    <div className="relative z-0">
                        {renderAssistantMessages(dTurn.assistantMessages)}
                    </div>
                </div>
            ))}
        </section>
    );
};

export default React.memo(TurnItem);

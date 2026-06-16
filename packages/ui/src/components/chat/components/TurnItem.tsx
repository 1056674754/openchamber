import React from 'react';
import { animate, type AnimationPlaybackControls } from 'motion';

import { Icon } from '@/components/icon/Icon';
import type { ChatMessageEntry, TurnRecord } from '../lib/turns/types';
import { formatTurnDuration } from '../lib/turns/duration';
import { useI18n } from '@/lib/i18n';

interface RenderMessageOptions {
    hideAssistantBody?: boolean;
    assistantHeaderAddon?: React.ReactNode;
    assistantBodyProcessFoldContent?: boolean;
    assistantBodyProcessFoldCollapsed?: boolean;
}

interface TurnItemProps {
    turn: TurnRecord;
    stickyUserHeader?: boolean;
    renderMessage: (message: ChatMessageEntry, options?: RenderMessageOptions) => React.ReactNode;
    directiveTurns?: TurnRecord[];
    getProcessFoldState?: (turn: TurnRecord) => {
        expanded: boolean;
        enabled: boolean;
    };
}

const PROCESS_FOLD_REGION_SELECTOR = '[data-process-fold-region="true"]';
const PROCESS_FOLD_DETAIL_SELECTOR = '[data-process-fold-content="primary"], [data-process-fold-content="tail"]';
const PROCESS_FOLD_CONTENT_SPRING = { type: 'spring' as const, visualDuration: 0.24, bounce: 0 };

interface ProcessDetailLock {
    element: HTMLElement;
    fromHeight: number;
    toHeight: number;
}

const prefersReducedMotion = () => (
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const getProcessDetailElements = (region: HTMLElement): HTMLElement[] => {
    return Array.from(region.querySelectorAll<HTMLElement>(PROCESS_FOLD_DETAIL_SELECTOR))
        .filter((element) => {
            if (element.closest(PROCESS_FOLD_REGION_SELECTOR) !== region) {
                return false;
            }

            return element.getBoundingClientRect().width > 0;
        });
};

const lockProcessDetailPresentation = (element: HTMLElement, height: number, opacity: number) => {
    element.style.height = `${Math.max(0, height)}px`;
    element.style.opacity = `${opacity}`;
    element.style.overflow = 'clip';
    element.style.willChange = 'height, opacity';
};

const clearProcessDetailPresentationLock = (element: HTMLElement) => {
    element.style.height = '';
    element.style.opacity = '';
    element.style.overflow = '';
    element.style.willChange = '';
};

const animateProcessDetailsHeight = (
    locks: ProcessDetailLock[],
    isCollapsing: boolean,
    onDone: () => void,
) : AnimationPlaybackControls[] => {
    if (locks.length === 0) {
        onDone();
        return [];
    }

    const animations = locks.map((lock): AnimationPlaybackControls => {
        const animation = animate(
            lock.element,
            {
                height: isCollapsing ? '0px' : 'auto',
                opacity: isCollapsing ? 0 : 1,
            },
            PROCESS_FOLD_CONTENT_SPRING,
        );
        return animation;
    });

    void Promise.all(animations.map((animation) => animation.finished))
        .then(onDone)
        .catch(() => undefined);
    return animations;
};

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
const splitProcessMessages = (messages: ChatMessageEntry[]) => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
        return { processMessages: [], summaryMessage: undefined };
    }

    // Always peel off the last message — completed, aborted, or streaming —
    // so the latest state stays visible outside the collapsible area.
    return {
        processMessages: messages.slice(0, -1),
        summaryMessage: lastMessage,
    };
};

const getTurnDurationText = (turn: TurnRecord): string | undefined => {
    const durationMs = turn.durationMs ?? (
        typeof turn.startedAt === 'number' && typeof turn.completedAt === 'number' && turn.completedAt >= turn.startedAt
            ? turn.completedAt - turn.startedAt
            : undefined
    );
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
        return undefined;
    }
    return formatTurnDuration(durationMs);
};

const ProcessToggle: React.FC<{
    expanded: boolean;
    onToggle: () => void;
    label: string;
    durationText?: string;
    wrapColumn?: boolean;
}> = ({ expanded, onToggle, label, durationText, wrapColumn = true }) => {
    const button = (
        <button
            type="button"
            className="group/process-toggle flex items-center gap-1.5 py-1.5 pl-px pr-2 text-left text-muted-foreground/60 transition-colors hover:text-muted-foreground/80"
            aria-expanded={expanded}
            onClick={onToggle}
        >
            <span className="typography-ui-label font-semibold">
                {durationText ? `${label} ${durationText}` : label}
            </span>
            <Icon name={expanded ? 'arrow-up-s' : 'arrow-down-s'} className="h-3.5 w-3.5" />
        </button>
    );

    return wrapColumn ? (
        <div className="chat-message-column">
            {button}
        </div>
    ) : (
        button
    );
};

const ProcessMessages: React.FC<{
    turn: TurnRecord;
    processMessages: ChatMessageEntry[];
    foldDefault: {
        expanded: boolean;
        enabled: boolean;
    };
    renderMessage: (message: ChatMessageEntry, options?: RenderMessageOptions) => React.ReactNode;
    processedLabel: string;
    collapseLabel: string;
    durationText?: string;
}> = ({
    turn,
    processMessages,
    foldDefault,
    renderMessage,
    processedLabel,
    collapseLabel,
    durationText,
}) => {
    const regionRef = React.useRef<HTMLDivElement | null>(null);
    const mountedRef = React.useRef(false);
    const animationRunRef = React.useRef(0);
    const animationsRef = React.useRef<AnimationPlaybackControls[]>([]);
    const initialExpanded = foldDefault.enabled ? foldDefault.expanded : true;
    const foldDefaultKey = `${turn.turnId}:${foldDefault.enabled ? 'enabled' : 'open'}:${foldDefault.expanded ? 'expanded' : 'collapsed'}`;
    const [userExpansion, setUserExpansion] = React.useState<{ key: string; value: boolean | null }>(() => ({
        key: foldDefaultKey,
        value: null,
    }));
    const [detailsRenderState, setDetailsRenderState] = React.useState<{ turnId: string; shouldRender: boolean }>(() => ({
        turnId: turn.turnId,
        shouldRender: initialExpanded,
    }));

    const userExpanded = userExpansion.key === foldDefaultKey ? userExpansion.value : null;
    const shouldRenderDetails = detailsRenderState.turnId === turn.turnId
        ? detailsRenderState.shouldRender
        : initialExpanded;

    const expanded = foldDefault.enabled
        ? (userExpanded ?? foldDefault.expanded)
        : true;
    const detailsHidden = !expanded;
    const isExternallyCollapsed = foldDefault.enabled && userExpanded === null && !foldDefault.expanded;
    const renderDetails = isExternallyCollapsed ? false : (expanded || shouldRenderDetails);

    const setDetailsShouldRender = React.useCallback((shouldRender: boolean) => {
        setDetailsRenderState((previous) => {
            if (previous.turnId === turn.turnId && previous.shouldRender === shouldRender) {
                return previous;
            }
            return { turnId: turn.turnId, shouldRender };
        });
    }, [turn.turnId]);

    const setExpandedOverride = React.useCallback((nextExpanded: boolean) => {
        if (nextExpanded) {
            setDetailsShouldRender(true);
        }
        setUserExpansion({ key: foldDefaultKey, value: nextExpanded });
    }, [foldDefaultKey, setDetailsShouldRender]);

    React.useLayoutEffect(() => {
        const region = regionRef.current;
        if (!region) {
            return;
        }

        animationRunRef.current += 1;
        const runId = animationRunRef.current;
        animationsRef.current.forEach((animation) => animation.stop());
        animationsRef.current = [];

        const detailElements = getProcessDetailElements(region);
        const clearLocks = () => {
            detailElements.forEach(clearProcessDetailPresentationLock);
        };

        if (prefersReducedMotion()) {
            clearLocks();
            if (!expanded) {
                setDetailsShouldRender(false);
            }
            return;
        }

        if (!mountedRef.current) {
            mountedRef.current = true;
            if (!expanded) {
                detailElements.forEach((element) => {
                    lockProcessDetailPresentation(element, 0, 0);
                });
            } else {
                clearLocks();
            }
            if (!expanded && detailElements.length === 0) {
                setDetailsShouldRender(false);
            }
            return;
        }

        const locks = detailElements.map((element): ProcessDetailLock => {
            const fromHeight = expanded ? 0 : element.scrollHeight;
            lockProcessDetailPresentation(element, fromHeight, expanded ? 0 : 1);
            return {
                element,
                fromHeight,
                toHeight: expanded ? element.scrollHeight : 0,
            };
        }).filter((lock) => Math.abs(lock.fromHeight - lock.toHeight) > 0.5);

        animationsRef.current = animateProcessDetailsHeight(locks, !expanded, () => {
            if (animationRunRef.current !== runId) {
                return;
            }
            animationsRef.current = [];
            clearLocks();
            if (!expanded) {
                setDetailsShouldRender(false);
            }
        });

        return () => {
            animationRunRef.current += 1;
            animationsRef.current.forEach((animation) => animation.stop());
            animationsRef.current = [];
        };
    }, [expanded, renderDetails, setDetailsShouldRender, turn.turnId]);

    React.useEffect(() => {
        return () => {
            animationRunRef.current += 1;
            animationsRef.current.forEach((animation) => animation.stop());
            animationsRef.current = [];
        };
    }, []);

    const firstProcessMessage = processMessages[0];
    const remainingProcessMessages = processMessages.slice(1);
    const headerToggle = foldDefault.enabled ? (
        <ProcessToggle
            expanded={expanded}
            onToggle={() => setExpandedOverride(!expanded)}
            label={processedLabel}
            durationText={durationText}
            wrapColumn={false}
        />
    ) : null;
    const collapseToggle = foldDefault.enabled && expanded ? (
        <ProcessToggle
            key="process-collapse-toggle"
            expanded
            onToggle={() => setExpandedOverride(false)}
            label={collapseLabel}
        />
    ) : null;

    return (
        <div
            ref={regionRef}
            data-process-fold-region="true"
            data-process-fold-expanded={expanded ? 'true' : 'false'}
        >
            <div data-process-fold-content="body">
                {firstProcessMessage ? renderMessage(firstProcessMessage, {
                    assistantHeaderAddon: headerToggle,
                    hideAssistantBody: !renderDetails,
                    assistantBodyProcessFoldContent: foldDefault.enabled && renderDetails,
                    assistantBodyProcessFoldCollapsed: detailsHidden,
                }) : null}
                {renderDetails ? (
                    <div
                        data-process-fold-content="tail"
                        aria-hidden={detailsHidden ? 'true' : undefined}
                    >
                        {remainingProcessMessages.map((message) => renderMessage(message))}
                        {collapseToggle}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

const TurnItem: React.FC<TurnItemProps> = ({
    turn,
    stickyUserHeader = true,
    renderMessage,
    directiveTurns,
    getProcessFoldState,
}) => {
    const { t } = useI18n();
    const sectionRef = React.useRef<HTMLElement | null>(null);
    const userRef = React.useRef<HTMLDivElement | null>(null);

    const hasDirectives = directiveTurns && directiveTurns.length > 0;
    const resolveProcessFoldState = React.useCallback((assistantTurn: TurnRecord) => {
        return getProcessFoldState?.(assistantTurn) ?? {
            expanded: false,
            enabled: true,
        };
    }, [getProcessFoldState]);
    const renderAssistantMessages = React.useCallback((assistantTurn: TurnRecord) => {
        const assistantMessages = assistantTurn.assistantMessages;
        const { processMessages, summaryMessage } = splitProcessMessages(assistantMessages);
        if (processMessages.length === 0) {
            return summaryMessage ? renderMessage(summaryMessage) : null;
        }

        const durationText = getTurnDurationText(assistantTurn);
        const processLabel = t(summaryMessage ? 'chat.messageBody.activity.processed' : 'chat.messageBody.activity.process');
        const summaryElement = summaryMessage ? (
            <div data-process-fold-content="summary">
                {renderMessage(summaryMessage)}
            </div>
        ) : null;
        return (
            <>
                <ProcessMessages
                    turn={assistantTurn}
                    processMessages={processMessages}
                    foldDefault={resolveProcessFoldState(assistantTurn)}
                    renderMessage={renderMessage}
                    processedLabel={processLabel}
                    collapseLabel={t('chat.messageBody.activity.collapse')}
                    durationText={durationText}
                />
                {summaryElement}
            </>
        );
    }, [renderMessage, resolveProcessFoldState, t]);

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

            <div
                className="relative z-0"
            >
                {renderAssistantMessages(turn)}
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
                    <div
                        className="relative z-0"
                    >
                        {renderAssistantMessages(dTurn)}
                    </div>
                </div>
            ))}
        </section>
    );
};

export default React.memo(TurnItem);

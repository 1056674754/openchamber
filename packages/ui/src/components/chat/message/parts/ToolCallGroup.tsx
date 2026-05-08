import React from 'react';
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import type { ToolPart as ToolPartType } from '@opencode-ai/sdk/v2';
import { getToolIcon } from './toolPresentation';
import { StaticToolRow } from './ProgressiveGroup';
import { MinDurationShineText } from './MinDurationShineText';
import { ToolRevealOnMount } from './ToolRevealOnMount';
import {
    buildToolCallSummary,
    formatToolCallSummary,
    getToolCallCategory,
} from './toolRenderUtils';
import type { ToolCallCategory } from './toolRenderUtils';

const CATEGORY_ICONS: Record<ToolCallCategory, string> = {
    read: 'read',
    search: 'grep',
    list: 'list',
    fetch: 'webfetch',
    websearch: 'websearch',
    other: 'bash',
};

const isToolRunning = (part: ToolPartType): boolean => {
    const status = (part.state?.status as string) || undefined;
    if (status === 'completed' || status === 'error' || status === 'aborted' || status === 'failed' || status === 'timeout' || status === 'cancelled') {
        return false;
    }
    return status === 'running' || status === 'pending' || status === 'started';
};

export interface ToolCallGroupActivity {
    id: string;
    turnId: string;
    messageId: string;
    partIndex: number;
    part: ToolPartType;
    kind: 'tool';
}

interface ToolCallGroupProps {
    tools: ToolPartType[];
    messageParts: ToolCallGroupActivity[];
    isExpanded: boolean;
    onToggle: () => void;
    animateTailText: boolean;
}

const ToolCallGroupInner: React.FC<ToolCallGroupProps> = ({
    tools,
    messageParts,
    isExpanded,
    onToggle,
    animateTailText,
}) => {
    const hasRunning = React.useMemo(() => tools.some(isToolRunning), [tools]);

    const summaryText = React.useMemo(() => {
        const toolNames = tools.map((t) => t.tool ?? '');
        const counts = buildToolCallSummary(toolNames);
        return formatToolCallSummary(counts);
    }, [tools]);

    const primaryIcon = React.useMemo(() => {
        const firstCategory = getToolCallCategory(tools[0]?.tool ?? '');
        const iconName = CATEGORY_ICONS[firstCategory] ?? 'bash';
        return getToolIcon(iconName);
    }, [tools]);

    return (
        <div className="flex flex-col">
            <button
                type="button"
                onClick={(event) => {
                    event.preventDefault();
                    onToggle();
                }}
                className={cn(
                    'flex w-full items-center gap-x-1.5 pr-2 pl-px py-1.5 rounded-xl min-w-0',
                    'cursor-pointer select-none',
                    'transition-colors duration-100',
                )}
                style={{ color: 'var(--tools-title)' }}
            >
                <div className="inline-flex h-5 items-center flex-shrink-0" style={{ color: 'var(--tools-icon)' }}>
                    {primaryIcon}
                </div>
                <MinDurationShineText
                    active={hasRunning}
                    minDurationMs={1000}
                    className="typography-meta leading-5 font-medium inline-flex h-5 items-center flex-shrink-0 opacity-85"
                    style={{ color: 'var(--tools-title)' }}
                >
                    {summaryText}
                </MinDurationShineText>
                <div className="inline-flex h-5 items-center flex-shrink-0 ml-auto opacity-50">
                    {isExpanded
                        ? <RiArrowDownSLine className="h-3.5 w-3.5" />
                        : <RiArrowRightSLine className="h-3.5 w-3.5" />
                    }
                </div>
            </button>
            {isExpanded && (
                <div className="flex flex-col ml-2 pl-2" style={{ borderLeft: '1px solid var(--tools-description)', opacity: 0.7 }}>
                    {messageParts.map((activity) => {
                        const toolPart = activity.part as ToolPartType;
                        const toolName = toolPart.tool?.toLowerCase() ?? '';
                        return (
                            <ToolRevealOnMount key={activity.id} animate={animateTailText} wipe>
                                <StaticToolRow
                                    toolName={toolName}
                                    activities={[activity]}
                                    animateTailText={animateTailText}
                                />
                            </ToolRevealOnMount>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const ToolCallGroup = React.memo(ToolCallGroupInner, (prev, next) => {
    if (prev.isExpanded !== next.isExpanded) return false;
    if (prev.onToggle !== next.onToggle) return false;
    if (prev.animateTailText !== next.animateTailText) return false;
    if (prev.tools.length !== next.tools.length) return false;
    for (let i = 0; i < prev.tools.length; i++) {
        if (prev.tools[i].id !== next.tools[i].id) return false;
        if (prev.tools[i] !== next.tools[i]) return false;
    }
    if (prev.messageParts.length !== next.messageParts.length) return false;
    for (let i = 0; i < prev.messageParts.length; i++) {
        if (prev.messageParts[i].id !== next.messageParts[i].id) return false;
        if (prev.messageParts[i].part !== next.messageParts[i].part) return false;
    }
    return true;
});

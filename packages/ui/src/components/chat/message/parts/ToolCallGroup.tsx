import React from 'react';
import { RiArrowDownSLine, RiArrowRightSLine, RiLoader4Line } from '@remixicon/react';
import { cn } from '@/lib/utils';
import type { ToolPart as ToolPartType } from '@opencode-ai/sdk/v2';
import type { TurnActivityRecord } from '../../lib/turns/types';
import { getToolIcon } from './toolPresentation';
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

interface ToolCallGroupProps {
    activities: TurnActivityRecord[];
    isExpanded: boolean;
    onToggle: () => void;
    animateTailText: boolean;
    renderActivity: (activity: TurnActivityRecord, animateTailText: boolean) => React.ReactNode;
}

const ToolCallGroupInner: React.FC<ToolCallGroupProps> = ({
    activities,
    isExpanded,
    onToggle,
    animateTailText,
    renderActivity,
}) => {
    const tools = React.useMemo(
        () => activities.map((activity) => activity.part as ToolPartType),
        [activities]
    );
    const runningCount = React.useMemo(() => tools.reduce((count, tool) => count + (isToolRunning(tool) ? 1 : 0), 0), [tools]);
    const hasRunning = runningCount > 0;

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
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${summaryText}`}
                onClick={(event) => {
                    event.preventDefault();
                    onToggle();
                }}
                className={cn(
                    'flex w-full items-center gap-x-1.5 pr-2 pl-px py-1.5 rounded-xl min-w-0',
                    'cursor-pointer select-none',
                    'transition-colors duration-100 hover:bg-[var(--interactive-hover)]',
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
                <div className="ml-auto inline-flex h-5 items-center gap-1.5 flex-shrink-0">
                    {hasRunning ? (
                        <span className="inline-flex items-center gap-1 typography-meta leading-5" style={{ color: 'var(--tools-description)' }}>
                            <RiLoader4Line className="h-3.5 w-3.5 animate-spin" />
                            {runningCount > 1 ? `${runningCount} running` : 'running'}
                        </span>
                    ) : null}
                    <span className="inline-flex h-5 items-center opacity-50">
                    {isExpanded
                        ? <RiArrowDownSLine className="h-3.5 w-3.5" />
                        : <RiArrowRightSLine className="h-3.5 w-3.5" />
                    }
                    </span>
                </div>
            </button>
            {isExpanded && (
                <div className="flex flex-col ml-2 pl-2" style={{ borderLeft: '1px solid var(--tools-border)' }}>
                    {activities.map((activity) => {
                        return (
                            <ToolRevealOnMount key={activity.id} animate={animateTailText} wipe>
                                {renderActivity(activity, animateTailText)}
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
    if (prev.renderActivity !== next.renderActivity) return false;
    if (prev.activities.length !== next.activities.length) return false;
    for (let i = 0; i < prev.activities.length; i++) {
        const prevActivity = prev.activities[i]!;
        const nextActivity = next.activities[i]!;
        if (prevActivity.id !== nextActivity.id) return false;
        if (prevActivity.endedAt !== nextActivity.endedAt) return false;
        if (prevActivity.part !== nextActivity.part) return false;
    }
    return true;
});

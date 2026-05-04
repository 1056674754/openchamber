import React from 'react';
import type { Part } from '@opencode-ai/sdk/v2';
import { RiArrowDownSLine, RiArrowRightSLine, RiLoader4Line, RiCheckboxCircleLine, RiErrorWarningLine, RiTimeLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { FadeInOnReveal } from '../FadeInOnReveal';

export interface BackgroundTaskPartProps {
    part: Part;
}

interface ParsedBackgroundTask {
    id: string;
    description: string;
    status: 'running' | 'completed' | 'failed';
    duration?: string;
    content: string;
}

const BACKGROUND_TASK_MARKERS = [
    '[BACKGROUND TASK',
    'Background_output',
];

const STATUS_PATTERNS = {
    completed: ['[BACKGROUND TASK COMPLETED]', 'COMPLETED', 'COMPLETE'],
    failed: ['FAILED', 'ERROR', 'FAIL'],
};

const METADATA_PATTERNS = {
    id: /ID:\s*`?([^`\n]+)`?/,
    description: /Description:\s*([^\n]+)/,
    duration: /Duration:\s*([^\n]+)/,
};

const METADATA_PREFIXES = [
    '[BACKGROUND TASK',
    'ID:',
    'Description:',
    'Duration:',
    '<system-reminder>',
    '</system-reminder>',
];

const isMetadataLine = (line: string): boolean =>
    METADATA_PREFIXES.some((prefix) => line.includes(prefix));

const parseBackgroundTask = (part: Part): ParsedBackgroundTask | null => {
    const text = (part as { text?: string }).text || '';
    if (!text) return null;

    const isBackgroundTask = BACKGROUND_TASK_MARKERS.some((marker) =>
        text.includes(marker)
    );
    if (!isBackgroundTask) return null;

    const idMatch = text.match(METADATA_PATTERNS.id);
    const id = idMatch ? idMatch[1].trim() : 'unknown';

    const descMatch = text.match(METADATA_PATTERNS.description);
    const description = descMatch ? descMatch[1].trim() : 'Background Task';

    let status: ParsedBackgroundTask['status'] = 'running';
    if (STATUS_PATTERNS.completed.some((pattern) => text.includes(pattern))) {
        status = 'completed';
    } else if (STATUS_PATTERNS.failed.some((pattern) => text.includes(pattern))) {
        status = 'failed';
    }

    const durationMatch = text.match(METADATA_PATTERNS.duration);
    const duration = durationMatch ? durationMatch[1].trim() : undefined;

    const content = text
        .split('\n')
        .filter((line) => !isMetadataLine(line))
        .join('\n')
        .trim();

    return { id, description, status, duration, content };
};

const StatusIcon: React.FC<{ status: ParsedBackgroundTask['status'] }> = ({ status }) => {
    switch (status) {
        case 'running':
            return <RiLoader4Line className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--primary)' }} />;
        case 'completed':
            return <RiCheckboxCircleLine className="h-3.5 w-3.5" style={{ color: 'var(--status-success)' }} />;
        case 'failed':
            return <RiErrorWarningLine className="h-3.5 w-3.5" style={{ color: 'var(--status-error)' }} />;
    }
};

const STATUS_LABELS: Record<ParsedBackgroundTask['status'], string> = {
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
};

const STATUS_COLORS: Record<ParsedBackgroundTask['status'], string> = {
    running: 'var(--primary)',
    completed: 'var(--status-success)',
    failed: 'var(--status-error)',
};

const StatusLabel: React.FC<{ status: ParsedBackgroundTask['status'] }> = ({ status }) => (
    <span className="typography-micro font-medium" style={{ color: STATUS_COLORS[status] }}>
        {STATUS_LABELS[status]}
    </span>
);

export const BackgroundTaskPart: React.FC<BackgroundTaskPartProps> = ({ part }) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const task = React.useMemo(() => parseBackgroundTask(part), [part]);

    const toggleExpanded = React.useCallback(() => {
        setIsExpanded((prev) => !prev);
    }, []);

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded();
        }
    }, [toggleExpanded]);

    if (!task) return null;

    return (
        <FadeInOnReveal>
            <div className="my-2" data-background-task-id={task.id}>
                <div
                    className={cn(
                        'group/tool flex items-center gap-2 pr-2 pl-px py-1.5 rounded-xl cursor-pointer',
                        'border border-border/20 hover:border-border/40 transition-colors'
                    )}
                    style={{ backgroundColor: 'var(--surface-background)' }}
                    onClick={toggleExpanded}
                    role="button"
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                >
                    <div className="relative h-3.5 w-3.5 flex-shrink-0">
                        <div
                            className={cn(
                                'absolute inset-0 transition-opacity flex items-center justify-center',
                                isExpanded && 'opacity-100',
                                !isExpanded && 'opacity-0 group-hover/tool:opacity-100'
                            )}
                        >
                            {isExpanded ? (
                                <RiArrowDownSLine className="h-3.5 w-3.5" style={{ color: 'var(--tools-icon)' }} />
                            ) : (
                                <RiArrowRightSLine className="h-3.5 w-3.5" style={{ color: 'var(--tools-icon)' }} />
                            )}
                        </div>
                        <div
                            className={cn(
                                'absolute inset-0 transition-opacity flex items-center justify-center',
                                isExpanded && 'opacity-0',
                                !isExpanded && 'opacity-100 group-hover/tool:opacity-0'
                            )}
                        >
                            <StatusIcon status={task.status} />
                        </div>
                    </div>

                    <span className="typography-meta font-medium flex-shrink-0" style={{ color: 'var(--tools-title)' }}>
                        {task.description}
                    </span>

                    <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                        {task.duration && (
                            <span className="flex items-center gap-1 typography-micro text-muted-foreground/60">
                                <RiTimeLine className="h-3 w-3" />
                                {task.duration}
                            </span>
                        )}
                        <StatusLabel status={task.status} />
                    </div>
                </div>

                {isExpanded && task.content && (
                    <div className="relative ml-2 pl-3 mt-1">
                        <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-0 top-px bottom-0 w-px"
                            style={{ backgroundColor: 'var(--tools-border)' }}
                        />
                        
                        <div className="py-2">
                            <Text
                                variant="static"
                                className="typography-code text-foreground/85 whitespace-pre-wrap"
                            >
                                {task.content}
                            </Text>
                        </div>
                    </div>
                )}
            </div>
        </FadeInOnReveal>
    );
};

export default React.memo(BackgroundTaskPart, (prev, next) => {
    return prev.part === next.part;
});
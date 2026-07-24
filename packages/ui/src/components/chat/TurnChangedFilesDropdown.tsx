import React from 'react';
import type { ToolPart } from '@opencode-ai/sdk/v2';
import { Popover } from '@base-ui/react/popover';
import { useIsGitRepo } from '@/stores/useGitStore';
import { useUIStore } from '@/stores/useUIStore';
import { useMessageDirectory } from '@/hooks/useMessageDirectory';
import {
    type ChangedFile,
    type ChangedFileEntry,
    FILE_EDIT_TOOLS,
    extractChangedFiles,
    isGitFile,
    toRelativePath,
} from './changedFiles';
import { ChangedFilesList } from './ChangedFilesList';
import { changedFilesPopoverClassName, changedFilesPopoverStyle } from './changedFilesPopover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import type { TurnActivityRecord, TurnGroupingContext } from './lib/turns/types';
import { useI18n } from '@/lib/i18n';

interface TurnChangedFilesDropdownProps {
    sessionId?: string;
    activityParts: TurnActivityRecord[] | undefined;
    summaryDiffs?: TurnGroupingContext['summaryDiffs'];
    isLatestTurn?: boolean;
}

const summaryDiffsToChangedFiles = (
    summaryDiffs: NonNullable<TurnGroupingContext['summaryDiffs']>,
): ChangedFile[] => {
    const files: ChangedFile[] = [];
    const seen = new Set<string>();
    for (const diff of summaryDiffs) {
        const path = typeof diff.file === 'string' ? diff.file.trim() : '';
        if (!path || seen.has(path)) continue;
        seen.add(path);
        files.push({
            path,
            tool: 'summary',
            partId: `summary:${path}`,
            messageID: 'summary',
            additions: typeof diff.additions === 'number' ? diff.additions : undefined,
            deletions: typeof diff.deletions === 'number' ? diff.deletions : undefined,
            patch: typeof diff.patch === 'string' ? diff.patch : undefined,
        });
    }
    return files;
};

export const TurnChangedFilesDropdown: React.FC<TurnChangedFilesDropdownProps> = React.memo(({
    sessionId,
    activityParts,
    summaryDiffs,
    isLatestTurn = false,
}) => {
    const { t } = useI18n();
    const [isExpanded, setIsExpanded] = React.useState(false);
    const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);
    const triggerButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const currentDirectory = useMessageDirectory(sessionId);
    const isGitRepo = useIsGitRepo(currentDirectory);

    const changedFiles = React.useMemo<ChangedFile[]>(() => {
        if (summaryDiffs && summaryDiffs.length > 0) {
            return summaryDiffsToChangedFiles(summaryDiffs);
        }

        // Without turn snapshots, git repos keep using PendingChangesBar for live working-tree changes.
        if (isGitRepo !== false) return [];
        if (!activityParts || activityParts.length === 0) return [];
        const toolParts: ToolPart[] = [];
        for (const activity of activityParts) {
            const part = activity.part;
            if (part.type !== 'tool') continue;
            if (!FILE_EDIT_TOOLS.has(part.tool)) continue;
            toolParts.push(part);
        }
        if (toolParts.length === 0) return [];
        return extractChangedFiles(toolParts);
    }, [activityParts, isGitRepo, summaryDiffs]);

    if (changedFiles.length === 0) return null;

    const syncPortalContainer = () => {
        const container = triggerButtonRef.current?.closest('[data-slot="dialog-content"], [role="dialog"]') as HTMLElement | null;
        setPortalContainer(container || null);
    };

    const handleOpenFile = (file: ChangedFileEntry) => {
        if (!currentDirectory) return;
        if (!isLatestTurn) return;
        if (isGitFile(file)) return;

        const relativePath = toRelativePath(file.path, currentDirectory);
        const store = useUIStore.getState();

        if (!store.isMobile) {
            store.openContextDiff(currentDirectory, relativePath, 'turn');
            setIsExpanded(false);
            return;
        }

        store.navigateToDiff(relativePath, 'turn');
        store.setRightSidebarOpen(false);
        setIsExpanded(false);
    };

    const fileCount = changedFiles.length;
    const label = t(
        fileCount === 1 ? 'chat.changedFiles.countSingle' : 'chat.changedFiles.countPlural',
        { count: fileCount },
    );
    const tooltip = isLatestTurn
        ? t('chat.changedFiles.tooltip.latestTurn')
        : t('chat.changedFiles.tooltip.historicalTurn');

    return (
        <Popover.Root open={isExpanded} onOpenChange={setIsExpanded}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Popover.Trigger
                        render={
                            <button
                                ref={triggerButtonRef}
                                type="button"
                                className="flex items-center gap-1 text-sm text-muted-foreground/60 hover:text-muted-foreground tabular-nums"
                                aria-label={label}
                                onPointerDownCapture={syncPortalContainer}
                                onFocusCapture={syncPortalContainer}
                            >
                                <Icon name="file-edit" className="h-3.5 w-3.5" />
                                <span className="message-footer__label">{label}</span>
                                {isExpanded ? (
                                    <Icon name="arrow-up-s" className="h-3.5 w-3.5" />
                                ) : (
                                    <Icon name="arrow-down-s" className="h-3.5 w-3.5" />
                                )}
                            </button>
                        }
                    />
                </TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
            <Popover.Portal container={portalContainer || undefined}>
                <Popover.Positioner side="top" align="start" sideOffset={4} collisionPadding={8}>
                    <Popover.Popup
                        style={changedFilesPopoverStyle}
                        className={`${changedFilesPopoverClassName} transition-all duration-150 ease-out data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95`}
                    >
                        <ChangedFilesList
                            files={changedFiles}
                            currentDirectory={currentDirectory ?? ''}
                            onOpenFile={handleOpenFile}
                            readOnly={!isLatestTurn}
                        />
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
});

TurnChangedFilesDropdown.displayName = 'TurnChangedFilesDropdown';

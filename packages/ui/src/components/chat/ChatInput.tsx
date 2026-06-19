import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { BrowserVoiceButton } from '@/components/voice';
// sessionStore removed — currentSessionId comes from useSessionUIStore
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { useMessageQueueStore, type QueuedMessage } from '@/stores/messageQueueStore';
import { useSessionUIStore, type SendMessageTarget } from '@/sync/session-ui-store';
import { useSelectionStore } from '@/sync/selection-store';
import { useInputStore } from '@/sync/input-store';
import type { AttachedFile } from '@/stores/types/sessionTypes';
import * as sessionActions from '@/sync/session-actions';
import type { SendDeliveryMode } from '@/sync/session-actions';
import { useDirectorySync, useSessionMessages, useSessionRevertMessageID, useUserMessageHistory } from '@/sync/sync-context';
import { parseSlashInvocation } from '@/sync/slash-routing';
import { useInlineCommentDraftStore, type InlineCommentDraft } from '@/stores/useInlineCommentDraftStore';
import { useSnippetsStore } from '@/stores/useSnippetsStore';
import { appendInlineComments } from '@/lib/messages/inlineComments';
import { renderMagicPrompt, type MagicPromptId } from '@/lib/magicPrompts';
import { startReviewFlow } from '@/lib/reviewFlow';
import type { I18nKey } from '@/lib/i18n';
import { AttachedFilesList, AttachedVSCodeFileChips, ActiveEditorFileSuggestion } from './FileAttachment';
import { QueuedMessageChips } from './QueuedMessageChips';
import { FileMentionAutocomplete, type FileMentionHandle } from './FileMentionAutocomplete';
import { CommandAutocomplete, type CommandAutocompleteHandle, type CommandInfo } from './CommandAutocomplete';
import { SkillAutocomplete, type SkillAutocompleteHandle } from './SkillAutocomplete';
import { SnippetAutocomplete, type SnippetAutocompleteHandle } from './SnippetAutocomplete';
import { cn, formatDirectoryName, isMacOS } from '@/lib/utils';
import { ModelControls } from './ModelControls';
import { parseAgentMentions } from '@/lib/messages/agentMentions';
import { StatusRow } from './StatusRow';
import { PendingChangesBar } from './PendingChangesBar';
import { useChatSurfaceMode } from './useChatSurfaceMode';
import { MobileAgentButton } from './MobileAgentButton';
import { MobileModelButton } from './MobileModelButton';
import { MobileSessionStatusBar } from './MobileSessionStatusBar';
import { useCurrentSessionActivity } from '@/hooks/useSessionActivity';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
// useMessageStore removed — messages now come from sync system
import { isVSCodeRuntime } from '@/lib/desktop';
import { isIMECompositionEvent } from '@/lib/ime';
import { StopIcon } from '@/components/icons/StopIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCycledPrimaryAgentName, type MobileControlsPanel } from './mobileControlsUtils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { GitHubIssuePickerDialog } from '@/components/session/GitHubIssuePickerDialog';
import { GitHubPrPickerDialog } from '@/components/session/GitHubPrPickerDialog';
import { Icon } from "@/components/icon/Icon";
import { useChatSearchDirectory } from '@/hooks/useChatSearchDirectory';
import { opencodeClient } from '@/lib/opencode/client';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { PROJECT_COLOR_MAP, PROJECT_ICON_MAP, getProjectIconImageUrl } from '@/lib/projectMeta';
import { useGitBranches, useGitStore, useIsGitRepo } from '@/stores/useGitStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useSkillsStore } from '@/stores/useSkillsStore';
import { useCommandsStore } from '@/stores/useCommandsStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { createWorktreeDraft } from '@/lib/worktreeSessionCreator';
import { buildSessionTargetOptions } from '@/sync/session-worktree-contract';
import { getWorktreesForProject } from '@/lib/worktrees/worktreeKeys';
import { resolveProjectForSessionDirectory } from '@/lib/projectResolution';
import { usePermissionStore } from '@/stores/permissionStore';
import { extractGitChangedFiles } from './changedFiles';
import { useI18n } from '@/lib/i18n';
import { fetchResponseStyleInstruction } from '@/lib/responseStyle';
import { wrapSystemReminder } from '@/lib/systemReminder';
import { eventMatchesShortcut, getEffectiveShortcutCombo, normalizeCombo } from '@/lib/shortcuts';
import { getSyncMessages } from '@/sync/sync-refs';
import { isSyntheticPart } from '@/lib/messages/synthetic';
import { serverRegistry } from '@/lib/opencode/server-registry';
import {
    buildHighlightParts,
    mentionRangesToHighlightRanges,
    tokenizeMarkdown,
    type HighlightRange,
    type MentionRange,
} from './composerHighlight';
import { highlightFencedCode } from './composerCodeHighlight';
import {
    assignImageAttachmentFilenames,
    buildAttachmentCitationText,
    findAttachmentCitationRanges,
} from './attachmentCitations';
import type { Message, Part } from '@opencode-ai/sdk/v2/client';

const MAX_VISIBLE_TEXTAREA_LINES = 8;
const EMPTY_QUEUE: QueuedMessage[] = [];
const FILE_MENTION_TOKEN = /^@[^\s]+$/;
const PASTE_LINK_URL_PATTERN = /^(https?:\/\/|mailto:)\S+$/i;
const INLINE_SKILL_TOKEN_PATTERN = /(^|\s)\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)/g;
const CHAT_DRAFT_PERSIST_DEBOUNCE_MS = 500;
const COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH = 560;
const VS_CODE_DROP_DATA_TYPES = [
    'CodeFiles',
    'codefiles',
    'application/vnd.code.tree',
    'application/vnd.code.tree.explorer',
    'text/uri-list',
    'text/plain',
];

const GUIDED_SESSION_COMMANDS: Record<string, {
    visible: MagicPromptId;
    instructions: MagicPromptId;
    toastKey: I18nKey;
}> = {
    'plan-feature': {
        visible: 'session.plan.visible',
        instructions: 'session.plan.instructions',
        toastKey: 'chat.chatInput.toast.planFeatureFailed',
    },
    'catch-up': {
        visible: 'session.catchup.visible',
        instructions: 'session.catchup.instructions',
        toastKey: 'chat.chatInput.toast.catchUpFailed',
    },
    debug: {
        visible: 'session.debug.visible',
        instructions: 'session.debug.instructions',
        toastKey: 'chat.chatInput.toast.debugFailed',
    },
    weigh: {
        visible: 'session.weigh.visible',
        instructions: 'session.weigh.instructions',
        toastKey: 'chat.chatInput.toast.weighFailed',
    },
    explore: {
        visible: 'session.explore.visible',
        instructions: 'session.explore.instructions',
        toastKey: 'chat.chatInput.toast.exploreFailed',
    },
};

const renameFileForAttachmentCitation = (file: File, filename: string): File => {
    if (file.name === filename) {
        return file;
    }

    return new File([file], filename, {
        type: file.type,
        lastModified: file.lastModified,
    });
};

const buildImagePasteInsertion = (pastedText: string, citationText: string): string => {
    if (!pastedText) {
        return citationText;
    }
    return `${pastedText}${/\s$/.test(pastedText) ? '' : ' '}${citationText}`;
};

const withInlineInsertionBoundaries = (content: string, before: string, after: string): string => {
    if (!content) {
        return content;
    }

    const needsLeadingSpace = before.length > 0
        && !/\s$/.test(before)
        && !/^\s/.test(content)
        && !/[([{]$/.test(before);
    const needsTrailingSpace = after.length > 0
        && !/\s$/.test(content)
        && !/^\s/.test(after)
        && !/^[\])}.,;:!?]/.test(after);

    return `${needsLeadingSpace ? ' ' : ''}${content}${needsTrailingSpace ? ' ' : ''}`;
};

const clipboardHasMeaningfulText = (clipboardData: DataTransfer): boolean => {
    const plain = clipboardData.getData('text/plain');
    if (plain.trim() !== '') {
        return true;
    }
    const html = clipboardData.getData('text/html');
    if (html.trim() !== '') {
        // Strip markup so an html snippet that is only `<img>` stays an image, while
        // rich-text pastes (e.g. Office html) with actual text content are detected.
        const stripped = html
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .trim();
        if (stripped !== '') {
            return true;
        }
    }
    return false;
};

const collectInlineSkillMentions = (text: string, skillNames: Set<string>): string[] => {
    const mentions: string[] = [];
    INLINE_SKILL_TOKEN_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INLINE_SKILL_TOKEN_PATTERN.exec(text)) !== null) {
        const name = match[2] || '';
        if (!skillNames.has(name) || mentions.includes(name)) {
            continue;
        }
        mentions.push(name);
    }
    return mentions;
};

const buildSkillMentionInstruction = (skillNames: string[]): string | null => {
    if (skillNames.length === 0) return null;
    const formatted = skillNames.map((name) => `\`${name}\``).join(', ');
    return `The user explicitly mentioned these skills using slash syntax. If a skill is relevant, call the skill tool with the exact skill name without the leading slash: ${formatted}.`;
};

const hasUserMessages = (sessionId: string, directory?: string) => {
    return getSyncMessages(sessionId, directory).some((message) => message.role === 'user');
};

const getRevertedPreview = (parts: Part[], fallback: string): string => {
    const text = parts
        .filter((part) => part.type === 'text' && !isSyntheticPart(part))
        .map((part) => {
            const record = part as Record<string, unknown>;
            return typeof record.text === 'string'
                ? record.text
                : typeof record.content === 'string'
                    ? record.content
                    : '';
        })
        .join('\n')
        .replace(/\s+/g, ' ')
        .trim();

    if (text) return text;
    const filePart = parts.find((part) => part.type === 'file') as (Part & { filename?: string }) | undefined;
    return filePart?.filename ? `[${filePart.filename}]` : fallback;
};

const FILE_URI_PREFIX = 'file://';

const encodeFilePath = (filepath: string): string => {
    let normalized = filepath.replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(normalized)) {
        normalized = `/${normalized}`;
    }
    return normalized
        .split('/')
        .map((segment, index) => {
            if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
            return encodeURIComponent(segment);
        })
        .join('/');
};

const toServerFileUrl = (filepath: string): string => {
    const normalized = filepath.replace(/\\/g, '/').trim();
    if (normalized.toLowerCase().startsWith(FILE_URI_PREFIX)) {
        return normalized;
    }
    return `file://${encodeFilePath(normalized)}`;
};

const isLikelyAbsolutePath = (value: string): boolean => (
    value.startsWith('/')
    || value.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/.test(value)
);

const toLikelyFileDropReference = (value: string): string | null => {
    const trimmed = value.trim().replace(/^['"]+|['"]+$/g, '');
    if (!trimmed) {
        return null;
    }

    if (/[\r\n]/.test(trimmed)) {
        return null;
    }

    if (trimmed.toLowerCase().startsWith(FILE_URI_PREFIX)) {
        return trimmed;
    }

    if (isLikelyAbsolutePath(trimmed)) {
        return trimmed;
    }

    return null;
};

const collectStringLeaves = (input: unknown, output: Set<string>, depth = 0): void => {
    if (depth > 6 || input == null) {
        return;
    }

    if (typeof input === 'string') {
        output.add(input);
        return;
    }

    if (Array.isArray(input)) {
        for (const item of input) {
            collectStringLeaves(item, output, depth + 1);
        }
        return;
    }

    if (typeof input !== 'object') {
        return;
    }

    for (const value of Object.values(input)) {
        collectStringLeaves(value, output, depth + 1);
    }
};

const parseDroppedFileReferences = (rawPayload: string): string[] => {
    const extracted = new Set<string>();

    const addCandidatesFromText = (value: string): void => {
        const direct = toLikelyFileDropReference(value);
        if (direct) {
            extracted.add(direct);
            return;
        }

        for (const line of value.split(/\r?\n/)) {
            const candidate = toLikelyFileDropReference(line);
            if (candidate) {
                extracted.add(candidate);
            }
        }
    };

    addCandidatesFromText(rawPayload);

    try {
        const parsed = JSON.parse(rawPayload) as unknown;
        const leaves = new Set<string>();
        collectStringLeaves(parsed, leaves);
        for (const leaf of leaves) {
            addCandidatesFromText(leaf);
        }
    } catch {
        // Ignore non-JSON payloads.
    }

    return Array.from(extracted);
};

const normalizePath = (value?: string | null): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const normalized = trimmed.replace(/\\/g, '/');
    if (normalized === '/') {
        return '/';
    }
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
};

const getProjectDisplayLabel = (project: { label?: string; path: string }): string => {
    const label = project.label?.trim();
    if (label) {
        return label;
    }
    return formatDirectoryName(project.path);
};

const getProjectIconColor = (projectColor?: string | null): string | undefined => {
    if (!projectColor) {
        return undefined;
    }
    return PROJECT_COLOR_MAP[projectColor] ?? undefined;
};

const MemoModelControls = React.memo(ModelControls);
const MemoBrowserVoiceButton = React.memo(BrowserVoiceButton);
const MemoMobileAgentButton = React.memo(MobileAgentButton);
const MemoMobileModelButton = React.memo(MobileModelButton);
const MemoStatusRow = React.memo(StatusRow);

type RevertedMessageDockProps = {
    sessionId: string | null;
    directory?: string;
};

const RevertedMessageDock: React.FC<RevertedMessageDockProps> = React.memo(({ sessionId, directory }) => {
    const { t } = useI18n();
    const revertToMessage = useSessionUIStore((s) => s.revertToMessage);
    const forkFromMessage = useSessionUIStore((s) => s.forkFromMessage);
    const handleSlashRedo = useSessionUIStore((s) => s.handleSlashRedo);
    const [restoringId, setRestoringId] = React.useState<string | null>(null);
    const [forkingId, setForkingId] = React.useState<string | null>(null);
    const [collapsed, setCollapsed] = React.useState(true);
    const serverId = sessionId ? serverRegistry.getServerForSession(sessionId) ?? undefined : undefined;
    const revertMessageID = useSessionRevertMessageID(sessionId ?? '', directory);
    const sessionMessages = useSessionMessages(sessionId ?? '', directory);
    const partsByMessage = useDirectorySync(
        React.useCallback((state) => state.part, []),
        directory,
        serverId,
        sessionId ?? undefined,
    );

    const userMessages = React.useMemo(
        () => sessionMessages.filter((message): message is Message & { role: 'user' } => message.role === 'user'),
        [sessionMessages],
    );
    const noTextContent = t('chat.revertPopover.noTextContent');
    const items = React.useMemo(() => {
        if (!revertMessageID) return [];
        return userMessages
            .filter((message) => message.id >= revertMessageID)
            .map((message) => ({
                id: message.id,
                text: getRevertedPreview(partsByMessage[message.id] ?? [], noTextContent),
            }));
    }, [noTextContent, partsByMessage, revertMessageID, userMessages]);
    const firstRevertedMessageId = items[0]?.id;

    React.useEffect(() => {
        setCollapsed(true);
    }, [revertMessageID, firstRevertedMessageId]);

    const handleRestore = React.useCallback(async (messageId: string) => {
        if (!sessionId || restoringId) return;
        setRestoringId(messageId);
        try {
            const nextMessage = userMessages.find((message) => message.id > messageId);
            if (nextMessage) {
                await revertToMessage(sessionId, nextMessage.id, { skipRedoPush: true });
            } else {
                await handleSlashRedo(sessionId, { fullUnrevert: true });
            }
        } finally {
            setRestoringId(null);
        }
    }, [handleSlashRedo, restoringId, revertToMessage, sessionId, userMessages]);

    const handleFork = React.useCallback(async (messageId: string) => {
        if (!sessionId || forkingId) return;
        setForkingId(messageId);
        try {
            await forkFromMessage(sessionId, messageId);
        } finally {
            setForkingId(null);
        }
    }, [forkFromMessage, forkingId, sessionId]);

    if (!sessionId || items.length === 0) return null;

    return (
        <div className="pb-2 w-full px-1">
            <div className="rounded-xl border border-border/60 bg-[var(--surface-elevated)] text-[var(--surface-elevated-foreground)] shadow-sm overflow-hidden">
                <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--interactive-hover)] transition-colors"
                    onClick={() => setCollapsed((value) => !value)}
                    aria-expanded={!collapsed}
                >
                    <span className="typography-ui-label font-medium text-foreground flex-shrink-0">
                        {t('chat.revertPopover.title')} ({items.length})
                    </span>
                    <Icon
                        name="arrow-down-s"
                        className={cn('ml-auto h-4 w-4 text-muted-foreground transition-transform', !collapsed && 'rotate-180')}
                        aria-hidden="true"
                    />
                </button>
                {!collapsed && (
                    <div className="px-3 pb-3 flex flex-col gap-1.5 max-h-[10.5rem] overflow-y-auto">
                        {items.map((item) => (
                            <div key={item.id} className="flex min-w-0 items-center gap-2 py-1">
                                <span className="min-w-0 flex-1 truncate typography-ui-label text-foreground">
                                    {item.text}
                                </span>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="xs"
                                    disabled={Boolean(restoringId || forkingId)}
                                    onClick={() => { void handleFork(item.id); }}
                                >
                                    {forkingId === item.id ? (
                                        <Icon name="loader-4" className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    ) : (
                                        <Icon name="git-branch" className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    {t('chat.revertPopover.fork')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="xs"
                                    disabled={Boolean(restoringId || forkingId)}
                                    onClick={() => { void handleRestore(item.id); }}
                                >
                                    {restoringId === item.id ? (
                                        <Icon name="loader-4" className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    ) : (
                                        <Icon name="arrow-go-forward" className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    {t('chat.revertPopover.restore')}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

RevertedMessageDock.displayName = 'RevertedMessageDock';

type ComposerAttachmentControlsProps = {
    isMobile: boolean;
    isVSCode: boolean;
    footerIconButtonClass: string;
    iconSizeClass: string;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    handleLocalFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
    handlePickLocalFiles: () => void;
    handleOpenCommandMenu: () => void;
    openIssuePicker: () => void;
    openPrPicker: () => void;
    onOpenSettings?: () => void;
};

const ComposerAttachmentControls = React.memo(function ComposerAttachmentControls(props: ComposerAttachmentControlsProps) {
    const { t } = useI18n();
    const {
        isMobile,
        isVSCode,
        footerIconButtonClass,
        iconSizeClass,
        fileInputRef,
        handleLocalFileSelect,
        handlePickLocalFiles,
        handleOpenCommandMenu,
        openIssuePicker,
        openPrPicker,
        onOpenSettings,
    } = props;

    return (
        <div className="flex items-center gap-x-1.5">
            {isMobile ? (
                <button
                    type="button"
                    className={cn(
                        footerIconButtonClass,
                        'rounded-md',
                        'hover:bg-interactive-hover/40'
                    )}
                    onPointerDownCapture={(event) => {
                        if (event.pointerType === 'touch') {
                            event.preventDefault();
                            event.stopPropagation();
                        }
                    }}
                    onClick={handleOpenCommandMenu}
                    title={t('chat.chatInput.actions.commands')}
                    aria-label={t('chat.chatInput.actions.commands')}
                >
                    <Icon name="command" className={cn(iconSizeClass)} />
                </button>
            ) : null}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleLocalFileSelect}
                accept="*/*"
            />

            <div className="relative inline-flex">
                {isVSCode ? (
                    <button
                        type="button"
                        className={footerIconButtonClass}
                        onClick={handlePickLocalFiles}
                        title={t('chat.chatInput.actions.attachFiles')}
                        aria-label={t('chat.chatInput.actions.attachFiles')}
                    >
                        <Icon name="attachment-2" className={cn(iconSizeClass, 'text-current')} />
                    </button>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className={footerIconButtonClass}
                                title={t('chat.chatInput.actions.addAttachment')}
                                aria-label={t('chat.chatInput.actions.addAttachment')}
                            >
                                <Icon name="add-circle" className={cn(iconSizeClass, 'text-current')} />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem
                                onSelect={() => {
                                    requestAnimationFrame(handlePickLocalFiles);
                                }}
                            >
                                <Icon name="attachment-2"/>
                                {t('chat.chatInput.actions.attachFiles')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() => {
                                    requestAnimationFrame(openIssuePicker);
                                }}
                            >
                                <Icon name="github"/>
                                {t('chat.chatInput.actions.linkGithubIssue')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() => {
                                    requestAnimationFrame(openPrPicker);
                                }}
                            >
                                <Icon name="git-pull-request"/>
                                {t('chat.chatInput.actions.linkGithubPr')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {onOpenSettings ? (
                <button
                    type="button"
                    onClick={onOpenSettings}
                    className={footerIconButtonClass}
                    title={t('chat.chatInput.actions.modelAgentSettings')}
                    aria-label={t('chat.chatInput.actions.modelAgentSettings')}
                >
                    <Icon name="ai-agent" className={cn(iconSizeClass, 'text-current')} />
                </button>
            ) : null}
        </div>
    );
}, (prev, next) => (
    prev.isMobile === next.isMobile
    && prev.isVSCode === next.isVSCode
    && prev.footerIconButtonClass === next.footerIconButtonClass
    && prev.iconSizeClass === next.iconSizeClass
    && prev.onOpenSettings === next.onOpenSettings
));

type PermissionAutoAcceptButtonProps = {
    footerIconButtonClass: string;
    iconSizeClass: string;
    permissionScopeSessionId: string | null;
    permissionAutoAcceptEnabled: boolean;
    handlePermissionAutoAcceptToggle: () => void;
    withTooltip?: boolean;
};

const PermissionAutoAcceptButton = React.memo(function PermissionAutoAcceptButton(props: PermissionAutoAcceptButtonProps) {
    const { t } = useI18n();
    const {
        footerIconButtonClass,
        iconSizeClass,
        permissionScopeSessionId,
        permissionAutoAcceptEnabled,
        handlePermissionAutoAcceptToggle,
        withTooltip = false,
    } = props;

    const ariaLabel = permissionAutoAcceptEnabled
        ? t('chat.chatInput.permissionAutoAccept.disable')
        : t('chat.chatInput.permissionAutoAccept.enable');
    const tooltipLabel = permissionAutoAcceptEnabled
        ? t('chat.chatInput.permissionAutoAccept.on')
        : t('chat.chatInput.permissionAutoAccept.off');

    const button = (
        <button
            type="button"
            onClick={handlePermissionAutoAcceptToggle}
            className={cn(
                footerIconButtonClass,
                'rounded-md hover:bg-transparent',
                !permissionScopeSessionId && 'opacity-30',
            )}
            onMouseDown={(event) => {
                event.preventDefault();
            }}
            onPointerDownCapture={(event) => {
                if (event.pointerType === 'touch') {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }}
            aria-pressed={permissionAutoAcceptEnabled}
            aria-label={ariaLabel}
            title={ariaLabel}
        >
            {permissionAutoAcceptEnabled ? (
                <Icon name="shield-check" className={cn(iconSizeClass)} style={{ color: 'var(--status-info)' }} />
            ) : (
                <Icon name="shield-user" className={cn(iconSizeClass)} />
            )}
        </button>
    );

    if (!withTooltip) {
        return button;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {button}
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
                {tooltipLabel}
            </TooltipContent>
        </Tooltip>
    );
});

type FocusModeButtonProps = {
    footerIconButtonClass: string;
    iconSizeClass: string;
    isExpandedInput: boolean;
    onToggle: () => void;
};

const FocusModeButton = React.memo(function FocusModeButton(props: FocusModeButtonProps) {
    const { footerIconButtonClass, iconSizeClass, isExpandedInput, onToggle } = props;
    const { t } = useI18n();

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        footerIconButtonClass,
                        'rounded-md',
                        isExpandedInput
                            ? 'text-primary'
                            : 'text-foreground hover:bg-[var(--interactive-hover)]/40'
                    )}
                    onMouseDown={(event) => {
                        event.preventDefault();
                    }}
                    onClick={onToggle}
                    aria-label={t('chat.chatInput.focusMode.toggleAria')}
                    aria-pressed={isExpandedInput}
                >
                    <Icon name="fullscreen" className={cn(iconSizeClass)} />
                </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
                <div className="flex flex-col gap-0.5 text-center">
                    <span>{t('chat.chatInput.focusMode.label')}</span>
                    <span className="font-mono opacity-60">
                        {isMacOS() ? '⌘⇧E' : 'Ctrl+Shift+E'}
                    </span>
                </div>
            </TooltipContent>
        </Tooltip>
    );
});

type ComposerActionButtonsProps = {
    isMobile: boolean;
    footerIconButtonClass: string;
    runningActionOffsetClass: string;
    sendIconSizeClass: string;
    stopIconSizeClass: string;
    canSend: boolean;
    canAbort: boolean;
    abortFeedbackActive: boolean;
    hasContent: boolean;
    currentSessionId: string | null;
    newSessionDraftOpen: boolean;
    onPrimaryAction: () => void;
    onQueueMessage: () => void;
    onSendNow: () => void;
    onInterruptAndSend: () => void;
    onAbort: () => void;
    queueModeEnabled: boolean;
};

const ComposerActionButtons = React.memo(function ComposerActionButtons(props: ComposerActionButtonsProps) {
    const {
        isMobile,
        footerIconButtonClass,
        runningActionOffsetClass,
        sendIconSizeClass,
        stopIconSizeClass,
        canSend,
        canAbort,
        abortFeedbackActive,
        hasContent,
        currentSessionId,
        newSessionDraftOpen,
        onPrimaryAction,
        onQueueMessage,
        onSendNow,
        onInterruptAndSend,
        onAbort,
        queueModeEnabled,
    } = props;
    const { t } = useI18n();
    const [isCtrlHeld, setIsCtrlHeld] = React.useState(false);

    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') setIsCtrlHeld(true);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if ((e.key === 'Control' || e.key === 'Meta') && !e.ctrlKey && !e.metaKey) {
                setIsCtrlHeld(false);
            }
        };
        const handleBlur = () => setIsCtrlHeld(false);

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    const ctrlKeyLabel = isMacOS() ? '⌘' : 'Ctrl';

    const defaultAction = queueModeEnabled
        ? t('chat.chatInput.actions.queueButton.queue')
        : t('chat.chatInput.actions.queueButton.send');

    const alternateAction = queueModeEnabled
        ? t('chat.chatInput.actions.queueButton.send')
        : t('chat.chatInput.actions.queueButton.queue');

    const tooltipText = isCtrlHeld
        ? t('chat.chatInput.actions.queueButton.ctrlEnter', { ctrlKey: ctrlKeyLabel, action: alternateAction })
        : t('chat.chatInput.actions.queueButton.enter', { action: defaultAction });

    const ariaLabel = isCtrlHeld
        ? t('chat.chatInput.actions.queueButton.ctrlEnter', { ctrlKey: ctrlKeyLabel, action: alternateAction })
        : t('chat.chatInput.actions.queueButton.enter', { action: defaultAction });

    const sendButton = (
        <button
            type={isMobile ? 'button' : 'submit'}
            disabled={!canSend || (!currentSessionId && !newSessionDraftOpen)}
            onClick={(event) => {
                if (!isMobile) {
                    return;
                }

                event.preventDefault();
                onPrimaryAction();
            }}
            className={cn(
                footerIconButtonClass,
                canSend && (currentSessionId || newSessionDraftOpen)
                    ? 'text-primary hover:text-primary'
                    : 'opacity-30'
            )}
            aria-label={t('chat.chatInput.actions.sendMessageAria')}
        >
            <Icon name="send-plane-2" className={cn(sendIconSizeClass)} />
        </button>
    );

    if (!canAbort) {
        return sendButton;
    }

    return (
        <div className="relative">
            {hasContent ? (
                <div className={cn(
                    'absolute z-20 bottom-full left-1/2 mb-1 flex items-center gap-1',
                    runningActionOffsetClass,
                )}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                disabled={!currentSessionId}
                                onClick={(event) => {
                                    if (isMobile) {
                                        event.preventDefault();
                                    }
                                    const isCtrlClick = event.ctrlKey || event.metaKey;
                                    if (isCtrlClick) {
                                        if (queueModeEnabled) {
                                            onSendNow();
                                        } else {
                                            onQueueMessage();
                                        }
                                    } else {
                                        onPrimaryAction();
                                    }
                                }}
                                className={cn(
                                    footerIconButtonClass,
                                    currentSessionId ? 'text-primary hover:text-primary' : 'opacity-30'
                                )}
                                aria-label={ariaLabel}
                            >
                                <Icon name="send-plane-2" className={cn(sendIconSizeClass, '-rotate-45')} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={8}>
                            {tooltipText}
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                disabled={!currentSessionId}
                                onClick={(event) => {
                                    if (isMobile) {
                                        event.preventDefault();
                                    }
                                    onInterruptAndSend();
                                }}
                                className={cn(
                                    footerIconButtonClass,
                                    currentSessionId
                                        ? 'text-[var(--status-warning)] hover:bg-[var(--status-warning)]/10 hover:text-[var(--status-warning)]'
                                        : 'opacity-30'
                                )}
                                aria-label={t('chat.chatInput.actions.interruptAndSendAria')}
                            >
                                <Icon name="flashlight" className={cn(sendIconSizeClass)} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={8}>
                            {t('chat.chatInput.actions.interruptAndSendTooltip')}
                        </TooltipContent>
                    </Tooltip>
                </div>
            ) : null}
            <button
                type="button"
                onClick={onAbort}
                className={cn(
                    footerIconButtonClass,
                    'rounded-full',
                    abortFeedbackActive
                        ? 'bg-[var(--status-error)] text-[var(--status-error-foreground)] hover:bg-[var(--status-error)] hover:text-[var(--status-error-foreground)]'
                        : 'text-[var(--status-error)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]'
                )}
                aria-label={t('chat.chatInput.actions.stopGeneratingAria')}
            >
                <StopIcon className={cn(stopIconSizeClass)} />
            </button>
        </div>
    );
}, (prev, next) => (
    prev.isMobile === next.isMobile
    && prev.footerIconButtonClass === next.footerIconButtonClass
    && prev.runningActionOffsetClass === next.runningActionOffsetClass
    && prev.sendIconSizeClass === next.sendIconSizeClass
    && prev.stopIconSizeClass === next.stopIconSizeClass
    && prev.canSend === next.canSend
    && prev.canAbort === next.canAbort
    && prev.abortFeedbackActive === next.abortFeedbackActive
    && prev.hasContent === next.hasContent
    && prev.currentSessionId === next.currentSessionId
    && prev.newSessionDraftOpen === next.newSessionDraftOpen
    && prev.queueModeEnabled === next.queueModeEnabled
    && prev.onPrimaryAction === next.onPrimaryAction
    && prev.onQueueMessage === next.onQueueMessage
    && prev.onSendNow === next.onSendNow
    && prev.onInterruptAndSend === next.onInterruptAndSend
    && prev.onAbort === next.onAbort
));

const appendWithLineBreaks = (base: string, next: string): string => {
    const separator = !base
        ? ''
        : base.endsWith('\n\n')
            ? ''
            : base.endsWith('\n')
                ? '\n'
                : '\n\n';

    const nextWithTrailingBreaks = next.endsWith('\n\n')
        ? next
        : next.endsWith('\n')
            ? `${next}\n`
            : `${next}\n\n`;

    return `${base}${separator}${nextWithTrailingBreaks}`;
};

const appendInlineText = (base: string, next: string): string => {
    const nextTrimmed = next.trim();
    if (!nextTrimmed) {
        return base;
    }
    if (!base) {
        return `${nextTrimmed} `;
    }
    const separator = /[\s\n]$/.test(base) ? '' : ' ';
    return `${base}${separator}${nextTrimmed} `;
};

interface ChatInputProps {
    onOpenSettings?: () => void;
    scrollToBottom?: () => void;
}

type AutocompleteOverlayPosition = {
    top: number;
    left: number;
    place: 'above' | 'below';
    maxHeight: number;
};

// Per-session draft key — preserves in-progress messages across project switches
const getDraftKey = (sessionId: string | null): string =>
    `openchamber_chat_input_draft_${sessionId ?? 'new'}`;

// Helper to safely read from localStorage for a given session
const getStoredDraft = (sessionId: string | null): string => {
    try {
        return localStorage.getItem(getDraftKey(sessionId)) ?? '';
    } catch {
        return '';
    }
};

// Helper to safely write/clear a per-session draft
const saveStoredDraft = (sessionId: string | null, draft: string): void => {
    try {
        if (draft) {
            localStorage.setItem(getDraftKey(sessionId), draft);
        } else {
            localStorage.removeItem(getDraftKey(sessionId));
        }
    } catch {
        // Ignore localStorage errors
    }
};

// Per-session confirmed mentions key — tracks which @mentions are confirmed (blue) vs plain text
const getConfirmedMentionsKey = (sessionId: string | null): string =>
    `openchamber_chat_confirmed_mentions_${sessionId ?? 'new'}`;

const saveConfirmedMentions = (sessionId: string | null, mentions: Set<string>): void => {
    try {
        if (mentions.size > 0) {
            localStorage.setItem(getConfirmedMentionsKey(sessionId), JSON.stringify([...mentions]));
        } else {
            localStorage.removeItem(getConfirmedMentionsKey(sessionId));
        }
    } catch {
        // Ignore localStorage errors
    }
};

const loadConfirmedMentions = (sessionId: string | null): Set<string> => {
    try {
        const raw = localStorage.getItem(getConfirmedMentionsKey(sessionId));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return new Set(parsed.filter((v): v is string => typeof v === 'string'));
            }
        }
    } catch {
        // Ignore localStorage errors
    }
    return new Set();
};

const mergeFailedDraftText = (currentDraft: string, failedDraft: string): string => {
    if (!failedDraft.trim()) {
        return currentDraft;
    }
    if (!currentDraft.trim()) {
        return failedDraft;
    }
    if (currentDraft.includes(failedDraft)) {
        return currentDraft;
    }
    const separator = failedDraft.endsWith('\n') ? '\n' : '\n\n';
    return `${failedDraft}${separator}${currentDraft}`;
};

const restoreQueuedMessages = (sessionId: string, snapshot: QueuedMessage[]): void => {
    useMessageQueueStore.getState().restoreMessages(sessionId, snapshot);
};

const restoreInlineDrafts = (sessionKey: string, drafts: InlineCommentDraft[]): void => {
    if (drafts.length === 0) {
        return;
    }

    useInlineCommentDraftStore.setState((state) => {
        const currentDrafts = state.drafts[sessionKey] ?? [];
        const currentIds = new Set(currentDrafts.map((draft) => draft.id));
        const missingDrafts = drafts.filter((draft) => !currentIds.has(draft.id));
        if (missingDrafts.length === 0) {
            return state;
        }

        const restoredDrafts = [...currentDrafts, ...missingDrafts]
            .sort((a, b) => a.createdAt - b.createdAt);

        return {
            drafts: {
                ...state.drafts,
                [sessionKey]: restoredDrafts,
            },
        };
    });
};

const ChatInputComponent: React.FC<ChatInputProps> = ({ onOpenSettings, scrollToBottom }) => {
    const { t } = useI18n();
    // Track if we restored a draft on mount (for text selection)
    const initialDraftRef = React.useRef<string | null>(null);
    // Track initial session ID (captured at mount time for draft restoration)
    const initialSessionIdRef = React.useRef<string | null>(null);
    const [message, setMessage] = React.useState(() => {
        // Read per-session draft at mount time using the current session from the store
        const sessionId = useSessionUIStore.getState().currentSessionId;
        initialSessionIdRef.current = sessionId;

        const pending = useInputStore.getState().pendingInputText;
        if (pending !== null && pending.length > 0) {
            useInputStore.getState().consumePendingInputText();
            return pending;
        }

        const draft = getStoredDraft(sessionId);
        if (draft) {
            initialDraftRef.current = draft;
        }
        return draft;
    });
    // Restore confirmed mentions from localStorage on mount
    const confirmedMentionsRef = React.useRef<Set<string>>(loadConfirmedMentions(initialSessionIdRef.current));
    // Helper: check if a mention path looks like a file/folder (has path separators, extension, or was explicitly confirmed)
    const isConfirmedFilePath = (text: string): boolean =>
        text.includes('/') || text.includes('\\') || text.includes('.') || confirmedMentionsRef.current.has(text);
    const [inputMode, setInputMode] = React.useState<'normal' | 'shell'>('normal');
    const [isDragging, setIsDragging] = React.useState(false);
    const [isInternalDrag, setIsInternalDrag] = React.useState(false);
    const [showFileMention, setShowFileMention] = React.useState(false);
    const [mentionQuery, setMentionQuery] = React.useState('');
    const [showCommandAutocomplete, setShowCommandAutocomplete] = React.useState(false);
    const [commandQuery, setCommandQuery] = React.useState('');
    const [autocompleteTab, setAutocompleteTab] = React.useState<'commands' | 'agents' | 'files'>('commands');
    const [showSkillAutocomplete, setShowSkillAutocomplete] = React.useState(false);
    const [skillQuery, setSkillQuery] = React.useState('');
    const [showSnippetAutocomplete, setShowSnippetAutocomplete] = React.useState(false);
    const [snippetQuery, setSnippetQuery] = React.useState('');
    const [textareaSize, setTextareaSize] = React.useState<{ height: number; maxHeight: number } | null>(null);
    const [mobileControlsPanel, setMobileControlsPanel] = React.useState<MobileControlsPanel>(null);
    // Message history navigation state (up/down arrow to recall previous messages)
    const [historyIndex, setHistoryIndex] = React.useState(-1); // -1 = not browsing, 0+ = index from most recent
    const [draftMessage, setDraftMessage] = React.useState(''); // Preserves input when entering history mode
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const cursorPosRef = React.useRef(0);
    const previousMessageLengthRef = React.useRef(message.length);
    const dropZoneRef = React.useRef<HTMLDivElement>(null);
    const dragEnterCountRef = React.useRef(0);
    const suppressNextFileDropTextInsertRef = React.useRef(false);
    const suppressNextFileDropTextInsertTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingDroppedAbsolutePathsRef = React.useRef<string[]>([]);
    const presetSubmitTextRef = React.useRef<string | null>(null);
    const mentionRef = React.useRef<FileMentionHandle>(null);
    const commandRef = React.useRef<CommandAutocompleteHandle>(null);
    const skillRef = React.useRef<SkillAutocompleteHandle>(null);
    const snippetRef = React.useRef<SnippetAutocompleteHandle>(null);
    // Ref to track current message value without triggering re-renders in effects
    const messageRef = React.useRef(message);
    const draftPersistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const skipNextDraftPersistRef = React.useRef(false);
    const lastPersistedDraftRef = React.useRef<Map<string, string>>(new Map());
    const currentSessionIdForDraftRef = React.useRef<string | null>(null);
    const pendingPastedAttachmentFilenamesRef = React.useRef<Set<string>>(new Set());

    // TODO: port sendMessage to session-actions (complex — creates sessions, handles attachments, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sendMessage = React.useRef((...args: any[]) =>
        Promise.resolve((useSessionUIStore.getState().sendMessage as (...a: unknown[]) => unknown)(...args)),
    ).current;
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const currentDirectory = useDirectoryStore((s) => s.currentDirectory);
    const currentSessionDirectoryForSync = useSessionUIStore(
        React.useCallback((s) => currentSessionId ? s.getDirectoryForSession(currentSessionId) : null, [currentSessionId]),
    );
    const newSessionDraft = useSessionUIStore((s) => s.newSessionDraft);
    const newSessionDraftOpen = Boolean(newSessionDraft?.open);
    const setNewSessionDraftTarget = useSessionUIStore((s) => s.setNewSessionDraftTarget);
    const availableWorktreesByProject = useSessionUIStore((s) => s.availableWorktreesByProject);
    const abortPromptSessionId = useSessionUIStore((s) => s.abortPromptSessionId);
    const clearAbortPrompt = useSessionUIStore((s) => s.clearAbortPrompt);
    const attachedFiles = useInputStore((s) => s.attachedFiles);
    const addAttachedFile = useInputStore((s) => s.addAttachedFile);
    const clearAttachedFiles = useInputStore((s) => s.clearAttachedFiles);
    const saveSessionAgentSelection = useSelectionStore((s) => s.saveSessionAgentSelection);
    const consumePendingInputText = useInputStore((s) => s.consumePendingInputText);
    const setPendingInputText = useInputStore((s) => s.setPendingInputText);
    const pendingInputText = useInputStore((s) => s.pendingInputText);
    const pendingPresetSubmit = useInputStore((s) => s.pendingPresetSubmit);
    const consumePendingPresetSubmit = useInputStore((s) => s.consumePendingPresetSubmit);
    const consumePendingSyntheticParts = useInputStore((s) => s.consumePendingSyntheticParts);
    const abortCurrentOperation = React.useCallback(
        (sessionIdOverride?: string) => sessionActions.abortCurrentOperation(sessionIdOverride ?? currentSessionId ?? ''),
        [currentSessionId],
    );
    const currentManagementSessionId = currentSessionId;
    const projects = useProjectsStore((state) => state.projects);
    const activeProjectId = useProjectsStore((state) => state.activeProjectId);
    const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);

    const currentProviderId = useConfigStore((state) => state.currentProviderId);
    const currentModelId = useConfigStore((state) => state.currentModelId);
    const currentVariant = useConfigStore((state) => state.currentVariant);
    const currentAgentName = useConfigStore((state) => state.currentAgentName);
    const setAgent = useConfigStore((state) => state.setAgent);
    const getVisibleAgents = useConfigStore((state) => state.getVisibleAgents);
    const agents = getVisibleAgents();
    const isMobile = useUIStore((state) => state.isMobile);
    const inputBarOffset = useUIStore((state) => state.inputBarOffset);
    const persistChatDraft = useUIStore((state) => state.persistChatDraft);
    const inputSpellcheckEnabled = useUIStore((state) => state.inputSpellcheckEnabled);
    const isExpandedInput = useUIStore((state) => state.isExpandedInput);
    const setExpandedInput = useUIStore((state) => state.setExpandedInput);
    const setTimelineDialogOpen = useUIStore((state) => state.setTimelineDialogOpen);
    const cycleAgentShortcutOverride = useUIStore((state) => state.shortcutOverrides.cycle_agent);
    const cycleAgentShortcut = React.useMemo(() => (
        getEffectiveShortcutCombo('cycle_agent', cycleAgentShortcutOverride ? { cycle_agent: cycleAgentShortcutOverride } : undefined)
    ), [cycleAgentShortcutOverride]);
    const { git: runtimeGit } = useRuntimeAPIs();
    const { currentTheme } = useThemeSystem();
    const chatSearchDirectory = useChatSearchDirectory();
    const isGitRepo = useIsGitRepo(currentDirectory);
    const currentGitStatus = useGitStore((state) =>
        currentDirectory ? state.directories.get(currentDirectory)?.status ?? null : null,
    );
    const [abortFeedbackActive, setAbortFeedbackActive] = React.useState(false);
    const setSessionAutoAccept = usePermissionStore((state) => state.setSessionAutoAccept);
    const composerHighlightRef = React.useRef<HTMLDivElement | null>(null);
    const [isNarrowComposer, setIsNarrowComposer] = React.useState(false);

    const isDesktopExpanded = isExpandedInput && !isMobile;
    const chatInputRadius = 'var(--radius-xl)';
    const useCompactChatPlaceholder = isMobile || isNarrowComposer;

    React.useEffect(() => {
        const element = dropZoneRef.current;
        if (!element) return;

        const updateWidth = (width: number) => {
            const next = width > 0 && width < COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH;
            setIsNarrowComposer((prev) => (prev === next ? prev : next));
        };

        updateWidth(element.clientWidth);

        if (typeof ResizeObserver === 'undefined') {
            const handleResize = () => updateWidth(element.clientWidth);
            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        }

        const observer = new ResizeObserver((entries) => {
            updateWidth(entries[0]?.contentRect.width ?? element.clientWidth);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const sendableAttachedFiles = attachedFiles;

    const getModelMetadata = useConfigStore((s) => s.getModelMetadata);
    const currentModelMetadata = currentProviderId && currentModelId
        ? getModelMetadata(currentProviderId, currentModelId)
        : undefined;
    const currentModelSupportsImages = currentModelMetadata?.modalities?.input?.includes('image')
        ?? currentModelMetadata?.attachment
        ?? true;
    const hasImageAttachments = attachedFiles.some((f) => f.mimeType.startsWith('image/'));
    const showImageFallbackNotice = hasImageAttachments && !currentModelSupportsImages;

    const [pluginLoaded, setPluginLoaded] = React.useState<boolean | null>(null);
    React.useEffect(() => {
      fetch('/api/openchamber/plugin-status').then(r => r.json()).then((data: { loaded?: boolean }) => {
        setPluginLoaded(data.loaded === true);
      }).catch(() => setPluginLoaded(null));
    }, []);

    const knownAgentNames = React.useMemo(
        () => new Set(agents.map((agent) => agent.name.toLowerCase())),
        [agents]
    );
    const knownAgentNamesRef = React.useRef(knownAgentNames);
    knownAgentNamesRef.current = knownAgentNames;

    const availableCommands = useCommandsStore((s) => s.commands);
    const availableSkills = useSkillsStore((s) => s.skills);
    const knownSlashNames = React.useMemo(() => {
        const names = new Set<string>([
            'init',
            'review',
            'undo',
            'redo',
            'timeline',
            'compact',
            'summary',
            'workspace-review',
            ...Object.keys(GUIDED_SESSION_COMMANDS),
        ]);
        if (!isMobile && !isVSCodeRuntime()) names.add('handoff-review');
        for (const command of availableCommands) names.add(command.name.toLowerCase());
        for (const skill of availableSkills) names.add(skill.name.toLowerCase());
        return names;
    }, [availableCommands, availableSkills, isMobile]);

    const composerCommandRanges = React.useMemo<HighlightRange[]>(() => {
        if (!message || !message.includes('/') || inputMode === 'shell' || knownSlashNames.size === 0) {
            return [];
        }
        const ranges: HighlightRange[] = [];
        const slashRegex = /(^|\s)\/([A-Za-z0-9][A-Za-z0-9_-]*)/g;
        let match: RegExpExecArray | null;
        while ((match = slashRegex.exec(message)) !== null) {
            const name = match[2];
            if (!knownSlashNames.has(name.toLowerCase())) {
                continue;
            }
            const slashStart = match.index + match[1].length;
            ranges.push({ start: slashStart, end: slashStart + 1 + name.length, style: 'mentionCommand' });
        }
        return ranges;
    }, [inputMode, knownSlashNames, message]);

    const availableSnippets = useSnippetsStore((s) => s.snippets);
    const knownSnippetTriggers = React.useMemo(() => {
        const triggers = new Set<string>();
        for (const snippet of availableSnippets) {
            triggers.add(snippet.name.toLowerCase());
            for (const alias of snippet.aliases ?? []) triggers.add(alias.toLowerCase());
        }
        return triggers;
    }, [availableSnippets]);

    const composerSnippetRanges = React.useMemo<HighlightRange[]>(() => {
        if (!message || !message.includes('#') || inputMode === 'shell' || knownSnippetTriggers.size === 0) {
            return [];
        }
        const ranges: HighlightRange[] = [];
        const snippetRegex = /(^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/g;
        let match: RegExpExecArray | null;
        while ((match = snippetRegex.exec(message)) !== null) {
            const trigger = match[2];
            if (!knownSnippetTriggers.has(trigger.toLowerCase())) {
                continue;
            }
            const hashStart = match.index + match[1].length;
            ranges.push({ start: hashStart, end: hashStart + 1 + trigger.length, style: 'mentionSnippet' });
        }
        return ranges;
    }, [inputMode, knownSnippetTriggers, message]);

    const composerMentionRanges = React.useMemo<MentionRange[]>(() => {
        if (!message || !message.includes('@') || inputMode === 'shell') {
            return [];
        }
        const ranges: MentionRange[] = [];
        const mentionRegex = /@([^\s]+)/g;
        let match: RegExpExecArray | null;
        while ((match = mentionRegex.exec(message)) !== null) {
            const full = match[0];
            const mention = String(match[1] || '').trim().replace(/[),.;:!?`"'>]+$/g, '');
            const start = match.index;
            const end = start + full.length;
            const charBefore = start > 0 ? message[start - 1] : null;
            const isBoundary = !charBefore || /(\s|\(|\)|\[|\]|\{|\}|"|'|`|,|\.|;|:)/.test(charBefore);
            if (!isBoundary || mention.length === 0) {
                continue;
            }
            if (knownAgentNames.has(mention.toLowerCase())) {
                ranges.push({ start, end, kind: 'agent' });
            } else if (isConfirmedFilePath(mention)) {
                ranges.push({ start, end, kind: 'file' });
            }
        }
        return ranges;
    }, [inputMode, message, knownAgentNames]);

    const attachmentCitationRanges = React.useMemo<HighlightRange[]>(() => {
        if (!message || !message.includes('[') || inputMode === 'shell' || sendableAttachedFiles.length === 0) {
            return [];
        }

        return findAttachmentCitationRanges(
            message,
            sendableAttachedFiles.map((file) => file.filename),
        ).map((range) => ({
            ...range,
            style: 'mentionFile' as const,
        }));
    }, [inputMode, message, sendableAttachedFiles]);

    const highlightedComposerContent = React.useMemo(() => {
        if (!message || inputMode === 'shell') {
            return null;
        }
        const ranges = [
            ...tokenizeMarkdown(message),
            ...highlightFencedCode(message),
            ...mentionRangesToHighlightRanges(composerMentionRanges),
            ...composerCommandRanges,
            ...composerSnippetRanges,
            ...attachmentCitationRanges,
        ];
        return buildHighlightParts(message, ranges);
    }, [attachmentCitationRanges, composerCommandRanges, composerSnippetRanges, composerMentionRanges, inputMode, message]);

    const sanitizeAttachmentsForSend = React.useCallback(
        (files: AttachedFile[] | undefined): AttachedFile[] => (files ?? [])
            .map((file) => ({
                ...file,
                dataUrl: file.source === 'server' && file.serverPath
                    ? toServerFileUrl(file.serverPath)
                    : file.dataUrl,
            })),
        [],
    );

    const extractInlineFileMentions = React.useCallback((rawText: string): { sanitizedText: string; attachments: AttachedFile[] } => {
        if (!rawText || !rawText.includes('@')) {
            return { sanitizedText: rawText, attachments: [] };
        }

        const clientDirectory = opencodeClient.getDirectory() || '';
        const root = (chatSearchDirectory || clientDirectory).replace(/\\/g, '/').replace(/\/+$/, '');
        const seenPaths = new Set<string>();
        const attachments: AttachedFile[] = [];

        const mentionRegex = /@([^\s]+)/g;
        let match: RegExpExecArray | null;
        while ((match = mentionRegex.exec(rawText)) !== null) {
            const rawMentionPath = match[1];
            const offset = match.index;
            const original = rawText;
            const charBefore = offset > 0 ? original[offset - 1] : null;
            if (charBefore && !/(\s|\(|\)|\[|\]|\{|\}|"|'|`|,|\.|;|:)/.test(charBefore)) {
                continue;
            }

            const mentionPath = String(rawMentionPath || '')
                .trim()
                .replace(/^[`"'<(]+/, '')
                .replace(/[),.;:!?`"'>]+$/g, '');
            if (!mentionPath) {
                continue;
            }

            if (knownAgentNamesRef.current.has(mentionPath.toLowerCase())) {
                continue;
            }

            const looksLikeFilePath = isConfirmedFilePath(mentionPath);
            if (!looksLikeFilePath) {
                continue;
            }

            const normalizedMentionPath = mentionPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
            if (!normalizedMentionPath) {
                continue;
            }

            const serverPath = mentionPath.startsWith('/')
                ? mentionPath.replace(/\\/g, '/')
                : root
                    ? `${root}/${normalizedMentionPath}`
                    : null;

            if (!serverPath) {
                continue;
            }

            const normalizedServerPath = serverPath.replace(/\/+/g, '/');
            if (seenPaths.has(normalizedServerPath)) {
                continue;
            }
            seenPaths.add(normalizedServerPath);

            const filename = normalizedMentionPath.split('/').filter(Boolean).pop() || normalizedMentionPath;
            attachments.push({
                id: `inline-server-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                file: new File([], filename, { type: 'text/plain' }),
                filename,
                mimeType: 'text/plain',
                size: 0,
                dataUrl: toServerFileUrl(normalizedServerPath),
                source: 'server',
                serverPath: normalizedServerPath,
            });
        }

        return {
            sanitizedText: rawText,
            attachments,
        };
    }, [chatSearchDirectory]);
    const [autocompleteOverlayPosition, setAutocompleteOverlayPosition] = React.useState<AutocompleteOverlayPosition | null>(null);
    const abortFeedbackTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Issue linking state
    const [issuePickerOpen, setIssuePickerOpen] = React.useState(false);
    const [prPickerOpen, setPrPickerOpen] = React.useState(false);
    const [linkedIssue, setLinkedIssue] = React.useState<{ 
        number: number; 
        title: string; 
        url: string; 
        contextText: string;
        author?: { login: string; avatarUrl?: string };
    } | null>(null);
    const [linkedPr, setLinkedPr] = React.useState<{
        number: number;
        title: string;
        url: string;
        head: string;
        base: string;
        includeDiff: boolean;
        instructionsText: string;
        contextText: string;
        author?: { login: string; avatarUrl?: string };
    } | null>(null);

    // Message queue
    const queueModeEnabled = useMessageQueueStore((state) => state.queueModeEnabled);
    const queuedMessages = useMessageQueueStore(
        React.useCallback(
            (state) => {
                if (!currentSessionId) return EMPTY_QUEUE;
                return state.queuedMessages[currentSessionId] ?? EMPTY_QUEUE;
            },
            [currentSessionId]
        )
    );
    const addToQueue = useMessageQueueStore((state) => state.addToQueue);
    const removeFromQueue = useMessageQueueStore((state) => state.removeFromQueue);
    const clearQueue = useMessageQueueStore((state) => state.clearQueue);

    // Inline comment drafts
    const draftCount = useInlineCommentDraftStore(
        React.useCallback(
            (state) => {
                const sessionKey = currentSessionId ?? (newSessionDraftOpen ? 'draft' : '');
                if (!sessionKey) return 0;
                return (state.drafts[sessionKey] ?? []).length;
            },
            [currentSessionId, newSessionDraftOpen]
        )
    );
    const draftSourceKey = useInlineCommentDraftStore(
        React.useCallback(
            (state) => {
                const sessionKey = currentSessionId ?? (newSessionDraftOpen ? 'draft' : '');
                const drafts = sessionKey ? (state.drafts[sessionKey] ?? []) : [];
                let previewConsole = 0;
                let previewAnnotation = 0;
                let review = 0;
                for (const draft of drafts) {
                    if (draft.source === 'preview-console') previewConsole += 1;
                    else if (draft.source === 'preview-annotation') previewAnnotation += 1;
                    else review += 1;
                }
                return `${previewConsole}:${previewAnnotation}:${review}`;
            },
            [currentSessionId, newSessionDraftOpen]
        )
    );
    const consumeDrafts = useInlineCommentDraftStore((state) => state.consumeDrafts);
    const removeInlineCommentDraft = useInlineCommentDraftStore((state) => state.removeDraft);
    const hasDrafts = draftCount > 0;
    const [previewConsoleCount, previewAnnotationCount, reviewCount] = draftSourceKey.split(':').map((entry) => Number(entry) || 0);
    const removePreviewDrafts = React.useCallback((source: 'preview-console' | 'preview-annotation') => {
        const sessionKey = currentSessionId ?? (newSessionDraftOpen ? 'draft' : '');
        if (!sessionKey) return;
        const drafts = useInlineCommentDraftStore.getState().drafts[sessionKey] ?? [];
        for (const draft of drafts) {
            if (draft.source === source) {
                removeInlineCommentDraft(sessionKey, draft.id);
            }
        }
    }, [currentSessionId, newSessionDraftOpen, removeInlineCommentDraft]);

    // User message history for up/down arrow navigation.
    // Keep this on a narrow hook instead of full session message records.
    const userMessageHistory = useUserMessageHistory(currentSessionId ?? "");

    // Keep messageRef in sync with message state
    React.useEffect(() => {
        messageRef.current = message;
    }, [message]);

    React.useEffect(() => {
        currentSessionIdForDraftRef.current = currentSessionId;
    }, [currentSessionId]);

    const persistDraftImmediately = React.useCallback((sessionId: string | null, draft: string) => {
        const key = getDraftKey(sessionId);
        const lastPersisted = lastPersistedDraftRef.current.get(key);
        if (lastPersisted === draft) {
            return;
        }

        saveStoredDraft(sessionId, draft);
        // Only persist confirmed mentions that are actually present in the draft text
        const activeMentions = new Set<string>();
        for (const mention of confirmedMentionsRef.current) {
            if (draft.includes(`@${mention}`)) {
                activeMentions.add(mention);
            }
        }
        confirmedMentionsRef.current = activeMentions;
        saveConfirmedMentions(sessionId, activeMentions);
        lastPersistedDraftRef.current.set(key, draft);
    }, []);

    const clearPendingDraftPersist = React.useCallback(() => {
        if (!draftPersistTimerRef.current) {
            return;
        }
        clearTimeout(draftPersistTimerRef.current);
        draftPersistTimerRef.current = null;
    }, []);

    // Handle initial draft restoration and text selection
    const hasHandledInitialDraftRef = React.useRef(false);
    React.useEffect(() => {
        if (hasHandledInitialDraftRef.current) return;
        hasHandledInitialDraftRef.current = true;

        const draft = initialDraftRef.current;
        if (!draft) return;

        if (!persistChatDraft) {
            // Setting disabled - clear the restored draft
            setMessage('');
            try {
                localStorage.removeItem(getDraftKey(initialSessionIdRef.current));
            } catch {
                // Ignore
            }
        } else {
            // Setting enabled - select all text
            requestAnimationFrame(() => {
                textareaRef.current?.select();
            });
        }
    }, [persistChatDraft]);

    // Handle session switching: save draft for old session, restore draft for new session
    const prevSessionIdRef = React.useRef(currentSessionId);
    React.useEffect(() => {
        if (prevSessionIdRef.current !== currentSessionId) {
            const oldSessionId = prevSessionIdRef.current;
            prevSessionIdRef.current = currentSessionId;
            setInputMode('normal');
            clearPendingDraftPersist();
            skipNextDraftPersistRef.current = true;

            if (persistChatDraft) {
                // Save current draft for the session we're leaving
                persistDraftImmediately(oldSessionId, messageRef.current);
                // Restore draft for the session we're entering
                const newDraft = getStoredDraft(currentSessionId);
                setMessage(newDraft);
                confirmedMentionsRef.current = loadConfirmedMentions(currentSessionId);
                if (newDraft) {
                    requestAnimationFrame(() => {
                        textareaRef.current?.select();
                    });
                }
            } else {
                // Persist disabled: clear input without saving
                setMessage('');
                confirmedMentionsRef.current = new Set();
            }
        }
    }, [clearPendingDraftPersist, currentSessionId, persistChatDraft, persistDraftImmediately]);

    // Focus textarea when new session draft is opened
    const prevNewSessionDraftOpenRef = React.useRef(newSessionDraftOpen);
    React.useEffect(() => {
        if (!prevNewSessionDraftOpenRef.current && newSessionDraftOpen) {
            // New session draft just opened - focus the textarea
            requestAnimationFrame(() => {
                if (isMobile) {
                    // On mobile, use preventScroll to avoid viewport jumping
                    textareaRef.current?.focus({ preventScroll: true });
                } else {
                    textareaRef.current?.focus();
                }
            });
        }
        prevNewSessionDraftOpenRef.current = newSessionDraftOpen;
    }, [newSessionDraftOpen, isMobile]);

    // Persist chat input draft to localStorage per session (only if setting enabled)
    React.useEffect(() => {
        if (!persistChatDraft) {
            clearPendingDraftPersist();
            persistDraftImmediately(currentSessionId, '');
            return;
        }

        if (skipNextDraftPersistRef.current) {
            skipNextDraftPersistRef.current = false;
            return;
        }

        clearPendingDraftPersist();
        const draftSnapshot = message;
        const sessionSnapshot = currentSessionId;
        draftPersistTimerRef.current = setTimeout(() => {
            draftPersistTimerRef.current = null;
            persistDraftImmediately(sessionSnapshot, draftSnapshot);
        }, CHAT_DRAFT_PERSIST_DEBOUNCE_MS);

        return () => {
            clearPendingDraftPersist();
        };
    }, [clearPendingDraftPersist, currentSessionId, message, persistChatDraft, persistDraftImmediately]);

    React.useEffect(() => {
        return () => {
            clearPendingDraftPersist();
            if (persistChatDraft) {
                persistDraftImmediately(currentSessionIdForDraftRef.current, messageRef.current);
            }
        };
    }, [clearPendingDraftPersist, persistChatDraft, persistDraftImmediately]);

    // Session activity for queue availability and controls
    const { phase: sessionPhase } = useCurrentSessionActivity();

    const handleOpenMobilePanel = React.useCallback((panel: MobileControlsPanel) => {
        if (!isMobile) {
            return;
        }
        textareaRef.current?.blur();
        requestAnimationFrame(() => {
            setMobileControlsPanel(panel);
        });
    }, [isMobile]);

    // Consume pending input text (e.g., from revert action)
    React.useEffect(() => {
        if (pendingInputText !== null) {
            const pending = consumePendingInputText();
            if (pending?.text) {
                if (pending.mode === 'append') {
                    setMessage((prev) => {
                        const next = pending.text;
                        if (!next.trim()) return prev;
                        return appendWithLineBreaks(prev, next);
                    });
                } else if (pending.mode === 'append-inline') {
                    setMessage((prev) => appendInlineText(prev, pending.text));
                } else {
                    setMessage(pending.text);
                }
                // Focus textarea after setting message
                setTimeout(() => {
                    textareaRef.current?.focus();
                }, 0);
            }
        }
    }, [pendingInputText, consumePendingInputText]);

    React.useEffect(() => {
        if (pendingPresetSubmit === null) {
            return;
        }

        const preset = consumePendingPresetSubmit();
        if (!preset?.trim()) {
            return;
        }

        presetSubmitTextRef.current = preset;
        messageRef.current = preset;
        setMessage(preset);

        const submit = () => {
            void handleSubmitRef.current();
        };
        if (typeof window === 'undefined') {
            submit();
        } else {
            window.requestAnimationFrame(submit);
        }
    }, [pendingPresetSubmit, consumePendingPresetSubmit]);

    const hasContent = message.trim().length > 0 || sendableAttachedFiles.length > 0 || hasDrafts;
    const hasQueuedMessages = queuedMessages.length > 0;
    const canSend = hasContent || hasQueuedMessages;

    const canAbort = sessionPhase !== 'idle';

    const getCurrentInputSnapshot = React.useCallback(() => {
        const currentMessage = presetSubmitTextRef.current ?? textareaRef.current?.value ?? message;
        return {
            message: currentMessage,
            hasContent: currentMessage.trim().length > 0 || sendableAttachedFiles.length > 0 || hasDrafts,
        };
    }, [hasDrafts, message, sendableAttachedFiles.length]);

    // Keep a ref to handleSubmit so callbacks don't depend on it.
    type SubmitOptions = {
        queuedOnly?: boolean;
        queuedMessageId?: string;
        deliveryMode?: SendDeliveryMode;
    };
    const handleSubmitRef = React.useRef<(options?: SubmitOptions) => Promise<void>>(async () => {});

    // Add message to queue instead of sending
    const handleQueueMessage = React.useCallback(() => {
        const inputSnapshot = getCurrentInputSnapshot();
        if (!inputSnapshot.hasContent || !currentSessionId) return;

        const drafts = consumeDrafts(currentSessionId);

        let messageToQueue = inputSnapshot.message.replace(/^\n+|\n+$/g, '');
        if (drafts.length > 0) {
            messageToQueue = appendInlineComments(messageToQueue, drafts);
        }
        const attachmentsToQueue = sanitizeAttachmentsForSend(sendableAttachedFiles);
        const queueDirectory = normalizePath(
            useSessionUIStore.getState().getDirectoryForSession(currentSessionId)
            ?? currentSessionDirectoryForSync
            ?? currentDirectory,
        );
        const queueProject = queueDirectory
            ? resolveProjectForSessionDirectory(projects, availableWorktreesByProject, queueDirectory)
            : null;
        const queueServerId = serverRegistry.getServerForSession(currentSessionId)
            ?? queueProject?.serverId
            ?? undefined;

        addToQueue(currentSessionId, {
            content: messageToQueue,
            attachments: attachmentsToQueue.length > 0 ? attachmentsToQueue : undefined,
            sendTarget: queueDirectory || queueServerId ? {
                directory: queueDirectory ?? undefined,
                serverId: queueServerId,
            } : undefined,
            sendConfig: currentProviderId && currentModelId ? {
                providerID: currentProviderId,
                modelID: currentModelId,
                agent: currentAgentName ?? undefined,
                variant: currentVariant ?? undefined,
            } : undefined,
        });

        // Clear input and attachments
        // Note: confirmedMentionsRef is NOT cleared here because queued messages
        // are processed later in handleSubmit which reads the ref via extractInlineFileMentions.
        // The ref is cleared in handleSubmit after all queued messages are sent.
        setMessage('');
        messageRef.current = '';
        if (attachmentsToQueue.length > 0) {
            clearAttachedFiles();
        }

        if (!isMobile) {
            textareaRef.current?.focus();
        }
    }, [getCurrentInputSnapshot, currentSessionId, currentSessionDirectoryForSync, currentDirectory, projects, availableWorktreesByProject, sendableAttachedFiles, sanitizeAttachmentsForSend, addToQueue, clearAttachedFiles, isMobile, consumeDrafts, currentProviderId, currentModelId, currentAgentName, currentVariant]);

    const handleQueuedMessageEdit = React.useCallback((content: string) => {
        setMessage(content);
        setTimeout(() => {
            textareaRef.current?.focus();
        }, 0);
    }, []);

    const handleQueuedMessageSend = React.useCallback((messageId: string) => {
        void handleSubmitRef.current({ queuedOnly: true, queuedMessageId: messageId });
    }, []);

    const handleOpenAgentPanel = React.useCallback(() => {
        setMobileControlsPanel('agent');
    }, []);

    const handleToggleExpandedInput = React.useCallback(() => {
        setExpandedInput(!isExpandedInput);
    }, [isExpandedInput, setExpandedInput]);

    const openIssuePicker = React.useCallback(() => {
        setIssuePickerOpen(true);
    }, []);

    const openPrPicker = React.useCallback(() => {
        setPrPickerOpen(true);
    }, []);

    const handleSubmit = async (options?: SubmitOptions) => {
        const queuedOnly = options?.queuedOnly ?? false;
        const queuedMessageId = options?.queuedMessageId;
        const deliveryMode = options?.deliveryMode ?? 'normal';
        const inputSnapshot = getCurrentInputSnapshot();
        presetSubmitTextRef.current = null;
        const submittedSessionId = currentSessionId;
        const submittedNewSessionDraftOpen = newSessionDraftOpen;
        const submittedDraftSnapshot = submittedNewSessionDraftOpen ? { ...newSessionDraft } : null;
        const submittedDirectory = submittedSessionId
            ? normalizePath(
                useSessionUIStore.getState().getDirectoryForSession(submittedSessionId)
                ?? currentSessionDirectoryForSync
                ?? currentDirectory,
            )
            : normalizePath(
                submittedDraftSnapshot?.bootstrapPendingDirectory
                ?? submittedDraftSnapshot?.directoryOverride
                ?? currentDirectory,
            );
        const submittedProject = submittedDirectory
            ? resolveProjectForSessionDirectory(projects, availableWorktreesByProject, submittedDirectory)
            : null;
        const submittedDraftProject = submittedDraftSnapshot?.selectedProjectId
            ? projects.find((project) => project.id === submittedDraftSnapshot.selectedProjectId)
            : null;
        const submittedServerId = submittedSessionId
            ? (serverRegistry.getServerForSession(submittedSessionId) ?? submittedProject?.serverId)
            : (submittedDraftProject?.serverId ?? submittedProject?.serverId);
        const submittedSendTarget: SendMessageTarget = {
            sessionId: submittedSessionId,
            directory: submittedDirectory,
            serverId: submittedServerId,
            draft: submittedDraftSnapshot,
        };
        const submittedDraftText = !queuedOnly ? inputSnapshot.message : '';
        const confirmedMentionsSnapshot = new Set(confirmedMentionsRef.current);

        if (queuedOnly) {
            if (!hasQueuedMessages || !currentSessionId) return;
        } else if ((!inputSnapshot.hasContent && !hasQueuedMessages) || (!currentSessionId && !newSessionDraftOpen)) {
            return;
        }

        if (!currentProviderId || !currentModelId) {
            console.warn('Cannot send message: provider or model not selected');
            return;
        }

        // Build the primary message (first part) and additional parts
        let primaryText = '';
        let primaryAttachments: AttachedFile[] = [];
        let composerAttachmentsSnapshot: AttachedFile[] = [];
        let agentMentionName: string | undefined;
        const additionalParts: Array<{ text: string; attachments?: AttachedFile[]; synthetic?: boolean }> = [];
        const availableSkillNames = new Set(useSkillsStore.getState().skills.map((skill) => skill.name));
        const mentionedSkillNames: string[] = [];
        const addMentionedSkills = (text: string) => {
            for (const name of collectInlineSkillMentions(text, availableSkillNames)) {
                if (!mentionedSkillNames.includes(name)) mentionedSkillNames.push(name);
            }
        };

        // Consume any pending synthetic parts (from conflict resolution, etc.)
        const syntheticParts = consumePendingSyntheticParts();
        const consumedSyntheticPartsSnapshot = syntheticParts ? [...syntheticParts] : null;

        // Process queued messages first
        const queuedMessagesToSend = queuedMessageId
            ? queuedMessages.filter((message) => message.id === queuedMessageId)
            : queuedMessages;
        const queuedMessagesSnapshot = currentSessionId && queuedMessagesToSend.length > 0
            ? [...queuedMessages]
            : [];
        const queueSessionId = currentSessionId;
        for (let i = 0; i < queuedMessagesToSend.length; i++) {
            const queuedMsg = queuedMessagesToSend[i];
            const { sanitizedText, mention } = parseAgentMentions(queuedMsg.content, agents);
            const { sanitizedText: queuedText, attachments: mentionAttachments } = extractInlineFileMentions(sanitizedText);
            addMentionedSkills(queuedText);

            // Use agent mention from first message that has one
            if (!agentMentionName && mention?.name) {
                agentMentionName = mention.name;
            }

            if (i === 0) {
                // First queued message becomes primary
                primaryText = queuedText;
                primaryAttachments = [
                    ...sanitizeAttachmentsForSend(queuedMsg.attachments),
                    ...mentionAttachments,
                ];
            } else {
                // Subsequent queued messages become additional parts
                const queuedAttachments = sanitizeAttachmentsForSend(queuedMsg.attachments);
                additionalParts.push({
                    text: queuedText,
                    attachments: [...queuedAttachments, ...mentionAttachments],
                });
            }
        }

        // Add current input (skip for queued-only auto-send)
        if (!queuedOnly && inputSnapshot.hasContent) {
            const messageToSend = inputSnapshot.message.replace(/^\n+|\n+$/g, '');
            const { sanitizedText, mention } = parseAgentMentions(messageToSend, agents);
            const { sanitizedText: messageText, attachments: mentionAttachments } = extractInlineFileMentions(sanitizedText);
            const attachmentsToSend = sanitizeAttachmentsForSend(sendableAttachedFiles);
            composerAttachmentsSnapshot = attachmentsToSend;
            addMentionedSkills(messageText);

            if (!agentMentionName && mention?.name) {
                agentMentionName = mention.name;
            }

            if (queuedMessages.length === 0) {
                // No queue - current input is primary
                primaryText = messageText;
                primaryAttachments = [...attachmentsToSend, ...mentionAttachments];
            } else {
                // Has queue - current input is additional part
                additionalParts.push({
                    text: messageText,
                    attachments: [...attachmentsToSend, ...mentionAttachments],
                });
            }
        }

        const sessionKey = currentSessionId ?? (newSessionDraftOpen ? 'draft' : null);
        let drafts: InlineCommentDraft[] = [];
        let consumedDraftSessionKey: string | null = null;
        let consumedDraftsSnapshot: InlineCommentDraft[] = [];
        if (!queuedOnly && sessionKey) {
            consumedDraftSessionKey = sessionKey;
            drafts = consumeDrafts(sessionKey);
            consumedDraftsSnapshot = drafts;
        }

        if (drafts.length > 0) {
            if (queuedMessages.length === 0) {
                primaryText = appendInlineComments(primaryText, drafts);
            } else if (additionalParts.length > 0) {
                const lastPart = additionalParts[additionalParts.length - 1];
                lastPart.text = appendInlineComments(lastPart.text, drafts);
            } else {
                primaryText = appendInlineComments(primaryText, drafts);
            }
        }

        // Add synthetic parts (from conflict resolution, etc.)
        if (syntheticParts && syntheticParts.length > 0) {
            for (const part of syntheticParts) {
                additionalParts.push({
                    text: part.text,
                    synthetic: true,
                });
            }
        }

        // Add linked issue as synthetic part (only the parts with synthetic: true)
        // The text part (synthetic: false) is completely dropped per requirements
        if (linkedIssue) {
            additionalParts.push({
                text: linkedIssue.contextText,
                synthetic: true,
            });
        }

        if (linkedPr) {
            additionalParts.push({
                text: linkedPr.instructionsText,
                synthetic: true,
            });
            additionalParts.push({
                text: linkedPr.contextText,
                synthetic: true,
            });
        }

        const skillMentionInstruction = buildSkillMentionInstruction(mentionedSkillNames);
        if (skillMentionInstruction) {
            additionalParts.push({
                text: skillMentionInstruction,
                synthetic: true,
            });
        }

        if (!primaryText && primaryAttachments.length === 0 && additionalParts.length === 0) return;

        // Clear queue and input optimistically. Failure recovery below restores
        // these snapshots so a disconnected WS/SSE stream cannot swallow input.
        if (currentSessionId && queuedMessagesToSend.length > 0) {
            if (queuedMessageId) {
                removeFromQueue(currentSessionId, queuedMessageId);
            } else {
                clearQueue(currentSessionId);
            }
        }
        if (!queuedOnly) {
            setMessage('');
            messageRef.current = '';
            confirmedMentionsRef.current.clear();
            // Clear per-session draft on submit
            saveStoredDraft(submittedSessionId, '');
            saveConfirmedMentions(submittedSessionId, confirmedMentionsRef.current);
            // Reset message history navigation state
            setHistoryIndex(-1);
            setDraftMessage('');
            if (attachedFiles.length > 0) {
                clearAttachedFiles();
            }
            // Close expanded input overlay when submitting
            setExpandedInput(false);
        }

        if (isMobile) {
            textareaRef.current?.blur();
        }

        // Handle local slash commands only in normal mode
        const normalizedCommand = primaryText.trimStart();
        if (inputMode === 'normal' && normalizedCommand.startsWith('/')) {
            const commandName = normalizedCommand
                .slice(1)
                .trim()
                .split(/\s+/)[0]
                ?.toLowerCase();

            if (commandName === 'undo' && submittedSessionId) {
                await useSessionUIStore.getState().handleSlashUndo(submittedSessionId);
                scrollToBottom?.();
                return;
            }
            else if (commandName === 'redo' && submittedSessionId) {
                await useSessionUIStore.getState().handleSlashRedo(submittedSessionId);
                scrollToBottom?.();
                return;
            }
            else if (commandName === 'timeline' && submittedSessionId) {
                setTimelineDialogOpen(true);
                return;
            }
            else if (commandName === 'compact' && submittedSessionId) {
                try {
                    await sessionActions.waitForConnectionOrThrow();

                    const invocation = parseSlashInvocation(normalizedCommand);
                    const focusText = invocation?.arguments?.trim() ?? '';
                    if (focusText) {
                        try {
                            await fetch('/api/compact-focus', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sessionID: submittedSessionId, focus: focusText }),
                            });
                            toast.info(t('chat.chatInput.toast.compactWithFocus', { focus: focusText }));
                        } catch {
                            // Focus injection is best-effort; proceed with plain compaction
                        }
                    }

                    const { opencodeClient } = await import('@/lib/opencode/client');
                    const sdk = opencodeClient.getSdkClient();
                    const configState = useConfigStore.getState();
                    await sdk.session.summarize({
                        sessionID: submittedSessionId,
                        modelID: configState.currentModelId || '',
                        providerID: configState.currentProviderId || '',
                    });
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.compactFailed'));
                }
                return;
            }
            else if (commandName === 'summary' && submittedSessionId) {
                try {
                    await sessionActions.waitForConnectionOrThrow();
                    // Everything after `/summary ` is an optional topic hint
                    // the user wants the summary focused on.
                    const topic = normalizedCommand.replace(/^\/summary\b/i, '').trim();
                    const topicLine = topic ? ` focused on: ${topic}` : '';
                    const topicBlock = topic
                        ? `The user asked you to focus this summary on: ${topic}. Prioritize that topic; mention unrelated threads only in passing.`
                        : '';
                    const visibleText = await renderMagicPrompt('session.summary.visible', { topic_line: topicLine });
                    const instructionsText = await renderMagicPrompt('session.summary.instructions', { topic_block: topicBlock });
                    await sendMessage(
                        visibleText,
                        currentProviderId,
                        currentModelId,
                        currentAgentName,
                        [],
                        agentMentionName,
                        [{ text: instructionsText, synthetic: true }],
                        currentVariant,
                        inputMode,
                        submittedSendTarget,
                    );
                    scrollToBottom?.();
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.summaryFailed'));
                }
                return;
            }
            else if (commandName === 'handoff-review' && currentSessionId && !isMobile && !isVSCodeRuntime()) {
                try {
                    const directory = useSessionUIStore.getState().getDirectoryForSession(currentSessionId) || currentDirectory || '';
                    if (!directory) {
                        throw new Error('Session directory is unavailable');
                    }
                    toast.info('Starting review flow — generating handoff...');
                    await startReviewFlow({
                        originalSessionID: currentSessionId,
                        directory,
                        serverId: serverRegistry.getServerForSession(currentSessionId) ?? null,
                        providerID: currentProviderId,
                        modelID: currentModelId,
                        agent: currentAgentName,
                        variant: currentVariant,
                        agentMentionName,
                    });
                    scrollToBottom?.();
                } catch (error) {
                    console.error('[review-flow] failed to start review flow', error);
                    toast.error(error instanceof Error ? error.message : 'Failed to start review flow');
                }
                return;
            }
            else if (commandName === 'workspace-review' && (submittedSessionId || submittedNewSessionDraftOpen)) {
                try {
                    await sessionActions.waitForConnectionOrThrow();
                    const visibleText = await renderMagicPrompt('session.review.visible');
                    const instructionsText = await renderMagicPrompt('session.review.instructions');
                    await sendMessage(
                        visibleText,
                        currentProviderId,
                        currentModelId,
                        currentAgentName,
                        [],
                        agentMentionName,
                        [{ text: instructionsText, synthetic: true }],
                        currentVariant,
                        inputMode,
                        submittedSendTarget,
                    );
                    scrollToBottom?.();
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.reviewFailed'));
                }
                return;
            }
            else if (GUIDED_SESSION_COMMANDS[commandName] && (submittedSessionId || submittedNewSessionDraftOpen)) {
                const command = GUIDED_SESSION_COMMANDS[commandName];
                try {
                    await sessionActions.waitForConnectionOrThrow();
                    const visibleText = await renderMagicPrompt(command.visible);
                    const instructionsText = await renderMagicPrompt(command.instructions);
                    await sendMessage(
                        visibleText,
                        currentProviderId,
                        currentModelId,
                        currentAgentName,
                        [],
                        agentMentionName,
                        [{ text: instructionsText, synthetic: true }],
                        currentVariant,
                        inputMode,
                        submittedSendTarget,
                    );
                    scrollToBottom?.();
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t(command.toastKey));
                }
                return;
            }
        }

        const currentSessionDirectory = submittedDirectory;
        if (submittedSessionId && !currentSessionDirectory) {
            throw new Error(`Cannot send message: directory for session ${submittedSessionId} is not available`);
        }
        const sendDirectory = currentSessionDirectory ?? undefined;
        const shouldAddResponseStyle = submittedNewSessionDraftOpen || (submittedSessionId ? !hasUserMessages(submittedSessionId, sendDirectory) : false);
        if (shouldAddResponseStyle) {
            const responseStyleInstruction = await fetchResponseStyleInstruction().catch(() => null);
            if (responseStyleInstruction) {
                additionalParts.push({
                    text: wrapSystemReminder(responseStyleInstruction),
                    synthetic: true,
                });
            }
        }

        try {
            const expandText = useSnippetsStore.getState().expandText;
            primaryText = await expandText(primaryText, { directory: sendDirectory });
            for (const part of additionalParts) {
                if (!part.synthetic) {
                    part.text = await expandText(part.text, { directory: sendDirectory });
                }
            }
        } catch (error) {
            console.warn('[ChatInput] Failed to expand snippets, sending original text:', error);
        }

        const sendPromise = sendMessage(
            primaryText,
            currentProviderId,
            currentModelId,
            currentAgentName,
            primaryAttachments,
            agentMentionName,
            additionalParts.length > 0 ? additionalParts : undefined,
            currentVariant,
            inputMode,
            submittedSendTarget,
            deliveryMode,
        );

        if (typeof window === 'undefined') {
            scrollToBottom?.();
        } else {
            window.requestAnimationFrame(() => {
                scrollToBottom?.();
            });
        }

        void sendPromise.then(() => {
            // Clear linked issue after successful message send
            if (linkedIssue) {
                setLinkedIssue(null);
            }
            if (linkedPr) {
                setLinkedPr(null);
            }
        }).catch((error: unknown) => {
            const rawMessage =
                error instanceof Error
                    ? error.message
                    : typeof error === 'string'
                        ? error
                        : String(error ?? '');
            const normalized = rawMessage.toLowerCase();

            console.error('Message send failed:', rawMessage || error);

            if (queueSessionId && queuedMessagesSnapshot.length > 0) {
                restoreQueuedMessages(queueSessionId, queuedMessagesSnapshot);
            }
            if (consumedDraftSessionKey && consumedDraftsSnapshot.length > 0) {
                restoreInlineDrafts(consumedDraftSessionKey, consumedDraftsSnapshot);
            }
            if (consumedSyntheticPartsSnapshot) {
                useInputStore.getState().setPendingSyntheticParts(consumedSyntheticPartsSnapshot);
            }
            if (!queuedOnly) {
                const liveSessionState = useSessionUIStore.getState();
                const liveDraftDirectory = normalizePath(
                    liveSessionState.newSessionDraft.bootstrapPendingDirectory
                    ?? liveSessionState.newSessionDraft.directoryOverride,
                );
                const restoreIntoVisibleInput = submittedSessionId
                    ? liveSessionState.currentSessionId === submittedSessionId
                    : liveSessionState.currentSessionId === null
                        && liveSessionState.newSessionDraft.open
                        && liveDraftDirectory === submittedDirectory;
                const restoredMentions = new Set(confirmedMentionsSnapshot);
                if (restoreIntoVisibleInput) {
                    confirmedMentionsRef.current = restoredMentions;
                }
                saveConfirmedMentions(submittedSessionId, restoredMentions);

                const currentDraft = restoreIntoVisibleInput
                    ? messageRef.current
                    : getStoredDraft(submittedSessionId);
                const restoredDraft = mergeFailedDraftText(currentDraft, submittedDraftText);
                persistDraftImmediately(submittedSessionId, restoredDraft);
                if (restoreIntoVisibleInput && restoredDraft !== messageRef.current) {
                    messageRef.current = restoredDraft;
                    setMessage(restoredDraft);
                }
                if (restoreIntoVisibleInput && composerAttachmentsSnapshot.length > 0) {
                    useInputStore.getState().setAttachedFiles(composerAttachmentsSnapshot);
                }
            }

            const isSoftNetworkError =
                normalized.includes('timeout') ||
                normalized.includes('timed out') ||
                normalized.includes('may still be processing') ||
                normalized.includes('being processed') ||
                normalized.includes('failed to fetch') ||
                normalized.includes('networkerror') ||
                normalized.includes('network error') ||
                normalized.includes('gateway timeout') ||
                normalized === 'failed to send message';

            if (normalized.includes('payload too large') || normalized.includes('413') || normalized.includes('entity too large')) {
                toast.error(t('chat.chatInput.toast.attachmentsTooLarge'));
                return;
            }

            if (isSoftNetworkError) {
                if (composerAttachmentsSnapshot.length > 0) {
                    toast.error(t('chat.chatInput.toast.sendAttachmentsFailed'));
                }
                return;
            }

            toast.error(rawMessage || t('chat.chatInput.toast.messageSendFailed'));
        });

        if (!isMobile) {
            textareaRef.current?.focus();
        }
    };

    // Update ref with latest handleSubmit on every render
    handleSubmitRef.current = handleSubmit;

    // Primary action for send button - respects queue mode setting
    const handlePrimaryAction = React.useCallback(() => {
        const inputSnapshot = getCurrentInputSnapshot();
        const canQueue = inputMode === 'normal' && inputSnapshot.hasContent && currentSessionId && sessionPhase !== 'idle';
        if (queueModeEnabled && canQueue) {
            handleQueueMessage();
        } else {
            void handleSubmitRef.current();
        }
    }, [inputMode, getCurrentInputSnapshot, currentSessionId, sessionPhase, queueModeEnabled, handleQueueMessage]);

    const handleSendNow = React.useCallback(() => {
        void handleSubmitRef.current({ deliveryMode: 'steer' });
    }, []);

    const handleInterruptAndSend = React.useCallback(() => {
        void handleSubmitRef.current({ deliveryMode: 'interrupt' });
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Early return during IME composition to prevent interference with autocomplete.
        // Uses keyCode === 229 fallback for WebKit where compositionend fires before keydown.
        if (isIMECompositionEvent(e)) return;

        if (inputMode === 'shell' && e.key === 'Escape') {
            e.preventDefault();
            setInputMode('normal');
            return;
        }

        if (inputMode === 'shell' && e.key === 'Backspace' && message.length === 0) {
            e.preventDefault();
            setInputMode('normal');
            return;
        }

        if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const textarea = textareaRef.current;
            const selectionStart = textarea?.selectionStart ?? message.length;
            const selectionEnd = textarea?.selectionEnd ?? message.length;
            const hasCollapsedSelection = selectionStart === selectionEnd;

            if (hasCollapsedSelection) {
                const probeIndex = e.key === 'Backspace' ? selectionStart - 1 : selectionStart;
                if (probeIndex >= 0 && probeIndex < message.length) {
                    let tokenStart = probeIndex;
                    while (tokenStart > 0 && !/\s/.test(message[tokenStart - 1])) {
                        tokenStart -= 1;
                    }

                    let tokenEnd = probeIndex + 1;
                    while (tokenEnd < message.length && !/\s/.test(message[tokenEnd])) {
                        tokenEnd += 1;
                    }

                    const token = message.slice(tokenStart, tokenEnd);
                    const mentionContent = token.slice(1);
                    const looksLikeFileMention = FILE_MENTION_TOKEN.test(token)
                        && !knownAgentNamesRef.current.has(mentionContent.toLowerCase())
                        && isConfirmedFilePath(mentionContent);

                    if (looksLikeFileMention) {
                        confirmedMentionsRef.current.delete(mentionContent);
                        const removeUntil = message[tokenEnd] === ' ' ? tokenEnd + 1 : tokenEnd;
                        const nextMessage = `${message.slice(0, tokenStart)}${message.slice(removeUntil)}`;
                        e.preventDefault();
                        setMessage(nextMessage);
                        requestAnimationFrame(() => {
                            if (textareaRef.current) {
                                textareaRef.current.selectionStart = tokenStart;
                                textareaRef.current.selectionEnd = tokenStart;
                            }
                            adjustTextareaHeight();
                        });
                        updateAutocompleteState(nextMessage, tokenStart);
                        return;
                    }
                }
            }
        }

        if (showCommandAutocomplete && commandRef.current) {
            if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                commandRef.current.handleKeyDown(e.key);
                return;
            }
        }

        if (showSkillAutocomplete && skillRef.current) {
            if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                skillRef.current.handleKeyDown(e.key);
                return;
            }
        }

        if (showSnippetAutocomplete && snippetRef.current) {
            if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                snippetRef.current.handleKeyDown(e.key);
                return;
            }
        }

        if (showFileMention && mentionRef.current) {
            if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                mentionRef.current.handleKeyDown(e.key);
                return;
            }
        }

        if (isDesktopExpanded && e.key === 'Escape') {
            e.preventDefault();
            setExpandedInput(false);
            return;
        }

        const cycleAgentBackwardShortcut = cycleAgentShortcut && !cycleAgentShortcut.includes('shift')
            ? normalizeCombo(`shift+${cycleAgentShortcut}`)
            : '';
        const cycleAgentDirection = cycleAgentBackwardShortcut && eventMatchesShortcut(e, cycleAgentBackwardShortcut)
            ? -1
            : eventMatchesShortcut(e, cycleAgentShortcut)
                ? 1
                : 0;

        if (cycleAgentDirection !== 0 && !showCommandAutocomplete && !showSkillAutocomplete && !showSnippetAutocomplete && !showFileMention) {
            e.preventDefault();
            e.stopPropagation();
            handleCycleAgent(cycleAgentDirection);
            return;
        }

        // Handle ArrowUp/ArrowDown for message history navigation
        // ArrowUp: only when cursor at start (position 0) or input is empty
        // ArrowDown: also works when cursor at end (to cycle forward through history)
        const isAnyAutocompleteOpen = showCommandAutocomplete || showSkillAutocomplete || showSnippetAutocomplete || showFileMention;
        const cursorAtStart = textareaRef.current?.selectionStart === 0 && textareaRef.current?.selectionEnd === 0;
        const cursorAtEnd = textareaRef.current?.selectionStart === message.length && textareaRef.current?.selectionEnd === message.length;
        const canNavigateHistoryUp = !isAnyAutocompleteOpen && (message.length === 0 || cursorAtStart);
        const canNavigateHistoryDown = !isAnyAutocompleteOpen && (message.length === 0 || cursorAtEnd);

        if (inputMode === 'normal' && !isAnyAutocompleteOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const textarea = textareaRef.current;
            const selectionStart = textarea?.selectionStart ?? -1;
            const selectionEnd = textarea?.selectionEnd ?? -1;

            if (textarea && selectionStart >= 0) {
                const applyEdit = (next: string, caretStart: number, caretEnd: number) => {
                    e.preventDefault();
                    setMessage(next);
                    requestAnimationFrame(() => {
                        const current = textareaRef.current;
                        if (current) {
                            current.selectionStart = caretStart;
                            current.selectionEnd = caretEnd;
                        }
                        adjustTextareaHeight();
                    });
                    updateAutocompleteState(next, caretEnd);
                };

                const wrapPairs: Record<string, [string, string]> = {
                    '`': ['`', '`'],
                    '*': ['*', '*'],
                    '_': ['_', '_'],
                    '~': ['~', '~'],
                    '(': ['(', ')'],
                    '[': ['[', ']'],
                    '{': ['{', '}'],
                    '"': ['"', '"'],
                    "'": ["'", "'"],
                };
                if (selectionEnd > selectionStart && wrapPairs[e.key]) {
                    const [open, close] = wrapPairs[e.key];
                    const selected = message.slice(selectionStart, selectionEnd);
                    const next = `${message.slice(0, selectionStart)}${open}${selected}${close}${message.slice(selectionEnd)}`;
                    applyEdit(next, selectionStart + open.length, selectionEnd + open.length);
                    return;
                }

                if (e.key === '`' && selectionStart === selectionEnd) {
                    const before = message.slice(0, selectionStart);
                    if (/(^|\n)``$/.test(before)) {
                        const after = message.slice(selectionEnd);
                        const next = `${before}\`\n\n\`\`\`${after}`;
                        const caret = before.length + 2;
                        applyEdit(next, caret, caret);
                        return;
                    }
                }
            }
        }

        if (e.key === 'ArrowUp' && canNavigateHistoryUp && userMessageHistory.length > 0) {
            e.preventDefault();
            if (historyIndex === -1) {
                // Entering history mode - save current input as draft
                setDraftMessage(message);
                setHistoryIndex(0);
                setMessage(userMessageHistory[0]);
            } else if (historyIndex < userMessageHistory.length - 1) {
                // Navigate to older message
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                setMessage(userMessageHistory[newIndex]);
            }
            // Move cursor to start after history navigation
            requestAnimationFrame(() => {
                textareaRef.current?.setSelectionRange(0, 0);
            });
            // If at oldest message, do nothing
            return;
        }

        if (e.key === 'ArrowDown' && canNavigateHistoryDown && historyIndex >= 0) {
            e.preventDefault();
            if (historyIndex === 0) {
                // Exit history mode - restore draft
                setHistoryIndex(-1);
                setMessage(draftMessage);
                setDraftMessage('');
            } else {
                // Navigate to newer message
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setMessage(userMessageHistory[newIndex]);
            }
            return;
        }

        // Handle Enter/Ctrl+Enter based on queue mode
        if (e.key === 'Enter' && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey)) {
            e.preventDefault();

            const isCtrlEnter = e.ctrlKey || e.metaKey;

            // Queue mode: Enter queues, Ctrl+Enter sends
            // Normal mode: Enter sends, Ctrl+Enter queues
            // Note: Queueing only works when there's an existing session (currentSessionId)
            // For new sessions (draft), always send immediately
            const canQueue = inputMode === 'normal' && hasContent && currentSessionId && sessionPhase !== 'idle';

            if (queueModeEnabled) {
                if (isCtrlEnter || !canQueue) {
                    // Ctrl+Enter sends (send now), or Enter when can't queue (new session)
                    if (isCtrlEnter && sessionPhase !== 'idle') {
                        handleSubmit({ deliveryMode: 'steer' });
                    } else {
                        handleSubmit();
                    }
                } else {
                    // Enter queues when we have a session
                    handleQueueMessage();
                }
            } else {
                if (isCtrlEnter && canQueue) {
                    // Ctrl+Enter queues when we have a session
                    handleQueueMessage();
                } else {
                    // Enter sends
                    handleSubmit();
                }
            }
        }
    };

    const measureCaretInTextarea = React.useCallback((textarea: HTMLTextAreaElement, cursorPosition: number) => {
        const doc = textarea.ownerDocument;
        const win = doc.defaultView;
        if (!win) return null;

        const style = win.getComputedStyle(textarea);
        const mirror = doc.createElement('div');
        const mirrorStyle = mirror.style;

        mirrorStyle.position = 'absolute';
        mirrorStyle.visibility = 'hidden';
        mirrorStyle.pointerEvents = 'none';
        mirrorStyle.whiteSpace = 'pre-wrap';
        mirrorStyle.wordWrap = 'break-word';
        mirrorStyle.overflow = 'hidden';
        mirrorStyle.left = '-9999px';
        mirrorStyle.top = '0';

        mirrorStyle.width = `${textarea.clientWidth}px`;
        mirrorStyle.font = style.font;
        mirrorStyle.fontSize = style.fontSize;
        mirrorStyle.fontFamily = style.fontFamily;
        mirrorStyle.fontWeight = style.fontWeight;
        mirrorStyle.fontStyle = style.fontStyle;
        mirrorStyle.fontVariant = style.fontVariant;
        mirrorStyle.letterSpacing = style.letterSpacing;
        mirrorStyle.textTransform = style.textTransform;
        mirrorStyle.textIndent = style.textIndent;
        mirrorStyle.padding = style.padding;
        mirrorStyle.border = style.border;
        mirrorStyle.boxSizing = style.boxSizing;
        mirrorStyle.lineHeight = style.lineHeight;
        mirrorStyle.tabSize = style.tabSize;

        mirror.textContent = textarea.value.slice(0, cursorPosition);
        const marker = doc.createElement('span');
        marker.textContent = textarea.value.slice(cursorPosition, cursorPosition + 1) || ' ';
        mirror.appendChild(marker);

        doc.body.appendChild(mirror);
        const top = marker.offsetTop;
        const left = marker.offsetLeft;
        doc.body.removeChild(mirror);

        return { top, left };
    }, []);

    const updateAutocompleteOverlayPosition = React.useCallback(() => {
        if (!isDesktopExpanded) {
            setAutocompleteOverlayPosition(null);
            return;
        }

        if (!showCommandAutocomplete && !showSkillAutocomplete && !showSnippetAutocomplete && !showFileMention) {
            setAutocompleteOverlayPosition(null);
            return;
        }

        const textarea = textareaRef.current;
        const container = dropZoneRef.current;
        if (!textarea || !container) return;

        const cursor = textarea.selectionStart ?? message.length;
        const caret = measureCaretInTextarea(textarea, cursor);
        if (!caret) return;

        const textareaRect = textarea.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const caretY = textareaRect.top - containerRect.top + (caret.top - textarea.scrollTop);
        const caretX = textareaRect.left - containerRect.left + (caret.left - textarea.scrollLeft);

        const popupMargin = 8;
        const estimatedPopupHeight = showCommandAutocomplete ? 420 : 260;
        const spaceAbove = caretY - popupMargin;
        const spaceBelow = containerRect.height - caretY - popupMargin;
        const place: 'above' | 'below' = spaceBelow >= estimatedPopupHeight || spaceBelow >= spaceAbove ? 'below' : 'above';

        const desiredWidth = showFileMention ? 520 : showCommandAutocomplete ? 560 : showSnippetAutocomplete ? 450 : 360;
        const clampedLeft = Math.max(
            popupMargin,
            Math.min(caretX - 24, containerRect.width - desiredWidth - popupMargin)
        );

        const maxHeight = Math.max(120, Math.min(estimatedPopupHeight, place === 'below' ? spaceBelow : spaceAbove));

        setAutocompleteOverlayPosition({
            top: place === 'below' ? caretY + 22 : caretY - 6,
            left: clampedLeft,
            place,
            maxHeight,
        });
    }, [
        isDesktopExpanded,
        measureCaretInTextarea,
        message.length,
        showCommandAutocomplete,
        showFileMention,
        showSnippetAutocomplete,
        showSkillAutocomplete,
    ]);

    React.useLayoutEffect(() => {
        updateAutocompleteOverlayPosition();
    }, [
        updateAutocompleteOverlayPosition,
        message,
        showCommandAutocomplete,
        showSkillAutocomplete,
        showSnippetAutocomplete,
        showFileMention,
        isDesktopExpanded,
    ]);

    React.useEffect(() => {
        if (!isDesktopExpanded) return;
        const onResize = () => updateAutocompleteOverlayPosition();
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
        };
    }, [isDesktopExpanded, updateAutocompleteOverlayPosition]);

    const startAbortFeedback = React.useCallback(() => {
        if (abortFeedbackTimeoutRef.current) {
            clearTimeout(abortFeedbackTimeoutRef.current);
            abortFeedbackTimeoutRef.current = null;
        }

        setAbortFeedbackActive(true);

        abortFeedbackTimeoutRef.current = setTimeout(() => {
            setAbortFeedbackActive(false);
            abortFeedbackTimeoutRef.current = null;
        }, 900);
    }, []);

    const handleAbort = React.useCallback(() => {
        clearAbortPrompt();
        const sessionId = currentSessionId;
        if (!sessionId) return;

        void abortCurrentOperation(sessionId).then((sent) => {
            if (sent) {
                startAbortFeedback();
            }
        }).catch((error) => {
            console.error('[ChatInput] abort failed', error);
        });
    }, [abortCurrentOperation, clearAbortPrompt, currentSessionId, startAbortFeedback]);

    const handleCycleAgent = React.useCallback((direction: 1 | -1 = 1) => {
        const nextAgentName = getCycledPrimaryAgentName(agents, currentAgentName, direction);
        if (!nextAgentName) return;

        setAgent(nextAgentName);

        if (currentSessionId) {
            saveSessionAgentSelection(currentSessionId, nextAgentName);
        }
    }, [agents, currentAgentName, currentSessionId, setAgent, saveSessionAgentSelection]);

    const adjustTextareaHeight = React.useCallback((options?: { allowShrink?: boolean }) => {
        const textarea = textareaRef.current;
        if (!textarea) {
            return;
        }

        const previousScrollTop = textarea.scrollTop;

        if (isDesktopExpanded) {
            textarea.style.height = '100%';
            textarea.style.maxHeight = 'none';
            setTextareaSize(null);
            if (textarea.scrollTop !== previousScrollTop) {
                textarea.scrollTop = previousScrollTop;
            }
            return;
        }

        if (options?.allowShrink ?? true) {
            textarea.style.height = 'auto';
        }

        const view = textarea.ownerDocument?.defaultView;
        const computedStyle = view ? view.getComputedStyle(textarea) : null;
        const lineHeight = computedStyle ? parseFloat(computedStyle.lineHeight) : NaN;
        const paddingTop = computedStyle ? parseFloat(computedStyle.paddingTop) : NaN;
        const paddingBottom = computedStyle ? parseFloat(computedStyle.paddingBottom) : NaN;
        const fallbackLineHeight = 22;
        const fallbackPadding = 16;
        const paddingTotal = Number.isNaN(paddingTop) || Number.isNaN(paddingBottom)
            ? fallbackPadding
            : paddingTop + paddingBottom;
        const targetLineHeight = Number.isNaN(lineHeight) ? fallbackLineHeight : lineHeight;
        const maxHeight = targetLineHeight * MAX_VISIBLE_TEXTAREA_LINES + paddingTotal;
        const scrollHeight = textarea.scrollHeight || textarea.offsetHeight;
        const nextHeight = Math.min(scrollHeight, maxHeight);

        textarea.style.height = `${nextHeight}px`;
        textarea.style.maxHeight = `${maxHeight}px`;
        if (textarea.scrollTop !== previousScrollTop) {
            textarea.scrollTop = previousScrollTop;
        }

        setTextareaSize((prev) => {
            if (prev && prev.height === nextHeight && prev.maxHeight === maxHeight) {
                return prev;
            }
            return { height: nextHeight, maxHeight };
        });
    }, [isDesktopExpanded]);

    React.useLayoutEffect(() => {
        const allowShrink = message.length < previousMessageLengthRef.current;
        previousMessageLengthRef.current = message.length;
        adjustTextareaHeight({ allowShrink });
    }, [adjustTextareaHeight, message, isMobile]);

    const updateAutocompleteState = React.useCallback((value: string, cursorPosition: number) => {
        if (inputMode === 'shell') {
            setShowCommandAutocomplete(false);
            setShowFileMention(false);
            setShowSkillAutocomplete(false);
            setShowSnippetAutocomplete(false);
            return;
        }

        if (value.startsWith('/')) {
            const firstSpace = value.indexOf(' ');
            const firstNewline = value.indexOf('\n');
            const commandEnd = Math.min(
                firstSpace === -1 ? value.length : firstSpace,
                firstNewline === -1 ? value.length : firstNewline
            );

            if (cursorPosition <= commandEnd && firstSpace === -1) {
                const commandText = value.substring(1, commandEnd);
                setCommandQuery(commandText);
                setAutocompleteTab('commands');
                setShowCommandAutocomplete(true);
                setShowFileMention(false);
                setShowSkillAutocomplete(false);
                setShowSnippetAutocomplete(false);
                return;
            }
        }

        setShowCommandAutocomplete(false);

        const textBeforeCursor = value.substring(0, cursorPosition);

        const lastSlashSymbol = textBeforeCursor.lastIndexOf('/');
        if (lastSlashSymbol !== -1) {
            const charBefore = lastSlashSymbol > 0 ? textBeforeCursor[lastSlashSymbol - 1] : null;
            const textAfterSlash = textBeforeCursor.substring(lastSlashSymbol + 1);
            const hasSeparator = textAfterSlash.includes(' ') || textAfterSlash.includes('\n');
            const isWordBoundary = !charBefore || /\s/.test(charBefore);

            if (isWordBoundary && !hasSeparator) {
                setSkillQuery(textAfterSlash);
                setShowSkillAutocomplete(true);
                setShowFileMention(false);
                setShowSnippetAutocomplete(false);
                return;
            }
        }

        setShowSkillAutocomplete(false);
        setSkillQuery('');

        const lastHashSymbol = textBeforeCursor.lastIndexOf('#');
        if (lastHashSymbol !== -1) {
            const charBefore = lastHashSymbol > 0 ? textBeforeCursor[lastHashSymbol - 1] : null;
            const textAfterHash = textBeforeCursor.substring(lastHashSymbol + 1);
            const isWordBoundary = !charBefore || /\s/.test(charBefore);
            if (isWordBoundary && !textAfterHash.includes(' ') && !textAfterHash.includes('\n')) {
                setSnippetQuery(textAfterHash);
                setShowSnippetAutocomplete(true);
                setShowFileMention(false);
                return;
            }
        }

        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
        if (lastAtSymbol !== -1) {
            const charBefore = lastAtSymbol > 0 ? textBeforeCursor[lastAtSymbol - 1] : null;
            const textAfterAt = textBeforeCursor.substring(lastAtSymbol + 1);
            const isWordBoundary = !charBefore || /\s/.test(charBefore);
            if (isWordBoundary && !textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
                setMentionQuery(textAfterAt);
                setAutocompleteTab((current) => current === 'files' ? 'files' : 'agents');
                setShowFileMention(true);
            } else {
                setShowFileMention(false);
            }
        } else {
            setShowFileMention(false);
        }
    }, [inputMode, setAutocompleteTab, setCommandQuery, setMentionQuery, setShowCommandAutocomplete, setShowFileMention, setShowSkillAutocomplete, setSkillQuery]);

    const applyAutocompletePrefix = React.useCallback((prefix: '/' | '@') => {
        const nextMessage = message.length === 0
            ? prefix
            : (message[0] === '/' || message[0] === '@')
                ? `${prefix}${message.slice(1)}`
                : `${prefix}${message}`;
        setMessage(nextMessage);
        requestAnimationFrame(() => {
            if (textareaRef.current) {
                const nextCursor = Math.min(nextMessage.length, textareaRef.current.value.length);
                textareaRef.current.selectionStart = nextCursor;
                textareaRef.current.selectionEnd = nextCursor;
            }
            adjustTextareaHeight();
            updateAutocompleteState(nextMessage, nextMessage.length);
        });
    }, [adjustTextareaHeight, message, setMessage, updateAutocompleteState]);

    const handleAutocompleteTabSelect = React.useCallback((tab: 'commands' | 'agents' | 'files') => {
        const textarea = textareaRef.current;
        if (isMobile && textarea) {
            try {
                textarea.focus({ preventScroll: true });
            } catch {
                textarea.focus();
            }
            const len = textarea.value.length;
            try {
                textarea.setSelectionRange(len, len);
            } catch {
                // ignored
            }
        }
        const cursorPosition = textarea?.selectionStart ?? message.length;
        const textBeforeCursor = message.substring(0, cursorPosition);
        const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
        const nextMentionQuery = lastAtSymbol !== -1
            ? textBeforeCursor.substring(lastAtSymbol + 1).replace(/[\s\n].*$/, '')
            : '';

        setAutocompleteTab(tab);
        setCommandQuery('');
        if (tab === 'commands') {
            setMentionQuery('');
            applyAutocompletePrefix('/');
        }
        if (tab === 'agents') {
            setMentionQuery(nextMentionQuery);
            applyAutocompletePrefix('@');
        }
        if (tab === 'files') {
            setMentionQuery(nextMentionQuery);
            applyAutocompletePrefix('@');
        }
        setShowSkillAutocomplete(false);
        setShowSnippetAutocomplete(false);
        setShowCommandAutocomplete(tab === 'commands');
        setShowFileMention(tab === 'agents' || tab === 'files');
    }, [applyAutocompletePrefix, isMobile, message, setAutocompleteTab, setCommandQuery, setMentionQuery, setShowCommandAutocomplete, setShowFileMention, setShowSkillAutocomplete]);

    const handleOpenCommandMenu = React.useCallback(() => {
        if (!isMobile) {
            return;
        }
        const textarea = textareaRef.current;
        if (textarea) {
            try {
                textarea.focus({ preventScroll: true });
            } catch {
                textarea.focus();
            }
            const len = textarea.value.length;
            try {
                textarea.setSelectionRange(len, len);
            } catch {
                // ignored
            }
        }
        applyAutocompletePrefix('/');
        setCommandQuery('');
        setAutocompleteTab('commands');
        setShowCommandAutocomplete(true);
        setShowFileMention(false);
        setShowSkillAutocomplete(false);
        setShowSnippetAutocomplete(false);
    }, [applyAutocompletePrefix, isMobile, setAutocompleteTab, setCommandQuery, setShowCommandAutocomplete, setShowFileMention, setShowSkillAutocomplete]);

    const insertTextAtSelection = React.useCallback((text: string) => {
        if (!text) {
            return;
        }

        const textarea = textareaRef.current;
        if (!textarea) {
            const nextValue = message + text;
            setMessage(nextValue);
            updateAutocompleteState(nextValue, nextValue.length);
            requestAnimationFrame(() => adjustTextareaHeight());
            return;
        }

        const start = textarea.selectionStart ?? message.length;
        const end = textarea.selectionEnd ?? message.length;
        const nextValue = `${message.substring(0, start)}${text}${message.substring(end)}`;
        setMessage(nextValue);
        const cursorPosition = start + text.length;

        requestAnimationFrame(() => {
            const currentTextarea = textareaRef.current;
            if (currentTextarea) {
                currentTextarea.selectionStart = cursorPosition;
                currentTextarea.selectionEnd = cursorPosition;
            }
            adjustTextareaHeight();
        });

        updateAutocompleteState(nextValue, cursorPosition);
    }, [adjustTextareaHeight, message, updateAutocompleteState]);

    const clearDropTextSuppression = React.useCallback(() => {
        suppressNextFileDropTextInsertRef.current = false;
        pendingDroppedAbsolutePathsRef.current = [];
        if (suppressNextFileDropTextInsertTimeoutRef.current) {
            clearTimeout(suppressNextFileDropTextInsertTimeoutRef.current);
            suppressNextFileDropTextInsertTimeoutRef.current = null;
        }
    }, []);

    const scheduleDropTextSuppressionExpiry = React.useCallback(() => {
        if (suppressNextFileDropTextInsertTimeoutRef.current) {
            clearTimeout(suppressNextFileDropTextInsertTimeoutRef.current);
        }
        suppressNextFileDropTextInsertTimeoutRef.current = setTimeout(() => {
            clearDropTextSuppression();
        }, 700);
    }, [clearDropTextSuppression]);

    const handleBeforeInput = React.useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
        if (!isVSCodeRuntime() || !suppressNextFileDropTextInsertRef.current) {
            return;
        }

        const nativeInputEvent = e.nativeEvent as InputEvent | undefined;
        if (nativeInputEvent?.inputType === 'insertFromDrop') {
            e.preventDefault();
            clearDropTextSuppression();
        }
    }, [clearDropTextSuppression]);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const nativeInputEvent = e.nativeEvent as InputEvent | undefined;
        if (isVSCodeRuntime() && suppressNextFileDropTextInsertRef.current) {
            const candidateAbsolutePaths = pendingDroppedAbsolutePathsRef.current;
            const isLikelyDropTextInsertion = nativeInputEvent?.inputType === 'insertFromDrop'
                || candidateAbsolutePaths.some((path) => path.length > 0 && e.target.value.includes(path));

            if (isLikelyDropTextInsertion) {
                clearDropTextSuppression();
                return;
            }
        }

        const value = e.target.value;
        const cursorPosition = e.target.selectionStart ?? value.length;

        if (inputMode === 'normal' && value.startsWith('!')) {
            const shellCommand = value.slice(1);
            const nextCursor = Math.max(0, cursorPosition - 1);
            setInputMode('shell');
            setMessage(shellCommand);
            adjustTextareaHeight();
            setShowCommandAutocomplete(false);
            setShowSkillAutocomplete(false);
            setShowSnippetAutocomplete(false);
            setShowFileMention(false);
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.selectionStart = nextCursor;
                    textareaRef.current.selectionEnd = nextCursor;
                }
            });
            return;
        }

        setMessage(value);
        adjustTextareaHeight();
        updateAutocompleteState(value, cursorPosition);
    };

    React.useEffect(() => {
        return () => {
            clearDropTextSuppression();
        };
    }, [clearDropTextSuppression]);

    const handlePaste = React.useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (inputMode === 'normal' && (currentSessionId || newSessionDraftOpen)) {
            const textarea = textareaRef.current;
            const selectionStart = textarea?.selectionStart ?? -1;
            const selectionEnd = textarea?.selectionEnd ?? -1;
            if (textarea && selectionEnd > selectionStart) {
                const clipboardText = e.clipboardData.getData('text');
                const url = clipboardText.trim();
                const selected = message.slice(selectionStart, selectionEnd);
                if (
                    PASTE_LINK_URL_PATTERN.test(url)
                    && !/\s/.test(url)
                    && selected.trim().length > 0
                    && !selected.includes('](')
                ) {
                    e.preventDefault();
                    const next = `${message.slice(0, selectionStart)}[${selected}](${url})${message.slice(selectionEnd)}`;
                    const caret = selectionStart + 1 + selected.length + 2 + url.length + 1;
                    setMessage(next);
                    requestAnimationFrame(() => {
                        const current = textareaRef.current;
                        if (current) {
                            current.selectionStart = caret;
                            current.selectionEnd = caret;
                        }
                        adjustTextareaHeight();
                    });
                    updateAutocompleteState(next, caret);
                    return;
                }
            }
        }

        const fileMap = new Map<string, File>();

        Array.from(e.clipboardData.files || []).forEach(file => {
            if (file.type.startsWith('image/')) {
                fileMap.set(`${file.name}-${file.size}`, file);
            }
        });

        Array.from(e.clipboardData.items || []).forEach(item => {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    fileMap.set(`${file.name}-${file.size}`, file);
                }
            }
        });

        const imageFiles = Array.from(fileMap.values());

        // Word/Excel/Google Docs etc. copy the selection as text/plain + text/html AND a
        // rendered PNG snapshot of that same selection. The PNG is a bitmap of the text,
        // not a separately intended image — attaching it on every Office paste is noise.
        // When real text rides along, drop the image and let the browser paste the text.
        if (imageFiles.length > 0 && clipboardHasMeaningfulText(e.clipboardData)) {
            return;
        }

        if (imageFiles.length === 0) {
            return;
        }

        if (!currentSessionId && !newSessionDraftOpen) {
            return;
        }

        e.preventDefault();

        const pastedText = e.clipboardData.getData('text');
        const assignedFilenames = assignImageAttachmentFilenames(
            imageFiles,
            [
                ...attachedFiles.map((file) => file.filename),
                ...pendingPastedAttachmentFilenamesRef.current,
            ],
        );
        const citationText = buildAttachmentCitationText(assignedFilenames);
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? message.length;
        const selectionEnd = textarea?.selectionEnd ?? message.length;
        const insertionText = withInlineInsertionBoundaries(
            buildImagePasteInsertion(pastedText, citationText),
            message.slice(0, selectionStart),
            message.slice(selectionEnd),
        );

        insertTextAtSelection(insertionText);

        for (let index = 0; index < imageFiles.length; index += 1) {
            const filename = assignedFilenames[index];
            const file = renameFileForAttachmentCitation(imageFiles[index], filename);
            pendingPastedAttachmentFilenamesRef.current.add(filename);
            try {
                await addAttachedFile(file);
            } catch (error) {
                console.error('Clipboard image attach failed', error);
                toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.clipboardAttachFailed'));
            } finally {
                pendingPastedAttachmentFilenamesRef.current.delete(filename);
            }
        }
    }, [addAttachedFile, attachedFiles, adjustTextareaHeight, currentSessionId, inputMode, message, newSessionDraftOpen, insertTextAtSelection, setMessage, t, updateAutocompleteState]);

    const handleFileSelect = (file: { name: string; path: string; relativePath?: string }) => {

        const cursorPosition = textareaRef.current?.selectionStart || 0;
        const textBeforeCursor = message.substring(0, cursorPosition);
        const lastAtSymbol = textBeforeCursor.lastIndexOf('@');

        const mentionPath = (file.relativePath && file.relativePath.trim().length > 0)
            ? file.relativePath.trim()
            : (toProjectRelativeMentionPath(file.path) || file.name);

        confirmedMentionsRef.current.add(mentionPath);

        if (lastAtSymbol !== -1) {
            const newMessage =
                message.substring(0, lastAtSymbol) +
                `@${mentionPath} ` +
                message.substring(cursorPosition);
            setMessage(newMessage);
            const nextCursor = lastAtSymbol + mentionPath.length + 2;
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.selectionStart = nextCursor;
                    textareaRef.current.selectionEnd = nextCursor;
                }
                adjustTextareaHeight();
                updateAutocompleteState(newMessage, nextCursor);
            });
        } else if (textareaRef.current) {
            const newMessage =
                message.substring(0, cursorPosition) +
                `@${mentionPath} ` +
                message.substring(cursorPosition);
            setMessage(newMessage);
            const nextCursor = cursorPosition + mentionPath.length + 2;
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.selectionStart = nextCursor;
                    textareaRef.current.selectionEnd = nextCursor;
                }
                adjustTextareaHeight();
                updateAutocompleteState(newMessage, nextCursor);
            });
        }

        setShowFileMention(false);
        setMentionQuery('');
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        textareaRef.current?.focus();
    };

    const handleAgentSelect = (agentName: string) => {
        const textarea = textareaRef.current;
        const cursorPosition = textarea?.selectionStart ?? message.length;
        const textBeforeCursor = message.substring(0, cursorPosition);
        const lastAtSymbol = textBeforeCursor.lastIndexOf('@');

        if (lastAtSymbol !== -1) {
            const newMessage =
                message.substring(0, lastAtSymbol) +
                `@${agentName} ` +
                message.substring(cursorPosition);
            setMessage(newMessage);

            const nextCursor = lastAtSymbol + agentName.length + 2;
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.selectionStart = nextCursor;
                    textareaRef.current.selectionEnd = nextCursor;
                }
                adjustTextareaHeight();
                updateAutocompleteState(newMessage, nextCursor);
            });
        } else if (textareaRef.current) {
            const newMessage =
                message.substring(0, cursorPosition) +
                `@${agentName} ` +
                message.substring(cursorPosition);
            setMessage(newMessage);

            const nextCursor = cursorPosition + agentName.length + 2;
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.selectionStart = nextCursor;
                    textareaRef.current.selectionEnd = nextCursor;
                }
                adjustTextareaHeight();
                updateAutocompleteState(newMessage, nextCursor);
            });
        }

        setShowFileMention(false);
        setMentionQuery('');
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        textareaRef.current?.focus();
    };

    const handleSkillSelect = (skillName: string) => {
        const textarea = textareaRef.current;
        const cursorPosition = textarea?.selectionStart ?? message.length;
        const textBeforeCursor = message.substring(0, cursorPosition);
        const lastSlashSymbol = textBeforeCursor.lastIndexOf('/');

        if (lastSlashSymbol !== -1) {
            const newMessage =
                message.substring(0, lastSlashSymbol) +
                `/${skillName} ` +
                message.substring(cursorPosition);
            setMessage(newMessage);

            const nextCursor = lastSlashSymbol + skillName.length + 2;
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.selectionStart = nextCursor;
                    textareaRef.current.selectionEnd = nextCursor;
                }
                adjustTextareaHeight();
                updateAutocompleteState(newMessage, nextCursor);
            });
        }

        setShowSkillAutocomplete(false);
        setSkillQuery('');
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        textareaRef.current?.focus();
    };

    const handleSnippetSelect = (_snippet: unknown, trigger: string) => {
        const textarea = textareaRef.current;
        const cursorPosition = textarea?.selectionStart ?? message.length;
        const textBeforeCursor = message.substring(0, cursorPosition);
        const lastHashSymbol = textBeforeCursor.lastIndexOf('#');
        const startIndex = lastHashSymbol !== -1 ? lastHashSymbol : cursorPosition;
        const newMessage =
            message.substring(0, startIndex) +
            `#${trigger} ` +
            message.substring(cursorPosition);
        const nextCursor = startIndex + trigger.length + 2;

        setMessage(newMessage);
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        requestAnimationFrame(() => {
            if (textareaRef.current) {
                textareaRef.current.selectionStart = nextCursor;
                textareaRef.current.selectionEnd = nextCursor;
            }
            adjustTextareaHeight();
            updateAutocompleteState(newMessage, nextCursor);
        });

        textareaRef.current?.focus();
    };

    const handleCommandSelect = (command: CommandInfo) => {

        setMessage(`/${command.name} `);

        const textareaElement = textareaRef.current as HTMLTextAreaElement & { _commandMetadata?: typeof command };
        if (textareaElement) {
            textareaElement._commandMetadata = command;
        }

        setShowCommandAutocomplete(false);
        setCommandQuery('');
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        const refocus = () => {
            if (textareaRef.current) {
                try {
                    textareaRef.current.focus({ preventScroll: true });
                } catch {
                    textareaRef.current.focus();
                }
                textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
            }
        };

        requestAnimationFrame(() => {
            refocus();
            requestAnimationFrame(refocus);
        });
        setTimeout(refocus, 60);
    };

    React.useEffect(() => {

        if (currentSessionId && textareaRef.current && !isMobile) {
            textareaRef.current.focus();
        }
    }, [currentSessionId, isMobile]);

    React.useEffect(() => {
        if (!isMobile) {
            setMobileControlsPanel(null);
        }
    }, [isMobile]);

    React.useEffect(() => {
        if (abortPromptSessionId && abortPromptSessionId !== currentSessionId) {
            clearAbortPrompt();
        }
    }, [abortPromptSessionId, currentSessionId, clearAbortPrompt]);

    const hasDraggedFiles = React.useCallback((dataTransfer: DataTransfer | null | undefined): boolean => {
        if (!dataTransfer) return false;
        if (dataTransfer.files && dataTransfer.files.length > 0) return true;
        if (dataTransfer.types) {
            const types = Array.from(dataTransfer.types);
            const lowerTypes = types.map((type) => type.toLowerCase());
            if (lowerTypes.includes('files')) return true;
            if (lowerTypes.includes('text/uri-list')) return true;
            if (lowerTypes.includes('codefiles')) return true;
            if (lowerTypes.includes('application/x-openchamber-file-path')) return true;
            if (lowerTypes.some((type) => type.includes('vnd.code.tree'))) return true;
        }

        for (const dataType of VS_CODE_DROP_DATA_TYPES) {
            let payload = '';
            try {
                payload = dataTransfer.getData(dataType);
            } catch {
                continue;
            }
            if (payload && parseDroppedFileReferences(payload).length > 0) {
                return true;
            }
        }

        return false;
    }, []);

    const collectDroppedFiles = React.useCallback((dataTransfer: DataTransfer | null | undefined): File[] => {
        if (!dataTransfer) return [];

        const directFiles = Array.from(dataTransfer.files || []);
        if (directFiles.length > 0) {
            return directFiles;
        }

        const fromItems = Array.from(dataTransfer.items || [])
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter((file): file is File => Boolean(file));

        return fromItems;
    }, []);

    const collectDroppedFileUris = React.useCallback((dataTransfer: DataTransfer | null | undefined): string[] => {
        if (!dataTransfer || typeof dataTransfer.getData !== 'function') return [];

        const extracted = new Set<string>();

        for (const dataType of VS_CODE_DROP_DATA_TYPES) {
            let rawPayload = '';
            try {
                rawPayload = dataTransfer.getData(dataType);
            } catch {
                continue;
            }
            if (!rawPayload) {
                continue;
            }

            for (const candidate of parseDroppedFileReferences(rawPayload)) {
                extracted.add(candidate);
            }
        }

        return Array.from(extracted);
    }, []);

    const normalizeDroppedPath = React.useCallback((rawPath: string): string => {
        const input = rawPath.trim();
        if (!input.toLowerCase().startsWith('file://')) {
            return input;
        }

        try {
            let pathname = decodeURIComponent(new URL(input).pathname || '');
            if (/^\/[A-Za-z]:\//.test(pathname)) {
                pathname = pathname.slice(1);
            }
            return pathname || input;
        } catch {
            const stripped = input.replace(/^file:\/\//i, '');
            try {
                return decodeURIComponent(stripped);
            } catch {
                return stripped;
            }
        }
    }, []);

    const toProjectRelativeMentionPath = React.useCallback((absolutePath: string): string => {
        const normalizedAbsolutePath = absolutePath.replace(/\\/g, '/').trim();
        const normalizedRoot = (chatSearchDirectory || '').replace(/\\/g, '/').replace(/\/+$/, '');
        if (!normalizedRoot) {
            return normalizedAbsolutePath;
        }
        if (normalizedAbsolutePath === normalizedRoot) {
            return normalizedAbsolutePath;
        }
        const rootWithSlash = `${normalizedRoot}/`;
        if (normalizedAbsolutePath.startsWith(rootWithSlash)) {
            return normalizedAbsolutePath.slice(rootWithSlash.length);
        }
        return normalizedAbsolutePath;
    }, [chatSearchDirectory]);

    const addVSCodeDroppedUrisAsMentions = React.useCallback((uris: string[]) => {
        if (uris.length === 0) return;

        const paths = uris
            .map((entry) => normalizeDroppedPath(entry))
            .map((entry) => toProjectRelativeMentionPath(entry))
            .map((entry) => entry.trim().replace(/^\.\//, ''))
            .filter((entry) => entry.length > 0);

        for (const p of paths) {
            confirmedMentionsRef.current.add(p);
        }

        const mentions = Array.from(new Set(paths.map((entry) => `@${entry}`)));

        if (mentions.length === 0) {
            return;
        }

        setPendingInputText(mentions.join(' '), 'append-inline');
        toast.success(t('chat.chatInput.toast.addedFileMentions', { count: mentions.length }));
    }, [normalizeDroppedPath, setPendingInputText, t, toProjectRelativeMentionPath]);

    const handleDragEnter = (e: React.DragEvent) => {
        if (!hasDraggedFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        dragEnterCountRef.current++;
        const isInternal = e.dataTransfer.types?.includes('application/x-openchamber-file-path') ?? false;
        if (isInternal !== isInternalDrag) {
            setIsInternalDrag(isInternal);
        }
        if ((currentSessionId || newSessionDraftOpen) && !isDragging) {
            setIsDragging(true);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!hasDraggedFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        if ((currentSessionId || newSessionDraftOpen) && !isDragging) {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragEnterCountRef.current--;
        if (dragEnterCountRef.current <= 0) {
            dragEnterCountRef.current = 0;
            setIsDragging(false);
            setIsInternalDrag(false);
            clearDropTextSuppression();
        }
    };

    const handleDragEnd = () => {
        dragEnterCountRef.current = 0;
        setIsDragging(false);
        setIsInternalDrag(false);
        clearDropTextSuppression();
    };

    const handleDrop = async (e: React.DragEvent) => {
        dragEnterCountRef.current = 0;
        const draggedFiles = hasDraggedFiles(e.dataTransfer);
        if (!draggedFiles) {
            clearDropTextSuppression();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (!currentSessionId && !newSessionDraftOpen) return;

        // Internal drag: file tree → chat input (relative path as @mention)
        const internalPath = e.dataTransfer.getData('application/x-openchamber-file-path');
        if (internalPath && internalPath !== '.') {
            confirmedMentionsRef.current.add(internalPath);
            const mention = `@${internalPath}`;
            const textarea = textareaRef.current;
            const currentMessage = messageRef.current;
            if (textarea) {
                const pos = textarea.selectionStart ?? cursorPosRef.current;
                const end = textarea.selectionEnd ?? pos;
                const before = currentMessage.slice(0, pos);
                const after = currentMessage.slice(end);
                const needSpaceBefore = before.length > 0 && !/\s$/.test(before);
                const needSpaceAfter = after.length > 0 && !/^\s/.test(after);
                const insert = `${needSpaceBefore ? ' ' : ''}${mention}${needSpaceAfter ? ' ' : ''}`;
                const nextMessage = `${before}${insert}${after}`;
                setMessage(nextMessage);
                requestAnimationFrame(() => {
                    const cursorPos = pos + insert.length;
                    textarea.selectionStart = cursorPos;
                    textarea.selectionEnd = cursorPos;
                    cursorPosRef.current = cursorPos;
                    textarea.focus();
                });
            } else {
                setMessage((prev) => appendInlineText(prev, mention));
            }
            clearDropTextSuppression();
            return;
        }

        const files = collectDroppedFiles(e.dataTransfer);

        if (files.length === 0 && isVSCodeRuntime()) {
            const droppedUris = collectDroppedFileUris(e.dataTransfer);
            if (droppedUris.length > 0) {
                pendingDroppedAbsolutePathsRef.current = droppedUris
                    .map((entry) => normalizeDroppedPath(entry))
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0);
                addVSCodeDroppedUrisAsMentions(droppedUris);
            } else {
                clearDropTextSuppression();
            }
            return;
        }

        if (files.length > 0) {
            for (const file of files) {
                try {
                    await addAttachedFile(file);
                } catch (error) {
                    console.error('File attach failed', error);
                    toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.attachFileFailed'));
                }
            }
        }
        clearDropTextSuppression();
    };

    const handleDropCapture = (e: React.DragEvent) => {
        if (!hasDraggedFiles(e.dataTransfer)) {
            return;
        }
        // Prevent native textarea drop text insertion for all runtimes
        e.preventDefault();
        if (isVSCodeRuntime()) {
            suppressNextFileDropTextInsertRef.current = true;
            scheduleDropTextSuppressionExpiry();
        }
    };

    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const attachFiles = React.useCallback(async (files: FileList | File[]) => {
        const list = Array.isArray(files) ? files : Array.from(files);

        for (const file of list) {
            try {
                await addAttachedFile(file);
            } catch (error) {
                console.error('File attach failed', error);
                toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.attachFileFailed'));
            }
        }
    }, [addAttachedFile, t]);

    const handleVSCodePickFiles = React.useCallback(async () => {
        try {
            const response = await fetch('/api/vscode/pick-files');
            const data = await response.json();
            const picked = Array.isArray(data?.files) ? data.files : [];
            const skipped = Array.isArray(data?.skipped) ? data.skipped : [];

            if (skipped.length > 0) {
                const summary = skipped
                    .map((s: { name?: string; reason?: string }) => `${s?.name || 'file'}: ${s?.reason || 'skipped'}`)
                    .join('\n');
                toast.error(t('chat.chatInput.toast.someFilesSkipped', { summary }));
            }

            const asFiles = picked
                .map((file: { name: string; mimeType?: string; dataUrl?: string }) => {
                    if (!file?.dataUrl) return null;
                    try {
                        const [meta, base64] = file.dataUrl.split(',');
                        const mime = file.mimeType || (meta?.match(/data:(.*);base64/)?.[1] || 'application/octet-stream');
                        if (!base64) return null;
                        const binary = atob(base64);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) {
                            bytes[i] = binary.charCodeAt(i);
                        }
                        const blob = new Blob([bytes], { type: mime });
                        return new File([blob], file.name || 'file', { type: mime });
                    } catch (err) {
                        console.error('Failed to decode VS Code picked file', err);
                        return null;
                    }
                })
                .filter(Boolean) as File[];

            if (asFiles.length > 0) {
                await attachFiles(asFiles);
            }
        } catch (error) {
            console.error('VS Code file pick failed', error);
            toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.vscodePickFailed'));
        }
    }, [attachFiles, t]);

    const handlePickLocalFiles = React.useCallback(() => {
        if (isVSCodeRuntime()) {
            void handleVSCodePickFiles();
            return;
        }
        fileInputRef.current?.click();
    }, [handleVSCodePickFiles]);

    const handleLocalFileSelect = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;
        await attachFiles(files);
        event.target.value = '';
    }, [attachFiles]);

    const footerGapClass = 'gap-x-1.5 gap-y-0';
    const isVSCode = isVSCodeRuntime();
    const showDraftTargetSelectors = newSessionDraftOpen && !isVSCode && newSessionDraft?.preserveDirectoryOverride !== false;

    const selectedDraftProject = React.useMemo(() => {
        if (newSessionDraft?.preserveDirectoryOverride === false) {
            return null;
        }
        const explicit = newSessionDraft?.selectedProjectId
            ? projects.find((project) => project.id === newSessionDraft.selectedProjectId) ?? null
            : null;
        if (explicit) {
            return explicit;
        }

        const draftDirectory = normalizePath(newSessionDraft?.bootstrapPendingDirectory ?? null)
            ?? normalizePath(newSessionDraft?.directoryOverride ?? null);
        const inferred = resolveProjectForSessionDirectory(projects, availableWorktreesByProject, draftDirectory);
        if (inferred) {
            return inferred;
        }

        const active = activeProjectId
            ? projects.find((project) => project.id === activeProjectId) ?? null
            : null;
        if (active) {
            return active;
        }

        return projects[0] ?? null;
    }, [activeProjectId, availableWorktreesByProject, newSessionDraft?.bootstrapPendingDirectory, newSessionDraft?.directoryOverride, newSessionDraft?.preserveDirectoryOverride, newSessionDraft?.selectedProjectId, projects]);

    const selectedDraftProjectPath = React.useMemo(
        () => normalizePath(selectedDraftProject?.path ?? null),
        [selectedDraftProject?.path],
    );

    const selectedDraftProjectBranches = useGitBranches(selectedDraftProjectPath);
    const selectedDraftProjectIsGitRepo = useIsGitRepo(selectedDraftProjectPath);
    const fetchGitStatus = useGitStore((state) => state.fetchStatus);
    const fetchBranches = useGitStore((state) => state.fetchBranches);
    const [isDiscoveringDraftBranches, setIsDiscoveringDraftBranches] = React.useState(false);

    React.useEffect(() => {
        if (!showDraftTargetSelectors || !selectedDraftProjectPath || !runtimeGit || selectedDraftProjectIsGitRepo !== null) {
            return;
        }

        void fetchGitStatus(selectedDraftProjectPath, runtimeGit, { silent: true });
    }, [fetchGitStatus, runtimeGit, selectedDraftProjectIsGitRepo, selectedDraftProjectPath, showDraftTargetSelectors]);

    React.useEffect(() => {
        if (!showDraftTargetSelectors || !selectedDraftProjectPath || !selectedDraftProject || !runtimeGit || selectedDraftProjectIsGitRepo !== true) {
            setIsDiscoveringDraftBranches(false);
            return;
        }

        if (selectedDraftProjectBranches?.all) {
            setIsDiscoveringDraftBranches(false);
            return;
        }

        let cancelled = false;
        setIsDiscoveringDraftBranches(true);

        void fetchBranches(selectedDraftProjectPath, runtimeGit)
            .finally(() => {
                if (!cancelled) {
                    setIsDiscoveringDraftBranches(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [fetchBranches, runtimeGit, selectedDraftProject, selectedDraftProjectBranches?.all, selectedDraftProjectIsGitRepo, selectedDraftProjectPath, showDraftTargetSelectors]);

    const selectedDraftProjectCurrentBranch = selectedDraftProjectBranches?.current?.trim() ?? '';

    const projectRootBranchOption = React.useMemo(() => {
        if (!selectedDraftProject) {
            return null;
        }
        const value = normalizePath(selectedDraftProject.path);
        if (!value) {
            return null;
        }
        if (!selectedDraftProjectCurrentBranch) {
            return null;
        }
        return {
            value,
            label: selectedDraftProjectCurrentBranch,
        };
    }, [selectedDraftProject, selectedDraftProjectCurrentBranch]);

    const worktreeBranchOptions = React.useMemo(() => {
        if (!selectedDraftProject) {
            return [];
        }

        const worktrees = selectedDraftProjectPath
            ? getWorktreesForProject(
                availableWorktreesByProject,
                selectedDraftProjectPath,
                selectedDraftProject.serverId,
            )
            : [];

        return buildSessionTargetOptions({
            projectRoot: normalizePath(selectedDraftProject.path) ?? '',
            rootBranch: selectedDraftProjectCurrentBranch,
            worktrees,
            pendingBootstrapDirectory: newSessionDraft?.bootstrapPendingDirectory ?? null,
        });
    }, [availableWorktreesByProject, newSessionDraft?.bootstrapPendingDirectory, selectedDraftProject, selectedDraftProjectCurrentBranch, selectedDraftProjectPath]);

    const selectedDraftDirectory = React.useMemo(
        () => normalizePath(newSessionDraft?.bootstrapPendingDirectory ?? null)
            ?? normalizePath(newSessionDraft?.directoryOverride ?? null)
            ?? selectedDraftProjectPath,
        [newSessionDraft?.bootstrapPendingDirectory, newSessionDraft?.directoryOverride, selectedDraftProjectPath],
    );

    const shouldKeepMissingSelectedDraftDirectory = React.useMemo(() => {
        const pendingDirectory = normalizePath(newSessionDraft?.bootstrapPendingDirectory ?? null);
        return Boolean(
            newSessionDraft?.preserveDirectoryOverride
            ||
            newSessionDraft?.pendingWorktreeRequestId
            || (pendingDirectory && pendingDirectory === selectedDraftDirectory)
        );
    }, [newSessionDraft?.bootstrapPendingDirectory, newSessionDraft?.pendingWorktreeRequestId, newSessionDraft?.preserveDirectoryOverride, selectedDraftDirectory]);

    const draftBranchItems = React.useMemo(() => {
        const baseItems: Array<{ value: string; label: string }> = [];
        if (projectRootBranchOption) {
            baseItems.push(projectRootBranchOption);
        }
        baseItems.push(...worktreeBranchOptions);

        if (!selectedDraftDirectory) {
            return baseItems;
        }
        if (baseItems.some((option) => option.value === selectedDraftDirectory)) {
            return baseItems;
        }
        if (!shouldKeepMissingSelectedDraftDirectory) {
            return baseItems;
        }
        return [
            ...baseItems,
            { value: selectedDraftDirectory, label: formatDirectoryName(selectedDraftDirectory) },
        ];
    }, [projectRootBranchOption, selectedDraftDirectory, shouldKeepMissingSelectedDraftDirectory, worktreeBranchOptions]);

    const selectedDraftBranchLabel = React.useMemo(() => {
        const selectedValue = selectedDraftDirectory ?? draftBranchItems[0]?.value ?? null;
        if (!selectedValue) {
            return null;
        }
        return draftBranchItems.find((item) => item.value === selectedValue)?.label ?? formatDirectoryName(selectedValue);
    }, [draftBranchItems, selectedDraftDirectory]);

    const chatSurfaceMode = useChatSurfaceMode();
    const isMiniChatSurface = chatSurfaceMode === 'mini-chat';

    const hasPendingChanges = React.useMemo(() => {
        if (isMiniChatSurface) {
            return false;
        }
        if (isGitRepo !== true || !currentGitStatus || currentGitStatus.isClean) {
            return false;
        }
        return extractGitChangedFiles(currentGitStatus.files, currentGitStatus.diffStats, currentDirectory).length > 0;
    }, [currentDirectory, currentGitStatus, isGitRepo, isMiniChatSurface]);

    const selectedDraftBranchIsKnown = React.useMemo(() => {
        if (!selectedDraftDirectory) {
            return true;
        }
        if (projectRootBranchOption?.value === selectedDraftDirectory) {
            return true;
        }
        return worktreeBranchOptions.some((option) => option.value === selectedDraftDirectory);
    }, [projectRootBranchOption?.value, selectedDraftDirectory, worktreeBranchOptions]);

    React.useEffect(() => {
        if (!newSessionDraft?.open || !newSessionDraft?.preserveDirectoryOverride) {
            return;
        }
        if (!selectedDraftDirectory || !selectedDraftBranchIsKnown) {
            return;
        }
        useSessionUIStore.getState().setDraftPreserveDirectoryOverride(false);
    }, [newSessionDraft?.open, newSessionDraft?.preserveDirectoryOverride, selectedDraftBranchIsKnown, selectedDraftDirectory]);

    const shouldShowDraftBranchSelector = React.useMemo(() => {
        if (selectedDraftProjectIsGitRepo !== true) {
            return false;
        }
        if (isDiscoveringDraftBranches) {
            return false;
        }
        if (projectRootBranchOption) {
            return true;
        }
        return worktreeBranchOptions.length > 0;
    }, [isDiscoveringDraftBranches, projectRootBranchOption, selectedDraftProjectIsGitRepo, worktreeBranchOptions.length]);

    const handleDraftProjectChange = React.useCallback((projectId: string) => {
        const draft = useSessionUIStore.getState().newSessionDraft;
        if (draft?.pendingWorktreeRequestId || draft?.bootstrapPendingDirectory || draft?.preserveDirectoryOverride) {
            return;
        }
        const project = projects.find((entry) => entry.id === projectId);
        if (!project) {
            return;
        }
        if (activeProjectId !== projectId) {
            setActiveProjectIdOnly(projectId);
        }
        setNewSessionDraftTarget({
            projectId,
            directoryOverride: project.path,
        }, { force: true });
    }, [activeProjectId, projects, setActiveProjectIdOnly, setNewSessionDraftTarget]);

    const handleDraftDirectoryChange = React.useCallback((directory: string) => {
        const draft = useSessionUIStore.getState().newSessionDraft;
        if (draft?.pendingWorktreeRequestId || draft?.bootstrapPendingDirectory || draft?.preserveDirectoryOverride) {
            return;
        }
        if (!selectedDraftProject) {
            return;
        }
        setNewSessionDraftTarget({
            projectId: selectedDraftProject.id,
            directoryOverride: directory,
        }, { force: true });
    }, [selectedDraftProject, setNewSessionDraftTarget]);

    const renderProjectLabelWithIcon = React.useCallback((project: {
        id: string;
        path: string;
        label?: string;
        icon?: string | null;
        color?: string | null;
        iconImage?: { mime: string; updatedAt: number; source: 'custom' | 'auto' } | null;
        iconBackground?: string | null;
    }) => {
        const imageUrl = getProjectIconImageUrl(
            { id: project.id, iconImage: project.iconImage ?? null },
            {
                themeVariant: currentTheme.metadata.variant,
                iconColor: currentTheme.colors.surface.foreground,
            },
        );
        const projectIconName = project.icon ? PROJECT_ICON_MAP[project.icon] : null;
        const iconColor = getProjectIconColor(project.color);

        return (
            <span className="inline-flex min-w-0 items-center gap-1.5">
                {imageUrl ? (
                    <span
                        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[3px]"
                        style={project.iconBackground ? { backgroundColor: project.iconBackground } : undefined}
                    >
                        <img src={imageUrl} alt="" className="h-full w-full object-contain" draggable={false} />
                    </span>
                ) : projectIconName ? (
                    <Icon name={projectIconName} className="h-3.5 w-3.5 shrink-0" style={iconColor ? { color: iconColor } : undefined} />
                ) : (
                    <Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80"  style={iconColor ? { color: iconColor } : undefined}/>
                )}
                <span className="truncate">{getProjectDisplayLabel(project)}</span>
            </span>
        );
    }, [currentTheme.colors.surface.foreground, currentTheme.metadata.variant]);

    React.useEffect(() => {
        if (!showDraftTargetSelectors || !selectedDraftProject || !selectedDraftDirectory) {
            return;
        }
        if (newSessionDraft?.pendingWorktreeRequestId || newSessionDraft?.bootstrapPendingDirectory || newSessionDraft?.preserveDirectoryOverride) {
            return;
        }
        const valid = draftBranchItems.some((option) => option.value === selectedDraftDirectory);
        if (valid) {
            return;
        }
        setNewSessionDraftTarget({
            projectId: selectedDraftProject.id,
            directoryOverride: selectedDraftProject.path,
        });
    }, [draftBranchItems, newSessionDraft?.bootstrapPendingDirectory, newSessionDraft?.pendingWorktreeRequestId, newSessionDraft?.preserveDirectoryOverride, selectedDraftDirectory, selectedDraftProject, setNewSessionDraftTarget, showDraftTargetSelectors]);

    const footerPaddingClass = isMobile ? 'px-1.5 py-1.5' : (isVSCode ? 'px-1.5 py-1' : 'px-2.5 py-1.5');
    const buttonSizeClass = isMobile ? 'h-8 w-8' : (isVSCode ? 'h-5 w-5' : 'h-6 w-6');
    const runningActionOffsetClass = isMobile
        ? 'translate-x-[calc(-50%+1.125rem)]'
        : (isVSCode ? 'translate-x-[calc(-50%+0.75rem)]' : 'translate-x-[calc(-50%+0.875rem)]');
    const sendIconSizeClass = isMobile ? 'h-4 w-4' : (isVSCode ? 'h-3.5 w-3.5' : 'h-4 w-4');
    const stopIconSizeClass = isMobile ? 'h-6 w-6' : (isVSCode ? 'h-4 w-4' : 'h-5 w-5');
    const iconSizeClass = isMobile ? 'h-[18px] w-[18px]' : (isVSCode ? 'h-4 w-4' : 'h-[18px] w-[18px]');

    const iconButtonBaseClass = 'flex cursor-pointer items-center justify-center text-foreground transition-none outline-none focus:outline-none flex-shrink-0 disabled:cursor-not-allowed';
    const footerIconButtonClass = cn(iconButtonBaseClass, buttonSizeClass);
    const permissionScopeSessionId = currentSessionId ?? currentManagementSessionId;
    const permissionAutoAcceptEnabled = usePermissionStore((state) => {
        if (!permissionScopeSessionId) {
            return false;
        }
        return state.isSessionAutoAccepting(permissionScopeSessionId);
    });

    const handlePermissionAutoAcceptToggle = React.useCallback(() => {
        if (!permissionScopeSessionId) {
            toast.error(t('chat.chatInput.toast.openSessionFirst'));
            return;
        }

        const nextEnabled = !permissionAutoAcceptEnabled;
        setSessionAutoAccept(permissionScopeSessionId, nextEnabled).catch(() => {
            toast.error(t('chat.chatInput.toast.togglePermissionAutoAcceptFailed'));
        });
    }, [permissionAutoAcceptEnabled, permissionScopeSessionId, setSessionAutoAccept, t]);

    React.useEffect(() => {
        return () => {
            if (abortFeedbackTimeoutRef.current) {
                clearTimeout(abortFeedbackTimeoutRef.current);
                abortFeedbackTimeoutRef.current = null;
            }
        };
    }, []);

    return (
        <>
        <form
            onSubmit={(e) => { e.preventDefault(); handlePrimaryAction(); }}
            className={cn(
                "relative pt-0 pb-4",
                isDesktopExpanded && 'flex h-full min-h-0 flex-col pt-4',
                isMobile && 'bottom-safe-area'
            )}
            style={isMobile && inputBarOffset > 0 ? { marginBottom: `${inputBarOffset}px` } : undefined}
        >
            <div className={cn('chat-input-column relative overflow-visible', isDesktopExpanded && 'flex flex-1 min-h-0 flex-col')}>
                {showImageFallbackNotice && (
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-1.5">
                        <Icon name="file-image" className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="typography-meta text-muted-foreground">
                            {pluginLoaded === false
                                ? t('chat.input.imagePluginNotLoaded')
                                : t('chat.input.imageFallbackNotice')}
                        </span>
                    </div>
                )}
                <AttachedFilesList />
                <QueuedMessageChips
                    onEditMessage={handleQueuedMessageEdit}
                    onSendMessage={handleQueuedMessageSend}
                />
                {hasDrafts && (
                    <div className="flex flex-wrap items-center gap-2 pb-2">
                        {reviewCount > 0 ? (
                            <div
                                className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1"
                                style={{
                                    backgroundColor: currentTheme?.colors?.surface?.elevated,
                                    borderColor: currentTheme?.colors?.interactive?.border,
                                }}
                            >
                                <span className="text-xs font-medium text-muted-foreground">{t('chat.chatInput.reviewComments')}</span>
                                <span className="text-xs font-semibold" style={{ color: currentTheme?.colors?.status?.info }}>{reviewCount}</span>
                            </div>
                        ) : null}
                        {previewConsoleCount > 0 ? (
                            <div
                                className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1"
                                style={{
                                    backgroundColor: currentTheme?.colors?.surface?.elevated,
                                    borderColor: currentTheme?.colors?.interactive?.border,
                                }}
                            >
                                <span className="text-xs font-medium text-muted-foreground">{t('chat.chatInput.devServerLogs')}</span>
                                <span className="text-xs font-semibold" style={{ color: currentTheme?.colors?.status?.info }}>{previewConsoleCount}</span>
                                <button
                                    type="button"
                                    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
                                    onClick={() => removePreviewDrafts('preview-console')}
                                    aria-label={t('chat.chatInput.devServerLogsRemove')}
                                    title={t('chat.chatInput.devServerLogsRemove')}
                                >
                                    <Icon name="close" className="h-3 w-3" />
                                </button>
                            </div>
                        ) : null}
                        {previewAnnotationCount > 0 ? (
                            <div
                                className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1"
                                style={{
                                    backgroundColor: currentTheme?.colors?.surface?.elevated,
                                    borderColor: currentTheme?.colors?.interactive?.border,
                                }}
                            >
                                <span className="text-xs font-medium text-muted-foreground">{t('chat.chatInput.previewAnnotations')}</span>
                                <span className="text-xs font-semibold" style={{ color: currentTheme?.colors?.status?.info }}>{previewAnnotationCount}</span>
                                <button
                                    type="button"
                                    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
                                    onClick={() => removePreviewDrafts('preview-annotation')}
                                    aria-label={t('chat.chatInput.previewContextRemove')}
                                    title={t('chat.chatInput.previewContextRemove')}
                                >
                                    <Icon name="close" className="h-3 w-3" />
                                </button>
                            </div>
                        ) : null}
                    </div>
                )}

                {/* Linked Issue row */}
                {linkedIssue && !isVSCode && (
                    <div className="pb-2 w-full px-1">
                        <div className="flex w-full items-center gap-1.5 text-sm h-5 px-1">
                            <button
                                type="button"
                                onClick={() => setIssuePickerOpen(true)}
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
                            >
                                {linkedIssue.author?.avatarUrl && (
                                    <img
                                        src={linkedIssue.author.avatarUrl}
                                        alt={linkedIssue.author.login}
                                        className="h-5 w-5 rounded-full flex-shrink-0"
                                    />
                                )}
                                <span className="text-muted-foreground flex-shrink-0">
                                    #{linkedIssue.number}
                                    {linkedIssue.author && (
                                        <span className="ml-1">{t('chat.chatInput.linked.byAuthor', { author: linkedIssue.author.login })}</span>
                                    )}
                                </span>
                                <span className="text-foreground truncate">
                                    {linkedIssue.title}
                                </span>
                            </button>
                            <span className="flex items-center gap-0.5 flex-shrink-0">
                                <a
                                    href={linkedIssue.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center h-6 w-6 hover:bg-[var(--interactive-hover)] rounded-full transition-colors"
                                    aria-label={t('chat.chatInput.linked.issue.openInBrowserAria')}
                                >
                                    <Icon name="external-link" className="h-4 w-4 text-muted-foreground" />
                                </a>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLinkedIssue(null);
                                    }}
                                    className="flex items-center justify-center h-6 w-6 hover:bg-[var(--interactive-hover)] rounded-full transition-colors"
                                    aria-label={t('chat.chatInput.linked.issue.removeAria')}
                                    title={t('chat.chatInput.linked.issue.removeAria')}
                                >
                                    <Icon name="close" className="h-4 w-4 text-muted-foreground" />
                                </button>
                            </span>
                        </div>
                    </div>
                )}
                {linkedPr && !isVSCode && (
                    <div className="pb-2 w-full px-1">
                        <div className="flex w-full items-center gap-1.5 text-sm h-5 px-1">
                            <button
                                type="button"
                                onClick={() => setPrPickerOpen(true)}
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
                            >
                                {linkedPr.author?.avatarUrl && (
                                    <img
                                        src={linkedPr.author.avatarUrl}
                                        alt={linkedPr.author.login}
                                        className="h-5 w-5 rounded-full flex-shrink-0"
                                    />
                                )}
                                <span className="text-muted-foreground flex-shrink-0">
                                    {t('chat.chatInput.linked.pr.number', { number: linkedPr.number })}
                                    {linkedPr.author && (
                                        <span className="ml-1">{t('chat.chatInput.linked.byAuthor', { author: linkedPr.author.login })}</span>
                                    )}
                                </span>
                                <span className="text-foreground truncate">
                                    {linkedPr.title}
                                </span>
                                <span className="text-muted-foreground flex-shrink-0 typography-meta">
                                    {linkedPr.head} → {linkedPr.base}
                                </span>
                            </button>
                            <span className="flex items-center gap-0.5 flex-shrink-0">
                                <a
                                    href={linkedPr.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center h-6 w-6 hover:bg-[var(--interactive-hover)] rounded-full transition-colors"
                                    aria-label={t('chat.chatInput.linked.pr.openInBrowserAria')}
                                >
                                    <Icon name="external-link" className="h-4 w-4 text-muted-foreground" />
                                </a>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLinkedPr(null);
                                    }}
                                    className="flex items-center justify-center h-6 w-6 hover:bg-[var(--interactive-hover)] rounded-full transition-colors"
                                    aria-label={t('chat.chatInput.linked.pr.removeAria')}
                                    title={t('chat.chatInput.linked.pr.removeAria')}
                                >
                                    <Icon name="close" className="h-4 w-4 text-muted-foreground" />
                                </button>
                            </span>
                        </div>
                    </div>
                )}
                <RevertedMessageDock
                    sessionId={currentSessionId}
                    directory={currentSessionDirectoryForSync ?? currentDirectory}
                />
                <MemoStatusRow
                    showAssistantStatus={false}
                    showTodos
                    leftAccessory={newSessionDraftOpen || !hasPendingChanges ? null : <PendingChangesBar />}
                />
                {showDraftTargetSelectors && selectedDraftProject ? (
                    <div className="mb-1.5 flex min-w-0 items-center gap-1.5 px-0.5">
                        <Select
                            value={selectedDraftProject.id}
                            onValueChange={handleDraftProjectChange}
                        >
                            <SelectTrigger
                                size="sm"
                                className="h-7 min-w-0 w-fit max-w-[42vw] sm:max-w-[18rem] border-transparent bg-transparent px-1.5 hover:bg-transparent data-[popup-open]:bg-transparent"
                            >
                                <SelectValue>
                                    {renderProjectLabelWithIcon(selectedDraftProject)}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent fitContent>
                                {projects.map((project) => (
                                    <SelectItem key={project.id} value={project.id} className="max-w-[24rem] truncate">
                                        {renderProjectLabelWithIcon(project)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {shouldShowDraftBranchSelector ? (
                            <Select
                                value={selectedDraftDirectory ?? draftBranchItems[0]?.value ?? normalizePath(selectedDraftProject.path) ?? ''}
                                onValueChange={handleDraftDirectoryChange}
                            >
                                <SelectTrigger
                                    size="sm"
                                    className="h-7 min-w-0 w-fit max-w-[48vw] sm:max-w-[20rem] border-transparent bg-transparent px-1.5 hover:bg-transparent data-[popup-open]:bg-transparent"
                                >
                                    <SelectValue>
                                        {selectedDraftBranchLabel ?? t('chat.chatInput.branch')}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent fitContent>
                                    {projectRootBranchOption ? (
                                        <SelectGroup>
                                            <SelectLabel>{t('chat.chatInput.projectRoot')}</SelectLabel>
                                            <SelectItem key={projectRootBranchOption.value} value={projectRootBranchOption.value} className="max-w-[24rem] truncate">
                                                {projectRootBranchOption.label}
                                            </SelectItem>
                                        </SelectGroup>
                                    ) : null}
                                    {projectRootBranchOption ? <SelectSeparator /> : null}
                                    <SelectGroup>
                                        <div className="flex items-center justify-between px-2 py-1.5">
                                            <span className="text-muted-foreground typography-meta">{t('chat.chatInput.worktrees')}</span>
                                            <button
                                                type="button"
                                                className="text-muted-foreground typography-meta hover:text-foreground cursor-pointer"
                                                onPointerDown={(e) => { e.stopPropagation(); }}
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void createWorktreeDraft(); }}
                                            >
                                                {t('chat.chatInput.worktreeNew')}
                                            </button>
                                        </div>
                                        {worktreeBranchOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value} className="max-w-[24rem] truncate">
                                                {option.pending ? '⏳ ' : ''}{option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                    {selectedDraftDirectory && !selectedDraftBranchIsKnown ? (
                                        <SelectItem value={selectedDraftDirectory} className="max-w-[24rem] truncate">
                                            {selectedDraftBranchLabel}
                                        </SelectItem>
                                    ) : null}
                                </SelectContent>
                            </Select>
                        ) : null}
                    </div>
                ) : null}
                <div
                    className={cn(
                        "flex flex-col relative overflow-visible",
                        isDesktopExpanded && 'flex-1 min-h-0',
                        "border border-border/80",
                        "focus-within:ring-1",
                        inputMode === 'shell'
                            ? 'focus-within:ring-[var(--status-info)]'
                            : 'focus-within:ring-primary/50',
                        isDragging && "ring-2 ring-primary ring-offset-2"
                    )}
                    style={{
                        borderRadius: chatInputRadius,
                        backgroundColor: currentTheme?.colors?.surface?.subtle,
                    }}
                    ref={dropZoneRef}
                    onDropCapture={handleDropCapture}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                >
                    {isDragging && (
                        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 rounded-xl">
                            <div className="text-center">
                                <div className="inline-flex justify-center">
                                    <button
                                        type="button"
                                        className={iconButtonBaseClass}
                                        onClick={() => handlePickLocalFiles()}
                                        title={t('chat.chatInput.actions.attachFiles')}
                                        aria-label={t('chat.chatInput.actions.attachFiles')}
                                    >
                                        <Icon name="attachment-2" className={cn(iconSizeClass, 'text-current')} />
                                    </button>
                                </div>
                                <p className="mt-2 typography-ui-label text-muted-foreground">
                                    {isInternalDrag ? t('chat.chatInput.drop.insertMention') : t('chat.chatInput.drop.attachFiles')}
                                </p>
                            </div>
                        </div>
                    )}

                    {showCommandAutocomplete && (
                        <CommandAutocomplete
                            ref={commandRef}
                            searchQuery={commandQuery}
                            onCommandSelect={handleCommandSelect}
                            showTabs={isMobile}
                            activeTab={autocompleteTab}
                            onTabSelect={handleAutocompleteTabSelect}
                            onClose={() => setShowCommandAutocomplete(false)}
                            style={isDesktopExpanded && autocompleteOverlayPosition
                                ? {
                                    left: '0px',
                                    top: `${autocompleteOverlayPosition.top}px`,
                                    bottom: 'auto',
                                    width: '100%',
                                    maxHeight: `${autocompleteOverlayPosition.maxHeight}px`,
                                    transform: autocompleteOverlayPosition.place === 'above' ? 'translateY(-100%)' : undefined,
                                }
                                : undefined}
                        />
                    )}
                    { }
                    {showSkillAutocomplete && (
                        <SkillAutocomplete
                            ref={skillRef}
                            searchQuery={skillQuery}
                            onSkillSelect={handleSkillSelect}
                            onClose={() => setShowSkillAutocomplete(false)}
                            style={isDesktopExpanded && autocompleteOverlayPosition
                                ? {
                                    left: '0px',
                                    top: `${autocompleteOverlayPosition.top}px`,
                                    bottom: 'auto',
                                    width: '100%',
                                    maxHeight: `${autocompleteOverlayPosition.maxHeight}px`,
                                    transform: autocompleteOverlayPosition.place === 'above' ? 'translateY(-100%)' : undefined,
                                }
                                : undefined}
                        />
                    )}

                    {showSnippetAutocomplete && (
                        <SnippetAutocomplete
                            ref={snippetRef}
                            searchQuery={snippetQuery}
                            onSnippetSelect={handleSnippetSelect}
                            onClose={() => setShowSnippetAutocomplete(false)}
                            style={isDesktopExpanded && autocompleteOverlayPosition
                                ? {
                                    left: `${autocompleteOverlayPosition.left}px`,
                                    top: `${autocompleteOverlayPosition.top}px`,
                                    bottom: 'auto',
                                    width: `min(450px, calc(100% - ${autocompleteOverlayPosition.left + 8}px))`,
                                    maxHeight: `${autocompleteOverlayPosition.maxHeight}px`,
                                    transform: autocompleteOverlayPosition.place === 'above' ? 'translateY(-100%)' : undefined,
                                }
                                : undefined}
                        />
                    )}

                    {showFileMention && (

                        <FileMentionAutocomplete
                            ref={mentionRef}
                            searchQuery={mentionQuery}
                            onFileSelect={handleFileSelect}
                            onAgentSelect={handleAgentSelect}
                            showTabs={isMobile}
                            activeTab={autocompleteTab}
                            onTabSelect={handleAutocompleteTabSelect}
                            onClose={() => setShowFileMention(false)}
                            style={isDesktopExpanded && autocompleteOverlayPosition
                                ? {
                                    left: `${autocompleteOverlayPosition.left}px`,
                                    top: `${autocompleteOverlayPosition.top}px`,
                                    bottom: 'auto',
                                    width: `min(520px, calc(100% - ${autocompleteOverlayPosition.left + 8}px))`,
                                    maxHeight: `${autocompleteOverlayPosition.maxHeight}px`,
                                    transform: autocompleteOverlayPosition.place === 'above' ? 'translateY(-100%)' : undefined,
                                }
                                : undefined}
                        />
                    )}
                    <div className={cn("overflow-hidden", isDesktopExpanded && 'flex flex-1 min-h-0 flex-col')}>
                        <div className="flex items-center gap-1 px-3 pt-1 flex-wrap relative z-10">
                            <AttachedVSCodeFileChips />
                            <ActiveEditorFileSuggestion />
                        </div>
                        <div className={cn("relative overflow-hidden", isDesktopExpanded && 'flex flex-1 min-h-0 flex-col')}>
                            {highlightedComposerContent && (
                                <div
                                    aria-hidden
                                    className={cn(
                                        'pointer-events-none absolute inset-0 z-0 whitespace-pre-wrap break-words px-3 rounded-b-none',
                                        isDesktopExpanded
                                            ? 'h-full min-h-0 py-4'
                                            : isMobile
                                                ? 'py-2.5'
                                                : 'pt-4 pb-2',
                                        inputMode === 'shell' ? 'font-mono' : 'typography-markdown md:typography-ui-label',
                                    )}
                                    ref={composerHighlightRef}
                                >
                                    {highlightedComposerContent.map((part, index) => (
                                        <span
                                            key={`${index}-${part.text.length}`}
                                            className={part.className}
                                        >
                                            {part.text}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <Textarea
                                simple
                                ref={textareaRef}
                                data-chat-input="true"
                                value={message}
                                onChange={handleTextChange}
                                onBeforeInput={handleBeforeInput}
                                onKeyDown={handleKeyDown}
                                onPaste={handlePaste}
                                onDragEnter={handleDragEnter}
                                onDragOver={handleDragOver}
                                onDropCapture={handleDropCapture}
                                onDrop={handleDrop}
                                onDragEnd={handleDragEnd}
                                onKeyUp={updateAutocompleteOverlayPosition}
                                onClick={updateAutocompleteOverlayPosition}
                                onScroll={(event) => {
                                    updateAutocompleteOverlayPosition();
                                    const scrollTop = event.currentTarget.scrollTop;
                                    if (composerHighlightRef.current) {
                                        composerHighlightRef.current.style.transform = `translateY(-${scrollTop}px)`;
                                    }
                                }}
                                onSelect={(e) => {
                                    const ta = e.currentTarget;
                                    cursorPosRef.current = ta.selectionStart ?? 0;
                                    updateAutocompleteOverlayPosition();
                                }}
                                placeholder={currentSessionId || newSessionDraftOpen
                                    ? inputMode === 'shell'
                                        ? t('chat.chatInput.placeholder.shell')
                                        : t(useCompactChatPlaceholder ? 'chat.chatInput.placeholder.chatCompact' : 'chat.chatInput.placeholder.chat')
                                    : t('chat.chatInput.placeholder.selectSession')}
                                disabled={!currentSessionId && !newSessionDraftOpen}
                                autoCorrect={isMobile ? "on" : "off"}
                                autoCapitalize={isMobile ? "sentences" : "off"}
                                spellCheck={isMobile || inputSpellcheckEnabled}
                                fillContainer={isDesktopExpanded}
                                outerClassName={cn('ring-0 bg-transparent shadow-none hover:bg-transparent focus-within:ring-0', isDesktopExpanded && 'flex-1 min-h-0')}
                                className={cn(
                                    'min-h-[52px] resize-none border-0 px-3 rounded-b-none appearance-none hover:border-transparent bg-transparent relative z-10',
                                    isDesktopExpanded
                                        ? 'h-full min-h-0 py-4'
                                        : isMobile
                                            ? 'py-2.5'
                                            : 'pt-4 pb-2',
                                    inputMode === 'shell' && 'font-mono',
                                    highlightedComposerContent && 'text-transparent caret-[var(--surface-foreground)]',
                                )}
                                style={{
                                    flex: isDesktopExpanded ? '1 1 auto' : 'none',
                                    height: !isDesktopExpanded && textareaSize ? `${textareaSize.height}px` : undefined,
                                    maxHeight: !isDesktopExpanded && textareaSize ? `${textareaSize.maxHeight}px` : undefined,
                                    borderTopLeftRadius: chatInputRadius,
                                    borderTopRightRadius: chatInputRadius,
                                }}
                                rows={1}
                            />
                        </div>
                    </div>
                    <div
                        className={cn(
                            'bg-transparent flex-shrink-0',
                            footerPaddingClass,
                            isMobile ? 'flex items-center gap-x-1.5' : cn('flex items-center justify-between', footerGapClass)
                        )}
                        style={{
                            borderBottomLeftRadius: chatInputRadius,
                            borderBottomRightRadius: chatInputRadius,
                        }}
                        data-chat-input-footer="true"
                    >
                        {isMobile ? (
                            <>
                                <div className="flex w-full items-center justify-between gap-x-1.5">
                                    <div className="flex items-center gap-x-1.5">
                                        <ComposerAttachmentControls
                                            isMobile={isMobile}
                                            isVSCode={isVSCode}
                                            footerIconButtonClass={footerIconButtonClass}
                                            iconSizeClass={iconSizeClass}
                                            fileInputRef={fileInputRef}
                                            handleLocalFileSelect={handleLocalFileSelect}
                                            handlePickLocalFiles={handlePickLocalFiles}
                                            handleOpenCommandMenu={handleOpenCommandMenu}
                                            openIssuePicker={openIssuePicker}
                                            openPrPicker={openPrPicker}
                                            onOpenSettings={onOpenSettings}
                                        />
                                        <PermissionAutoAcceptButton
                                            footerIconButtonClass={footerIconButtonClass}
                                            iconSizeClass={iconSizeClass}
                                            permissionScopeSessionId={permissionScopeSessionId}
                                            permissionAutoAcceptEnabled={permissionAutoAcceptEnabled}
                                            handlePermissionAutoAcceptToggle={handlePermissionAutoAcceptToggle}
                                        />
                                    </div>
                                    <div className="flex items-center min-w-0 gap-x-1 justify-end">
                                        <div className="flex items-center gap-x-1 min-w-0 max-w-[60vw] flex-shrink">
                                            <MemoMobileModelButton onOpenModel={() => handleOpenMobilePanel('model')} className="min-w-0 flex-shrink" />
                                            <MemoMobileAgentButton
                                                onOpenAgentPanel={handleOpenAgentPanel}
                                                onCycleAgent={handleCycleAgent}
                                                className="min-w-0 flex-shrink"
                                            />
                                        </div>
                                        <div className="flex items-center gap-x-1 flex-shrink-0">
                                            <MemoBrowserVoiceButton />
                                            <ComposerActionButtons
                                                isMobile={isMobile}
                                                footerIconButtonClass={footerIconButtonClass}
                                                runningActionOffsetClass={runningActionOffsetClass}
                                                sendIconSizeClass={sendIconSizeClass}
                                                stopIconSizeClass={stopIconSizeClass}
                                                canSend={canSend}
                                                canAbort={canAbort}
                                                abortFeedbackActive={abortFeedbackActive}
                                                hasContent={!!hasContent}
                                                currentSessionId={currentSessionId}
                                                newSessionDraftOpen={newSessionDraftOpen}
                                                onPrimaryAction={handlePrimaryAction}
                                                onQueueMessage={handleQueueMessage}
                                                onSendNow={handleSendNow}
                                                onInterruptAndSend={handleInterruptAndSend}
                                                onAbort={handleAbort}
                                                queueModeEnabled={queueModeEnabled}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <MemoModelControls
                                    className="hidden"
                                    mobilePanel={mobileControlsPanel}
                                    onMobilePanelChange={setMobileControlsPanel}
                                />
                            </>
                        ) : (
                            <>
                                <div className={cn("flex items-center flex-shrink-0", footerGapClass)}>
                                    <ComposerAttachmentControls
                                        isMobile={isMobile}
                                        isVSCode={isVSCode}
                                        footerIconButtonClass={footerIconButtonClass}
                                        iconSizeClass={iconSizeClass}
                                        fileInputRef={fileInputRef}
                                        handleLocalFileSelect={handleLocalFileSelect}
                                        handlePickLocalFiles={handlePickLocalFiles}
                                        handleOpenCommandMenu={handleOpenCommandMenu}
                                        openIssuePicker={openIssuePicker}
                                        openPrPicker={openPrPicker}
                                        onOpenSettings={onOpenSettings}
                                    />
                                    <FocusModeButton
                                        footerIconButtonClass={footerIconButtonClass}
                                        iconSizeClass={iconSizeClass}
                                        isExpandedInput={isExpandedInput}
                                        onToggle={handleToggleExpandedInput}
                                    />
                                    <PermissionAutoAcceptButton
                                        footerIconButtonClass={footerIconButtonClass}
                                        iconSizeClass={iconSizeClass}
                                        permissionScopeSessionId={permissionScopeSessionId}
                                        permissionAutoAcceptEnabled={permissionAutoAcceptEnabled}
                                        handlePermissionAutoAcceptToggle={handlePermissionAutoAcceptToggle}
                                        withTooltip
                                    />
                                </div>
                                <div className={cn('flex items-center flex-1 justify-end', footerGapClass, 'md:gap-x-3')}>
                                    <MemoModelControls className={cn('flex-1 min-w-0 justify-end')} />
                                    <MemoBrowserVoiceButton />
                                    <ComposerActionButtons
                                        isMobile={isMobile}
                                        footerIconButtonClass={footerIconButtonClass}
                                        runningActionOffsetClass={runningActionOffsetClass}
                                        sendIconSizeClass={sendIconSizeClass}
                                        stopIconSizeClass={stopIconSizeClass}
                                        canSend={canSend}
                                        canAbort={canAbort}
                                        abortFeedbackActive={abortFeedbackActive}
                                        hasContent={!!hasContent}
                                        currentSessionId={currentSessionId}
                                        newSessionDraftOpen={newSessionDraftOpen}
                                                onPrimaryAction={handlePrimaryAction}
                                                onQueueMessage={handleQueueMessage}
                                                onSendNow={handleSendNow}
                                                onInterruptAndSend={handleInterruptAndSend}
                                                onAbort={handleAbort}
                                                queueModeEnabled={queueModeEnabled}
                                            />
                                </div>
                            </>
                        )}
                    </div>

                    {/* Mobile Session Status Bar - above input */}
                    {isMobile && <MobileSessionStatusBar />}
                </div>
            </div>
        </form>

        {/* Issue Picker Dialog */}
        <GitHubIssuePickerDialog
            open={issuePickerOpen}
            onOpenChange={setIssuePickerOpen}
            mode="select"
            onSelect={(issue) => {
                setLinkedIssue(issue);
                setLinkedPr(null);
            }}
        />
        <GitHubPrPickerDialog
            open={prPickerOpen}
            onOpenChange={setPrPickerOpen}
            onSelect={(pr) => {
                setLinkedPr(pr);
                setLinkedIssue(null);
            }}
        />
        </>
    );
};

ChatInputComponent.displayName = 'ChatInput';

export const ChatInput = React.memo(ChatInputComponent);

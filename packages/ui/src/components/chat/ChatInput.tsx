import React from 'react';
import { BrowserVoiceButton, ComposerDictation } from '@/components/voice';
import { SessionSuggestionChip } from '@/components/chat/SessionSuggestionChip';
import { useBrowserVoice } from '@/hooks/useBrowserVoice';
// sessionStore removed — currentSessionId comes from useSessionUIStore
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { isServerOwnedMessageQueue, queuedContextToMessageParts, useMessageQueueStore, type QueuedContextPart, type QueuedMessage } from '@/stores/messageQueueStore';
import { buildChatInputHistorySubmissions, mergeSessionInputHistory } from './inputHistory';
import { createInputHistoryIdentity, selectInputHistoryEntries, useInputHistoryStore } from '@/stores/useInputHistoryStore';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useSessionUIStore, type SendMessageTarget } from '@/sync/session-ui-store';
import { useSelectionStore } from '@/sync/selection-store';
import { resolveAttachmentSessionKey, useInputStore } from '@/sync/input-store';
import {
    ACCEPTED_ATTACHMENT_EXTENSIONS,
    ATTACHMENT_ACCEPT,
    getUnsupportedAttachmentInputs,
    type AttachmentInputModality,
} from '@/sync/attachment-files';
import type { AttachedFile, SessionContextUsage } from '@/stores/types/sessionTypes';
import * as sessionActions from '@/sync/session-actions';
// Guest surfaces load on demand: VS Code and mobile never mount them, and the
// composer must not pay for the guest bridge before an extension is installed.
const GuestAttachDialog = React.lazy(() => import('@/components/layout/GuestAttachDialog').then((module) => ({ default: module.GuestAttachDialog })));
import { buildLinkedGuestIssue, buildLinkedIssue, buildLinkedLinearIssue } from '@/lib/linkedIssues';
import type { AttachIssueRequest, JsonValue } from '@openchamber/sdk';
import { useGuestAttachItems, useGuestCommands } from '@/hooks/useGuestSurfaces';
import { useGuestDialogStore } from '@/lib/guests/dialog-store';
import { useGuestItemStore } from '@/lib/guests/item-store';
import { runGuestCommand } from '@/lib/guests/run-command';
import { useGuestsStore } from '@/lib/guests/store';
import { isGuestActive } from '@/lib/guests/capabilities';
import { routeGuestSlashCommand } from './composer/submit/guestCommands';
import { pluginModeFromId } from '@/lib/surfaces/modes';
import type { SendDeliveryMode } from '@/sync/session-actions';
import { useDirectorySync, useSessionMessages, useSessionMessagesResolved, useSessionRevertMessageID, useUserMessageHistory } from '@/sync/sync-context';
import { parseSlashInvocation } from '@/sync/slash-routing';
import { useInlineCommentDraftStore, type InlineCommentDraft } from '@/stores/useInlineCommentDraftStore';
import { useSnippetsStore } from '@/stores/useSnippetsStore';
import { appendInlineComments } from '@/lib/messages/inlineComments';
import { renderMagicPrompt, type MagicPromptId } from '@/lib/magicPrompts';
import { startReviewFlow } from '@/lib/reviewFlow';
import { AutoReviewBanner } from '@/components/chat/AutoReviewBanner';
import { useAutoReviewStore } from '@/stores/useAutoReviewStore';
import type { I18nKey } from '@/lib/i18n';
import { AttachedFilesList, AttachedVSCodeFileChips, ActiveEditorFileSuggestion } from './FileAttachment';
import { LinkedReferenceRow } from './composer/ui/LinkedReferenceRow';
import { GuestIcon } from '@/components/layout/GuestRailIcon';
import type { IconName } from '@/components/icon/icons';
import { QueuedMessageChips } from './QueuedMessageChips';
import { FileMentionAutocomplete, type FileMentionHandle } from './FileMentionAutocomplete';
import { CommandAutocomplete, type CommandAutocompleteHandle, type CommandInfo } from './CommandAutocomplete';
import { SkillAutocomplete, type SkillAutocompleteHandle } from './SkillAutocomplete';
import { SnippetAutocomplete, type SnippetAutocompleteHandle } from './SnippetAutocomplete';
import { cn, formatDirectoryName, isMacOS } from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/clipboard';
import { ModelControls } from './ModelControls';
import { SessionGoalRow } from '@/components/chat/SessionGoalRow';
import { SessionGoalButton, SessionGoalObjectiveCounter } from '@/components/chat/SessionGoalButton';
import { parseAgentMentions } from '@/lib/messages/agentMentions';
import { StatusRow } from './StatusRow';
import { PendingChangesBar } from './PendingChangesBar';
import { useChatSurfaceMode } from './useChatSurfaceMode';
import { MobileAgentButton } from './MobileAgentButton';
import { MobileModelButton } from './MobileModelButton';
import { MobileSessionStatusBar } from './MobileSessionStatusBar';
import {
  canNavigateComposerHistoryDown,
  canNavigateComposerHistoryUp,
  resolveComposerHistoryArrowDown,
  resolveComposerHistoryArrowUp,
} from './composerHistoryNavigation';
import { useCurrentSessionActivity, useSessionActivity } from '@/hooks/useSessionActivity';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { setKeyboardInsetCssVar } from '@/hooks/nativeMobileChrome';
import { isNativeShellApp } from '@/lib/platform';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
// useMessageStore removed — messages now come from sync system
import { isVSCodeRuntime } from '@/lib/desktop';
import { probeSessionGoalSupport, probeSessionGoalSupportForSession } from '@/lib/sessionGoalLocal';
import { isIMECompositionEvent } from '@/lib/ime';
import { ContextUsageDisplay } from '@/components/ui/ContextUsageDisplay';
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
import { LinearIssuePickerDialog } from '@/components/session/LinearIssuePickerDialog';
import { useLinearAuthStore } from '@/stores/useLinearAuthStore';
import { GitHubPrPickerDialog } from '@/components/session/GitHubPrPickerDialog';
import { Icon } from "@/components/icon/Icon";
import { useChatSearchDirectory } from '@/hooks/useChatSearchDirectory';
import { useContextPanelKey } from '@/hooks/useContextPanelKey';
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
import { getSyncMessages, getSyncParts } from '@/sync/sync-refs';
import { isSyntheticPart } from '@/lib/messages/synthetic';
import { isRuntimeAuthBlocked } from '@/lib/runtime-auth-expiry';
import { CHAT_DRAFT_PROJECT_ID } from '@/lib/chatDirectories';
import { BtwPanel } from './btw/BtwPanel';
import { useBtwPanelState } from './btw/useBtwPanelState';
import {
    destroyBtwSession,
    getBtwSyntheticParts,
    startBtwSession,
    type BtwSessionRef,
} from '@/lib/btw';
import { isRealUserMessage } from '@/lib/messages/real-user';
import { messagesFrom } from '@/sync/message-ordering';
import { serverRegistry } from '@/lib/opencode/server-registry';
import {
    assignImageAttachmentFilenames,
    buildAttachmentCitationText,
} from './attachmentCitations';
import { buildSlashSkillDispatch } from './skillSlashDispatch';
import { buildDraftStarterSubmitText } from './draftStarterSubmit';
import {
    type FileMentionAutocompleteInputSource,
} from './fileMentionAutocompleteState';
import { resolveAutocompleteTrigger } from './composer/language/triggers';
import type { ComposerLanguageContext } from './composer/language/tokenize';
import {
    ComposerEditor,
    type ComposerChange,
    type ComposerEditorHandle,
} from './composer/editor/ComposerEditor';
import { createComposerEditorViewStore } from './composer/editor/viewStore';
import { useAutocompletePosition } from './composer/state/useAutocompletePosition';
import {
    appendInlineText,
    appendWithLineBreaks,
    buildImagePasteInsertion,
    shouldWrapSelectionAsLink,
    withInlineInsertionBoundaries,
} from './composer/text';
import {
    collectDroppedFileUris,
    collectDroppedFiles,
    hasDraggedFiles,
} from './composer/attachments/dataTransfer';
import {
    normalizeDroppedPath,
    normalizePath,
    toProjectRelativeMentionPath,
    toServerFileUrl,
} from './composer/attachments/filePaths';
import type { Message, Part } from '@opencode-ai/sdk/v2/client';
import type { ContextPanelMode } from '@/stores/useUIStore';
import {
    resolveFollowUpAction,
    type FollowUpBehavior,
} from '@/lib/followUpBehavior';

const MAX_VISIBLE_COMPOSER_LINES = 8;
const MAX_MOBILE_COMPOSER_LINES = 16;
const EMPTY_QUEUE: QueuedMessage[] = [];
const FILE_MENTION_TOKEN = /^@[^\s]+$/;
const INLINE_SKILL_TOKEN_PATTERN = /(^|\s)\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)/g;
const CHAT_DRAFT_PERSIST_DEBOUNCE_MS = 500;
const COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH = 560;

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

const getFileMentionInputSourceForInsertedText = (insertedText: string): FileMentionAutocompleteInputSource => (
    insertedText.includes('@') ? 'paste' : 'manual'
);

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
    return getSyncMessages(sessionId, directory).some((message) => (
        isRealUserMessage(message, getSyncParts(message.id, directory))
    ));
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
const browserVoiceButtonPropsEqual = (prev: { voice: import('@/hooks/useBrowserVoice').UseBrowserVoiceReturn }, next: { voice: import('@/hooks/useBrowserVoice').UseBrowserVoiceReturn }): boolean => {
    const a = prev.voice;
    const b = next.voice;
    return a.status === b.status
        && a.error === b.error
        && a.conversationMode === b.conversationMode
        && a.isSupported === b.isSupported
        && a.isMobile === b.isMobile
        && a.language === b.language
        && a.startVoice === b.startVoice
        && a.stopVoice === b.stopVoice
        && a.finishVoiceInput === b.finishVoiceInput
        && a.toggleConversationMode === b.toggleConversationMode;
};
const MemoBrowserVoiceButton = React.memo(BrowserVoiceButton, browserVoiceButtonPropsEqual);
const MemoMobileAgentButton = React.memo(MobileAgentButton);
const MemoMobileModelButton = React.memo(MobileModelButton);
const MemoStatusRow = React.memo(StatusRow);

const isSameContextUsage = (
    a: SessionContextUsage | null,
    b: SessionContextUsage | null,
): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;

    return a.totalTokens === b.totalTokens
        && a.percentage === b.percentage
        && a.contextLimit === b.contextLimit
        && (a.outputLimit ?? 0) === (b.outputLimit ?? 0)
        && (a.normalizedOutput ?? 0) === (b.normalizedOutput ?? 0)
        && a.thresholdLimit === b.thresholdLimit
        && (a.lastMessageId ?? '') === (b.lastMessageId ?? '');
};

const getActiveContextMode = (panelState: {
    isOpen: boolean;
    activeTabId: string | null;
    tabs: Array<{ id: string; mode: ContextPanelMode }>;
} | undefined): ContextPanelMode | null => {
    if (!panelState?.isOpen || !Array.isArray(panelState.tabs) || panelState.tabs.length === 0) {
        return null;
    }

    const activeTab = panelState.tabs.find((tab) => tab.id === panelState.activeTabId) ?? panelState.tabs[panelState.tabs.length - 1];
    return activeTab?.mode ?? null;
};

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
        () => sessionMessages.filter((message): message is Message & { role: 'user' } => (
            isRealUserMessage(message, partsByMessage[message.id])
        )),
        [partsByMessage, sessionMessages],
    );
    const noTextContent = t('chat.revertPopover.noTextContent');
    const items = React.useMemo(() => {
        if (!revertMessageID) return [];
        return messagesFrom(userMessages, revertMessageID)
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
            const messageIndex = userMessages.findIndex((message) => message.id === messageId);
            const nextMessage = messageIndex >= 0 ? userMessages[messageIndex + 1] : undefined;
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
    /** Present only when the connected runtime exposes the Linear integration. */
    openLinearPicker?: () => void;
    /** Installed extensions that contribute an attach flow (upstream 5181bcd33). */
    attachGuests?: readonly { id: string; name: string; icon: IconName; iconSrc?: string; mode: 'dialog' | 'panel' }[];
    onOpenGuestAttach?: (guestId: string) => void;
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
        openLinearPicker,
        attachGuests,
        onOpenGuestAttach,
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
                    onMouseDown={(event) => {
                        event.preventDefault();
                    }}
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
                accept={ATTACHMENT_ACCEPT}
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
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                }}
                                onPointerDownCapture={(event) => {
                                    if (event.pointerType === 'touch') {
                                        event.preventDefault();
                                    }
                                }}
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
                            {openLinearPicker ? (
                                <DropdownMenuItem
                                    onSelect={() => {
                                        requestAnimationFrame(openLinearPicker);
                                    }}
                                >
                                    <Icon name="linear"/>
                                    {t('chat.chatInput.actions.linkLinearIssue')}
                                </DropdownMenuItem>
                            ) : null}
                            {(attachGuests ?? []).map((guest) => (
                                <DropdownMenuItem
                                    key={guest.id}
                                    onSelect={() => {
                                        requestAnimationFrame(() => onOpenGuestAttach?.(guest.id));
                                    }}
                                >
                                    <GuestIcon icon={guest.icon} iconSrc={guest.iconSrc} className="size-4" />
                                    {guest.name}
                                </DropdownMenuItem>
                            ))}
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
    && prev.openLinearPicker === next.openLinearPicker
));

type PermissionAutoAcceptButtonProps = {
    footerIconButtonClass: string;
    iconSizeClass: string;
    isInteractive: boolean;
    permissionAutoAcceptEnabled: boolean;
    handlePermissionAutoAcceptToggle: () => void;
    withTooltip?: boolean;
};

const PermissionAutoAcceptButton = React.memo(function PermissionAutoAcceptButton(props: PermissionAutoAcceptButtonProps) {
    const { t } = useI18n();
    const {
        footerIconButtonClass,
        iconSizeClass,
        isInteractive,
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
                !isInteractive && 'opacity-30',
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
    onAbort: () => void;
    followUpBehavior: FollowUpBehavior;
};

const ComposerActionButtons = React.memo(function ComposerActionButtons(props: ComposerActionButtonsProps) {
    const {
        isMobile,
        footerIconButtonClass,
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
        onAbort,
        followUpBehavior,
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

    const defaultAction = followUpBehavior === 'queue'
        ? t('chat.chatInput.actions.queueButton.queue')
        : t('chat.chatInput.actions.queueButton.send');

    const alternateAction = followUpBehavior === 'queue'
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
                    'absolute z-20 bottom-full left-1/2 mb-1 flex -translate-x-1/2 items-center',
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
                                        if (followUpBehavior === 'queue') {
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
    && prev.sendIconSizeClass === next.sendIconSizeClass
    && prev.stopIconSizeClass === next.stopIconSizeClass
    && prev.canSend === next.canSend
    && prev.canAbort === next.canAbort
    && prev.abortFeedbackActive === next.abortFeedbackActive
    && prev.hasContent === next.hasContent
    && prev.currentSessionId === next.currentSessionId
    && prev.newSessionDraftOpen === next.newSessionDraftOpen
    && prev.followUpBehavior === next.followUpBehavior
    && prev.onPrimaryAction === next.onPrimaryAction
    && prev.onQueueMessage === next.onQueueMessage
    && prev.onSendNow === next.onSendNow
    && prev.onAbort === next.onAbort
));

interface ChatInputProps {
    onOpenSettings?: () => void;
    scrollToBottom?: () => void;
}

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
    const [mobileControlsPanel, setMobileControlsPanel] = React.useState<MobileControlsPanel>(null);
    const [unsyncedSkillError, setUnsyncedSkillError] = React.useState<string | null>(null);
    const [composerError, setComposerError] = React.useState<{ message: string; name: string } | null>(null);
    // Message history navigation state (up/down arrow to recall previous messages)
    const [historyIndex, setHistoryIndex] = React.useState(-1); // -1 = not browsing, 0+ = index from most recent
    const [draftMessage, setDraftMessage] = React.useState(''); // Preserves input when entering history mode
    const composerRef = React.useRef<ComposerEditorHandle>(null);
    const composerViewStore = React.useRef(createComposerEditorViewStore()).current;
    React.useEffect(() => () => {
        composerViewStore.view?.destroy();
        composerViewStore.view = null;
    }, [composerViewStore]);
    const cursorPosRef = React.useRef(0);
    const dropZoneRef = React.useRef<HTMLDivElement>(null);
    const dragEnterCountRef = React.useRef(0);
    const suppressNextFileDropTextInsertRef = React.useRef(false);
    const suppressNextFileDropTextInsertTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingDroppedAbsolutePathsRef = React.useRef<string[]>([]);
    const suppressNextFileMentionPasteRef = React.useRef(false);
    const suppressNextFileMentionPasteTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const shellTriggerNormalizationRef = React.useRef(false);
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
        Promise.resolve((useSessionUIStore.getState().sendMessage as (...a: unknown[]) => unknown)(...args))
            .then((result) => {
                setUnsyncedSkillError(null);
                setComposerError(null);
                return result;
            })
            .catch((error: unknown) => {
                const name = error instanceof Error ? error.name : typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "Error";
                const message = error instanceof Error ? error.message : String(error);
                setComposerError({ name, message });
                throw error;
            }),
    ).current;
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const currentDirectory = useDirectoryStore((s) => s.currentDirectory);
    const currentSessionDirectoryForSync = useSessionUIStore(
        React.useCallback((s) => currentSessionId ? s.getDirectoryForSession(currentSessionId) : null, [currentSessionId]),
    );
    const composerDirectoryContext = currentSessionDirectoryForSync ?? currentDirectory;
    const btwPanel = useBtwPanelState(currentSessionId, composerDirectoryContext ?? undefined);
    const btwSessionRef = React.useMemo<BtwSessionRef | null>(() => (
        currentSessionId && btwPanel.btwSessionId && btwPanel.btwDirectory
            ? {
                parentSessionId: currentSessionId,
                btwSessionId: btwPanel.btwSessionId,
                directory: btwPanel.btwDirectory,
            }
            : null
    ), [btwPanel.btwDirectory, btwPanel.btwSessionId, currentSessionId]);
    const isBtwActive = btwSessionRef !== null && !btwPanel.collapsed;
    // The btw panel owns the floating slot whenever a sheet (expanded or
    // collapsed) or a creation frame is on screen, hiding queue and suggestion.
    const isBtwPanelVisible = btwSessionRef !== null || btwPanel.creating;
    React.useEffect(() => {
        setUnsyncedSkillError(null);
    }, [composerDirectoryContext, currentSessionId]);
    React.useEffect(() => {
        if (!showSkillAutocomplete) {
            setUnsyncedSkillError(null);
        }
    }, [showSkillAutocomplete]);
    const newSessionDraft = useSessionUIStore((s) => s.newSessionDraft);
    const newSessionDraftOpen = Boolean(newSessionDraft?.open);
    const draftPermissionAutoAcceptEnabled = useSessionUIStore(
        (s) => s.newSessionDraft.open && s.newSessionDraft.permissionIntent.autoAccept,
    );
    const setDraftPermissionAutoAccept = useSessionUIStore((s) => s.setDraftPermissionAutoAccept);
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
    const pendingGuestIssue = useInputStore((s) => s.pendingGuestIssue);
    const consumePendingGuestIssue = useInputStore((s) => s.consumePendingGuestIssue);
    const consumePendingSyntheticParts = useInputStore((s) => s.consumePendingSyntheticParts);
    const getContextUsage = useSessionUIStore((s) => s.getContextUsage);
    const openContextOverview = useUIStore((state) => state.openContextOverview);
    const closeContextPanel = useUIStore((state) => state.closeContextPanel);
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
    const getCurrentModel = useConfigStore((state) => state.getCurrentModel);
    const agents = getVisibleAgents();
    const isMobile = useUIStore((state) => state.isMobile);
    const inputBarOffset = useUIStore((state) => state.inputBarOffset);
    // PWA/web only: Capacitor inset ownership lives in useNativeMobileChrome
    // (Keyboard plugin + single visualViewport fallback). Do not dual-write here.
    const { keyboardHeight } = useVisualViewport();
    React.useEffect(() => {
        if (!isMobile || typeof document === 'undefined' || isNativeShellApp()) {
            return;
        }
        const root = document.documentElement;
        setKeyboardInsetCssVar(root, keyboardHeight);
        return () => {
            setKeyboardInsetCssVar(root, 0);
        };
    }, [isMobile, keyboardHeight]);
    const voice = useBrowserVoice();
    const voiceModeEnabled = useConfigStore((state) => state.voiceModeEnabled);
    const [showDictation, setShowDictation] = React.useState(false);
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
    const currentModel = getCurrentModel();
    const [abortFeedbackActive, setAbortFeedbackActive] = React.useState(false);
    const setSessionAutoAccept = usePermissionStore((state) => state.setSessionAutoAccept);
    const [isNarrowComposer, setIsNarrowComposer] = React.useState(false);
    const currentSessionMessagesResolved = useSessionMessagesResolved(currentSessionId ?? '');
    const [stableComposerContextUsage, setStableComposerContextUsage] = React.useState<SessionContextUsage | null>(null);
    const composerContextPanelKey = useContextPanelKey();
    const currentComposerContextPanelState = useUIStore(
        React.useCallback(
            (state) => (composerContextPanelKey ? state.contextPanelByDirectory[composerContextPanelKey] : undefined),
            [composerContextPanelKey],
        ),
    );

    const isDesktopExpanded = isExpandedInput && !isMobile;
    const chatInputRadius = 'var(--radius-xl)';
    const useCompactChatPlaceholder = isMobile || isNarrowComposer;

    const contextLimit = currentModel && typeof currentModel.limit === 'object' && currentModel.limit !== null
        ? (currentModel.limit as Record<string, unknown>)
        : null;
    const composerContextLimit = (contextLimit && typeof contextLimit.context === 'number' ? contextLimit.context : 0);
    const composerOutputLimit = (contextLimit && typeof contextLimit.output === 'number' ? contextLimit.output : 0);
    const composerContextUsage = getContextUsage(composerContextLimit, composerOutputLimit);
    const isComposerContextUsageResolvedForSession = !currentSessionId || currentSessionMessagesResolved;

    React.useEffect(() => {
        if (!currentSessionId) {
            setStableComposerContextUsage((prev) => (prev === null ? prev : null));
            return;
        }

        if (composerContextUsage && composerContextUsage.totalTokens > 0) {
            setStableComposerContextUsage((prev) => (isSameContextUsage(prev, composerContextUsage) ? prev : composerContextUsage));
            return;
        }

        if (isComposerContextUsageResolvedForSession) {
            setStableComposerContextUsage((prev) => (prev === null ? prev : null));
        }
    }, [composerContextUsage, currentSessionId, isComposerContextUsageResolvedForSession]);

    const isComposerContextPanelActive = React.useMemo(() => {
        return getActiveContextMode(currentComposerContextPanelState) === 'context';
    }, [currentComposerContextPanelState]);

    const handleOpenComposerContextPanel = React.useCallback(() => {
        if (!composerContextPanelKey) {
            return;
        }

        if (getActiveContextMode(currentComposerContextPanelState) === 'context') {
            closeContextPanel(composerContextPanelKey);
            return;
        }

        openContextOverview(composerContextPanelKey);
    }, [closeContextPanel, composerContextPanelKey, currentComposerContextPanelState, openContextOverview]);

    const shouldShowComposerContextUsage = !isMobile && !isVSCodeRuntime() && !!stableComposerContextUsage && stableComposerContextUsage.totalTokens > 0;
    const composerContextUsagePercentage = stableComposerContextUsage && stableComposerContextUsage.contextLimit > 0
        ? Math.min(999, (stableComposerContextUsage.totalTokens / stableComposerContextUsage.contextLimit) * 100)
        : 0;

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
    // Subscribe to both sources read by getModelMetadata so async metadata updates are observed.
    useConfigStore((s) => s.modelsMetadata);
    useConfigStore((s) => s.providers);
    const currentModelMetadata = currentProviderId && currentModelId
        ? getModelMetadata(currentProviderId, currentModelId)
        : undefined;
    const currentModelSupportsImages = currentModelMetadata?.modalities?.input?.includes('image')
        ?? currentModelMetadata?.attachment
        ?? true;
    const hasImageAttachments = attachedFiles.some((f) => f.mimeType.startsWith('image/'));
    const showImageFallbackNotice = hasImageAttachments && !currentModelSupportsImages;

    const attachmentCompatibilityRef = React.useRef({
        modelKey: `${currentProviderId ?? ''}/${currentModelId ?? ''}`,
        modalitySignature: currentModelMetadata?.modalities?.input?.slice().sort().join(',') ?? null,
        attachmentIds: new Set<string>(),
    });

    React.useEffect(() => {
        const modelKey = `${currentProviderId ?? ''}/${currentModelId ?? ''}`;
        const inputModalities = currentModelMetadata?.modalities?.input;
        const modalitySignature = inputModalities?.slice().sort().join(',') ?? null;
        const previous = attachmentCompatibilityRef.current;
        const modelChanged = previous.modelKey !== modelKey;
        const metadataBecameAvailable = previous.modalitySignature === null && modalitySignature !== null;
        const filesToCheck = modelChanged || metadataBecameAvailable
            ? attachedFiles
            : attachedFiles.filter((file) => !previous.attachmentIds.has(file.id));

        attachmentCompatibilityRef.current = {
            modelKey,
            modalitySignature,
            attachmentIds: new Set(attachedFiles.map((file) => file.id)),
        };

        if (!inputModalities || filesToCheck.length === 0) return;

        const incompatibleFiles = getUnsupportedAttachmentInputs(filesToCheck, inputModalities);
        if (incompatibleFiles.length === 0) return;

        const unsupportedModalities = Array.from(new Set(incompatibleFiles.map(({ modality }) => modality)));
        const modalityLabels: Record<AttachmentInputModality, string> = {
            text: t('chat.modelControls.modality.text'),
            image: t('chat.modelControls.modality.image'),
            pdf: t('chat.modelControls.modality.pdf'),
            audio: t('chat.modelControls.modality.audio'),
            video: t('chat.modelControls.modality.video'),
        };
        const filenames = incompatibleFiles.map(({ attachment }) => attachment.filename);
        const fileSummary = filenames.length > 3
            ? `${filenames.slice(0, 3).join(', ')} (+${filenames.length - 3})`
            : filenames.join(', ');

        toast.warning(t('chat.chatInput.toast.unsupportedAttachmentModalities', {
            model: currentModelMetadata?.name ?? currentModelId ?? '',
            modalities: unsupportedModalities.map((modality) => modalityLabels[modality]).join(', '),
            files: fileSummary,
        }), { id: `attachment-modalities:${modelKey}` });
    }, [attachedFiles, currentModelId, currentModelMetadata, currentProviderId, t]);

    const [pluginLoaded, setPluginLoaded] = React.useState<boolean | null>(null);
    React.useEffect(() => {
      fetch('/api/openchamber/plugin-status').then(r => r.json()).then((data: { loaded?: boolean; reason?: string }) => {
        setPluginLoaded(data.reason === 'not-checked' ? null : data.loaded === true);
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
            'btw',
            'summary',
            'workspace-review',
            ...Object.keys(GUIDED_SESSION_COMMANDS),
        ]);
        if (!isMobile && !isVSCodeRuntime()) names.add('handoff-review');
        if (!isVSCodeRuntime()) names.add('craft-goal');
        if (!isVSCodeRuntime()) names.add('schedule-task');
        for (const command of availableCommands) names.add(command.name.toLowerCase());
        for (const skill of availableSkills) names.add(skill.name.toLowerCase());
        return names;
    }, [availableCommands, availableSkills, isMobile]);

    // Extension slash commands. Built-ins, OpenCode commands, and skills are
    // reserved: an extension command with one of those names is ignored.
    const guestCommands = useGuestCommands(knownSlashNames);
    const knownSlashNamesWithGuests = React.useMemo(() => {
        if (guestCommands.length === 0) return knownSlashNames;
        const names = new Set(knownSlashNames);
        for (const entry of guestCommands) names.add(entry.command.name);
        return names;
    }, [guestCommands, knownSlashNames]);

    const availableSnippets = useSnippetsStore((s) => s.snippets);
    const knownSnippetTriggers = React.useMemo(() => {
        const triggers = new Set<string>();
        for (const snippet of availableSnippets) {
            triggers.add(snippet.name.toLowerCase());
            for (const alias of snippet.aliases ?? []) triggers.add(alias.toLowerCase());
        }
        return triggers;
    }, [availableSnippets]);

    const attachmentFilenames = React.useMemo(
        () => sendableAttachedFiles.map((file) => file.filename),
        [sendableAttachedFiles],
    );
    const languageContext = React.useMemo<ComposerLanguageContext>(() => ({
        inputMode,
        knownAgentNames,
        confirmedMentions: confirmedMentionsRef.current,
        knownSlashNames: knownSlashNamesWithGuests,
        knownSnippetTriggers,
        attachmentFilenames,
    }), [attachmentFilenames, inputMode, knownAgentNames, knownSlashNamesWithGuests, knownSnippetTriggers]);

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
    const abortFeedbackTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Issue linking state
    const [issuePickerOpen, setIssuePickerOpen] = React.useState(false);
    const [prPickerOpen, setPrPickerOpen] = React.useState(false);
    const [linearPickerOpen, setLinearPickerOpen] = React.useState(false);
    const [linkedLinearIssue, setLinkedLinearIssue] = React.useState<{
        identifier: string;
        title: string;
        url: string;
        contextText: string;
        author?: { login: string; avatarUrl?: string };
    } | null>(null);
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
    // The chip the attach dialog was opened from; null when opened from the + menu.
    const [attachDialogItem, setAttachDialogItem] = React.useState<AttachIssueRequest | null>(null);
    const [attachDialogGuestId, setAttachDialogGuestId] = React.useState<string | null>(null);
    const [linkedGuestIssue, setLinkedGuestIssue] = React.useState<{
        providerId: string;
        id: string;
        title: string;
        url: string;
        contextText: string;
        thread?: 'issue' | 'pull';
        author?: string;
        head?: string;
        base?: string;
        /** Opaque guest payload from `attach`; handed back on chip click, never shown. */
        data?: JsonValue;
    } | null>(null);

    // Message queue
    const followUpBehavior = useMessageQueueStore((state) => state.followUpBehavior);
    const queuedMessages = useMessageQueueStore(
        React.useCallback(
            (state) => {
                if (!currentSessionId) return EMPTY_QUEUE;
                // Skip items already being delivered (the server's in-flight
                // projection): a composer submit must not merge them in again.
                const queue = state.queuedMessages[currentSessionId] ?? EMPTY_QUEUE;
                const sending = state.sendingIds[currentSessionId];
                if (!sending || sending.length === 0) return queue;
                return queue.filter((message) => !sending.includes(message.id));
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
                let browserElement = 0;
                let review = 0;
                for (const draft of drafts) {
                    if (draft.source === 'preview-console') previewConsole += 1;
                    else if (draft.source === 'preview-annotation') previewAnnotation += 1;
                    else if (draft.source === 'browser-element') browserElement += 1;
                    else review += 1;
                }
                return `${previewConsole}:${previewAnnotation}:${review}:${browserElement}`;
            },
            [currentSessionId, newSessionDraftOpen]
        )
    );
    const consumeDrafts = useInlineCommentDraftStore((state) => state.consumeDrafts);
    const removeInlineCommentDraft = useInlineCommentDraftStore((state) => state.removeDraft);
    const hasDrafts = draftCount > 0;
    const [previewConsoleCount, previewAnnotationCount, reviewCount] = draftSourceKey.split(':').map((entry) => Number(entry) || 0);
    const browserElementNames = useInlineCommentDraftStore(
        React.useCallback(
            (state) => {
                const sessionKey = currentSessionId ?? (newSessionDraftOpen ? 'draft' : '');
                const drafts = sessionKey ? (state.drafts[sessionKey] ?? []) : [];
                return drafts
                    .filter((draft) => draft.source === 'browser-element')
                    .map((draft) => draft.fileLabel)
                    .slice(0, 3)
                    .join(', ');
            },
            [currentSessionId, newSessionDraftOpen]
        )
    );
    const removePreviewDrafts = React.useCallback((source: 'preview-console' | 'preview-annotation' | 'browser-element') => {
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
    // The persisted input-history store makes prompts survive a reload: the
    // transcript covers what the server still lists, the persisted bucket adds
    // what it no longer does (and will carry restorable attachments later).
    const transcriptMessageHistory = useUserMessageHistory(currentSessionId ?? "");
    const recallHistoryIdentity = React.useMemo(
        () => createInputHistoryIdentity(getRuntimeKey(), composerDirectoryContext ?? '', currentSessionId ?? ''),
        [composerDirectoryContext, currentSessionId]
    );
    const persistedHistoryEntries = useInputHistoryStore(
        React.useCallback(
            (state) => selectInputHistoryEntries(state, recallHistoryIdentity),
            [recallHistoryIdentity]
        )
    );
    const userMessageHistory = React.useMemo(
        () => mergeSessionInputHistory(
            transcriptMessageHistory.map((text, index) => ({ text, createdAt: transcriptMessageHistory.length - index })),
            persistedHistoryEntries,
        ).map((value) => value.text).reverse(),
        [transcriptMessageHistory, persistedHistoryEntries]
    );

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
                composerRef.current?.selectAll();
            });
        }
    }, [persistChatDraft]);

    // Keep composer attachments scoped to the active session/draft.
    // Text drafts already swap on session change; attachments used to be global
    // and would "follow" into the next conversation (including after queue send).
    const attachmentSessionKey = resolveAttachmentSessionKey({
        currentSessionId,
        newSessionDraftOpen,
    });
    React.useEffect(() => {
        useInputStore.getState().setAttachmentSessionKey(attachmentSessionKey);
    }, [attachmentSessionKey]);

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
                        composerRef.current?.selectAll();
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
                    composerRef.current?.focus({ preventScroll: true });
                } else {
                    composerRef.current?.focus();
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

    // Expanded btw mode routes the composer and stop button to the fork. A
    // collapsed panel keeps the fork alive but restores the main composer.
    const { phase: parentSessionPhase } = useCurrentSessionActivity();
    const { phase: btwSessionPhase } = useSessionActivity(btwPanel.btwSessionId, btwPanel.btwDirectory ?? undefined);
    const sessionPhase = isBtwActive ? btwSessionPhase : parentSessionPhase;
    const autoReviewRunning = useAutoReviewStore(React.useCallback((state) => {
        if (!currentSessionId) return false;
        return state.isRunningForSession(currentSessionId);
    }, [currentSessionId]));

    const handleOpenMobilePanel = React.useCallback((panel: MobileControlsPanel) => {
        if (!isMobile) {
            return;
        }
        composerRef.current?.blur();
        requestAnimationFrame(() => {
            setMobileControlsPanel(panel);
        });
    }, [isMobile]);

    const handleOpenDictation = React.useCallback(() => {
        if (!voiceModeEnabled || !voice.isSupported) {
            return;
        }
        composerRef.current?.blur();
        voice.startVoice();
        setShowDictation(true);
    }, [voice, voiceModeEnabled]);

    const handleCloseDictation = React.useCallback(() => {
        setShowDictation(false);
    }, []);

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
                    composerRef.current?.focus();
                }, 0);
            }
        }
    }, [pendingInputText, consumePendingInputText]);

    React.useEffect(() => {
        if (pendingPresetSubmit === null) {
            return;
        }

        const preset = consumePendingPresetSubmit();
        if (!preset?.text.trim()) {
            return;
        }

        const draft = composerRef.current?.getValue() ?? messageRef.current;
        void handleSubmitRef.current({
            presetText: buildDraftStarterSubmitText(preset.text, preset.type, draft),
        });
    }, [pendingPresetSubmit, consumePendingPresetSubmit]);

    const hasContent = message.trim().length > 0 || sendableAttachedFiles.length > 0 || hasDrafts;

    const applyAssistSuggestion = React.useCallback((text: string) => {
        setMessage(text);
        requestAnimationFrame(() => composerRef.current?.focus());
    }, []);
    const hasQueuedMessages = queuedMessages.length > 0;
    const canSend = hasContent || hasQueuedMessages;

    const canAbort = sessionPhase !== 'idle';

    const getCurrentInputSnapshot = React.useCallback(() => {
        const currentMessage = composerRef.current?.getValue() ?? message;
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
        presetText?: string;
    };
    const handleSubmitRef = React.useRef<(options?: SubmitOptions) => Promise<void>>(async () => {});

    // Add message to queue instead of sending
    const handleQueueMessage = React.useCallback(async () => {
        const inputSnapshot = getCurrentInputSnapshot();
        if (!inputSnapshot.hasContent || !currentSessionId) return;

        const slashSkillText = parseAgentMentions(inputSnapshot.message, agents).sanitizedText;
        const slashSkillDispatch = inputMode === 'normal'
            ? buildSlashSkillDispatch(slashSkillText, { commands: availableCommands, skills: availableSkills })
            : null;
        if (slashSkillDispatch?.kind === 'unsynced') {
            setUnsyncedSkillError(t('chat.chatInput.error.skillNotLoaded', { name: slashSkillDispatch.skillName }));
            return;
        }

        const drafts = consumeDrafts(currentSessionId);

        const originalMessage = inputSnapshot.message.replace(/^\n+|\n+$/g, '');
        let messageToQueue = originalMessage;
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

        // Context handed to the composer by another surface rides the queued
        // message instead of leaking into the next composer send.
        const pendingSyntheticParts = consumePendingSyntheticParts();
        const queuedContext: QueuedContextPart[] = (pendingSyntheticParts ?? [])
            .filter((part) => part.text.trim().length > 0)
            .map((part) => ({ kind: 'synthetic' as const, text: part.text }));

        try {
            await addToQueue(currentSessionId, {
                content: messageToQueue,
                attachments: attachmentsToQueue.length > 0 ? attachmentsToQueue : undefined,
                context: queuedContext.length > 0 ? queuedContext : undefined,
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
        } catch (error) {
            if (pendingSyntheticParts && pendingSyntheticParts.length > 0) {
                const inputState = useInputStore.getState();
                inputState.setPendingSyntheticParts([...(inputState.pendingSyntheticParts ?? []), ...pendingSyntheticParts]);
            }
            toast.error(error instanceof Error ? error.message : 'Failed to queue message');
            return;
        }

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
            composerRef.current?.focus();
        }
    }, [getCurrentInputSnapshot, currentSessionId, inputMode, availableCommands, availableSkills, agents, t, currentSessionDirectoryForSync, currentDirectory, projects, availableWorktreesByProject, sendableAttachedFiles, sanitizeAttachmentsForSend, addToQueue, clearAttachedFiles, isMobile, consumeDrafts, consumePendingSyntheticParts, currentProviderId, currentModelId, currentAgentName, currentVariant]);

    const handleQueuedMessageEdit = React.useCallback((content: string) => {
        setMessage(content);
        setTimeout(() => {
            composerRef.current?.focus();
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

    const linearConnected = useLinearAuthStore((state) => state.status?.connected === true);
    const linearAvailable = linearConnected;

    const openLinearPicker = React.useCallback(() => {
        setLinearPickerOpen(true);
    }, []);

    const openPrPicker = React.useCallback(() => {
        setPrPickerOpen(true);
    }, []);

    // --- Guest attach (upstream 5181bcd33) ---
    const guestAttachItems = useGuestAttachItems();
    const openGuestAttach = React.useCallback((guestId: string) => {
        const item = guestAttachItems.find((guest) => guest.id === guestId);
        if (item?.mode === 'dialog') {
            setAttachDialogItem(null);
            setAttachDialogGuestId(guestId);
            return;
        }
        useUIStore.getState().openContextSurface(currentDirectory || '', pluginModeFromId(guestId));
    }, [currentDirectory, guestAttachItems]);
    // Clicking the guest chip reopens that guest with the chip as `ready.item`,
    // so it can show the item's details instead of its whole list. A panel
    // guest gets it through the rail hand-off store; a dialog guest as a prop.
    const reopenGuestItem = React.useCallback(() => {
        if (!linkedGuestIssue) return;
        const issue: AttachIssueRequest = {
            providerId: linkedGuestIssue.providerId,
            id: linkedGuestIssue.id,
            title: linkedGuestIssue.title,
            url: linkedGuestIssue.url,
            text: linkedGuestIssue.contextText,
            kind: linkedGuestIssue.thread ?? 'issue',
        };
        if (linkedGuestIssue.author) issue.author = linkedGuestIssue.author;
        if (linkedGuestIssue.head && linkedGuestIssue.base) {
            issue.branches = { head: linkedGuestIssue.head, base: linkedGuestIssue.base };
        }
        if (linkedGuestIssue.data !== undefined) issue.data = linkedGuestIssue.data;
        // A chip can outlive the place it was attached in: the session may be
        // open on mobile or VS Code, where extensions never load, or the
        // extension may be paused or removed here. Say so instead of opening
        // an empty surface.
        const installed = useGuestsStore.getState().guests.find((entry) => entry.id === issue.providerId);
        if (!installed || !isGuestActive(installed)) {
            toast.info(t('chat.chatInput.toast.guestUnavailableHere'));
            return;
        }
        const guest = guestAttachItems.find((entry) => entry.id === issue.providerId);
        // Only an extension that declared a dialog gets one; everything else
        // (panel mode, no attach declared) opens the rail with the item.
        if (guest?.mode !== 'dialog') {
            useGuestItemStore.getState().setPendingItem(issue.providerId, issue);
            useUIStore.getState().openContextSurface(currentDirectory || '', pluginModeFromId(issue.providerId));
            return;
        }
        setAttachDialogItem(issue);
        setAttachDialogGuestId(issue.providerId);
    }, [currentDirectory, guestAttachItems, linkedGuestIssue, t]);
    const handleGuestAttach = React.useCallback((issue: AttachIssueRequest) => {
        const contextText = issue.text
            ?? `Attached ${issue.providerId} ${issue.id}: ${issue.title}\n${issue.url}`;
        setLinkedGuestIssue({
            providerId: issue.providerId,
            id: issue.id,
            title: issue.title,
            url: issue.url,
            contextText,
            thread: issue.kind === 'pull' ? 'pull' : 'issue',
            author: issue.author,
            head: issue.branches?.head,
            base: issue.branches?.base,
            data: issue.data,
        });
        setLinkedIssue(null);
        setLinkedPr(null);
        setLinkedLinearIssue(null);
        setAttachDialogGuestId(null);
        setAttachDialogItem(null);
        // A message or session action may have opened the guest in the
        // layout-level dialog; attaching from there closes it the same way.
        useGuestDialogStore.getState().close();
    }, []);
    React.useEffect(() => {
        if (!pendingGuestIssue) {
            return;
        }
        const issue = consumePendingGuestIssue();
        if (issue) {
            handleGuestAttach(issue);
        }
    }, [consumePendingGuestIssue, handleGuestAttach, pendingGuestIssue]);

    const lastSoftNetworkErrorToastAtRef = React.useRef(0);

    const handleSubmit = async (options?: SubmitOptions) => {
        const queuedOnly = options?.queuedOnly ?? false;
        const queuedMessageId = options?.queuedMessageId;
        const deliveryMode = options?.deliveryMode ?? 'normal';
        const inputSnapshot = options?.presetText != null
            ? {
                message: options.presetText,
                hasContent: options.presetText.trim().length > 0 || sendableAttachedFiles.length > 0 || hasDrafts,
            }
            : getCurrentInputSnapshot();
        const submittedSessionId = currentSessionId;
        const routedSessionId = isBtwActive ? btwPanel.btwSessionId : submittedSessionId;

        // An extension command never reaches the model: the extension turns
        // `/name args` into a chip, which lands through the same pending slot
        // a guest panel's `attach` uses. Nothing else in the composer moves.
        const guestRoute = !queuedOnly && !isBtwActive && inputSnapshot.hasContent
            ? routeGuestSlashCommand(inputSnapshot.message, inputMode, guestCommands)
            : null;
        if (guestRoute) {
            const guestRouteText = inputSnapshot.message;
            setMessage('');
            messageRef.current = '';
            confirmedMentionsRef.current.clear();
            const outcome = await runGuestCommand(guestRoute);
            if (outcome.ok) {
                if (outcome.item) {
                    useInputStore.getState().setPendingGuestIssue(outcome.item);
                } else {
                    // Nothing matched: give the command back so the user can fix the argument.
                    setMessage(guestRouteText);
                    messageRef.current = guestRouteText;
                    toast.info(t('chat.chatInput.toast.guestCommandNothing', { name: guestRoute.entry.guestName }));
                }
                return;
            }
            setMessage(guestRouteText);
            messageRef.current = guestRouteText;
            toast.error(outcome.reason === 'error'
                ? t('chat.chatInput.toast.guestCommandFailed', { command: guestRoute.entry.command.name, reason: outcome.message })
                : t('chat.chatInput.toast.guestCommandUnavailable', { name: guestRoute.entry.guestName }));
            return;
        }
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
        const routedDirectory = isBtwActive
            ? normalizePath(btwPanel.btwDirectory)
            : submittedDirectory;
        const submittedProject = routedDirectory
            ? resolveProjectForSessionDirectory(projects, availableWorktreesByProject, routedDirectory)
            : null;
        const submittedDraftProject = submittedDraftSnapshot?.selectedProjectId
            ? projects.find((project) => project.id === submittedDraftSnapshot.selectedProjectId)
            : null;
        const submittedServerId = routedSessionId
            ? (serverRegistry.getServerForSession(routedSessionId) ?? submittedProject?.serverId)
            : (submittedDraftProject?.serverId ?? submittedProject?.serverId);
        const submittedSendTarget: SendMessageTarget = {
            sessionId: routedSessionId,
            directory: routedDirectory,
            serverId: submittedServerId,
            draft: submittedDraftSnapshot,
        };
        const submittedDraftText = !queuedOnly ? inputSnapshot.message : '';
        const confirmedMentionsSnapshot = new Set(confirmedMentionsRef.current);
        let queuedMessagesToSend = queuedMessageId
            ? queuedMessages.filter((message) => message.id === queuedMessageId)
            : queuedMessages;
        // Server-owned queue: take before sending so the composer and the
        // server's dispatch loop cannot deliver the same message twice.
        let tookFromServerQueue = false;
        if (isServerOwnedMessageQueue() && currentSessionId && queuedMessagesToSend.length > 0) {
            try {
                queuedMessagesToSend = await useMessageQueueStore.getState().takeForSend(currentSessionId, queuedMessageId);
                tookFromServerQueue = true;
            } catch (error) {
                console.warn('[queue] failed to take queued messages for sending:', error);
                toast.error(t('chat.chatInput.toast.messageSendFailed'), {
                    description: 'Failed to take queued messages',
                });
                return;
            }
            if (queuedOnly && queuedMessagesToSend.length === 0) return;
        }

        if (queuedOnly) {
            if (queuedMessagesToSend.length === 0 || !currentSessionId) return;
        } else if ((!inputSnapshot.hasContent && !hasQueuedMessages) || (!currentSessionId && !newSessionDraftOpen)) {
            return;
        }

        if (isRuntimeAuthBlocked()) {
            toast.error(t('sessionAuth.expired.sendBlocked'));
            return;
        }

        const slashSkillSource = queuedMessagesToSend[0]?.content
            ?? (!queuedOnly && inputSnapshot.hasContent ? inputSnapshot.message.replace(/^\n+|\n+$/g, '') : '');
        const slashSkillText = parseAgentMentions(slashSkillSource, agents).sanitizedText;
        const slashSkillPreflight = inputMode === 'normal'
            ? buildSlashSkillDispatch(slashSkillText, { commands: availableCommands, skills: availableSkills })
            : null;
        if (slashSkillPreflight?.kind === 'unsynced') {
            setUnsyncedSkillError(t('chat.chatInput.error.skillNotLoaded', { name: slashSkillPreflight.skillName }));
            return;
        }

        const capturedSendConfig = queuedOnly ? queuedMessagesToSend[0]?.sendConfig : undefined;
        const providerIdToSend = capturedSendConfig?.providerID ?? currentProviderId;
        const modelIdToSend = capturedSendConfig?.modelID ?? currentModelId;
        const agentNameToSend = capturedSendConfig
            ? capturedSendConfig.agent
            : currentAgentName;
        const variantToSend = capturedSendConfig
            ? capturedSendConfig.variant
            : currentVariant;

        if (!providerIdToSend || !modelIdToSend) {
            console.warn('Cannot send message: provider or model not selected');
            toast.error(t('chat.chatInput.toast.messageSendFailed'), {
                description: 'Provider or model not selected',
            });
            return;
        }

        if (queuedOnly && autoReviewRunning) {
            return;
        }

        // While an auto-review loop owns the implementer session, queue user
        // input instead of racing the loop's forwarded turns.
        if (currentSessionId && !queuedOnly && autoReviewRunning && !isBtwActive) {
            handleQueueMessage();
            return;
        }

        if (currentSessionId && !queuedOnly && !isBtwActive) {
            const [deniedPermissions, dismissedQuestions] = await Promise.all([
                sessionActions.dismissOpenPermissionsForSession(currentSessionId),
                sessionActions.dismissOpenQuestionsForSession(currentSessionId),
            ]);
            if (deniedPermissions || dismissedQuestions) {
                handleQueueMessage();
                return;
            }
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
        const queuedMessagesSnapshot = currentSessionId && queuedMessagesToSend.length > 0
            ? [...queuedMessagesToSend]
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

            // Context captured with the queued message follows it (its own
            // synthetic text parts, instructions first).
            for (const contextPart of queuedContextToMessageParts(queuedMsg.context ?? [])) {
                additionalParts.push({ text: contextPart.text, synthetic: true });
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
        let composerHistoryText = '';
        if (!queuedOnly && inputSnapshot.hasContent) {
            const messageToSend = inputSnapshot.message.replace(/^\n+|\n+$/g, '');
            const { sanitizedText, mention } = parseAgentMentions(messageToSend, agents);
            const { sanitizedText: messageText, attachments: mentionAttachments } = extractInlineFileMentions(sanitizedText);
            const attachmentsToSend = sanitizeAttachmentsForSend(sendableAttachedFiles);
            composerAttachmentsSnapshot = attachmentsToSend;
            addMentionedSkills(messageText);
            composerHistoryText = messageToSend;

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

        const routedBtwSession = isBtwActive ? btwPanel.btwSession : btwPanel.parentSession;
        for (const part of getBtwSyntheticParts(routedBtwSession)) {
            additionalParts.push(part);
        }

        // Add linked issue as synthetic part (only the parts with synthetic: true)
        // The text part (synthetic: false) is completely dropped per requirements
        if (linkedIssue) {
            additionalParts.push({
                text: linkedIssue.contextText,
                synthetic: true,
            });
        }

        if (linkedGuestIssue) {
            additionalParts.push({
                text: linkedGuestIssue.contextText,
                synthetic: true,
            });
        }

        if (linkedLinearIssue) {
            additionalParts.push({
                text: linkedLinearIssue.contextText,
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

        const slashSkillDispatch = inputMode === 'normal'
            ? buildSlashSkillDispatch(primaryText, { commands: availableCommands, skills: availableSkills })
            : null;
        if (slashSkillDispatch?.kind === 'dispatch') {
            primaryText = slashSkillDispatch.visibleText;
            if (!mentionedSkillNames.some((name) => name.toLowerCase() === slashSkillDispatch.skillName.toLowerCase())) {
                mentionedSkillNames.push(slashSkillDispatch.skillName);
            }
            additionalParts.push({
                text: slashSkillDispatch.instructionText,
                synthetic: true,
            });
        }

        const genericMentionedSkillNames = slashSkillDispatch?.kind === 'dispatch'
            ? mentionedSkillNames.filter((name) => name.toLowerCase() !== slashSkillDispatch.skillName.toLowerCase())
            : mentionedSkillNames;
        const skillMentionInstruction = buildSkillMentionInstruction(genericMentionedSkillNames);
        if (skillMentionInstruction) {
            additionalParts.push({
                text: skillMentionInstruction,
                synthetic: true,
            });
        }

        if (!primaryText && primaryAttachments.length === 0 && additionalParts.length === 0) return;

        // Clear queue and input optimistically. Failure recovery below restores
        // these snapshots so a disconnected WS/SSE stream cannot swallow input.
        // (A server-owned queue was already taken above — removing again would
        // clear messages queued from another device meanwhile.)
        if (!tookFromServerQueue && currentSessionId && queuedMessagesToSend.length > 0) {
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
            composerRef.current?.blur();
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

                    await sessionActions.summarizeSession(submittedSessionId, {
                        modelID: modelIdToSend,
                        providerID: providerIdToSend,
                    });
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.compactFailed'));
                }
                return;
            }
            else if (commandName === 'btw' && submittedSessionId) {
                const invocation = parseSlashInvocation(normalizedCommand);
                const question = invocation?.arguments?.trim() ?? '';
                if (!question || !submittedDirectory) {
                    setMessage(normalizedCommand);
                    messageRef.current = normalizedCommand;
                    toast.error(t(question ? 'chat.btw.toast.createFailed' : 'chat.btw.toast.emptyArgument'));
                    return;
                }
                try {
                    if (btwSessionRef) {
                        const destroyed = await destroyBtwSession(btwSessionRef);
                        if (!destroyed) throw new Error(t('chat.btw.toast.destroyFailed'));
                    }
                    await startBtwSession({
                        parentSessionId: submittedSessionId,
                        question,
                        directory: submittedDirectory,
                        providerID: providerIdToSend,
                        modelID: modelIdToSend,
                        agent: agentNameToSend,
                        variant: variantToSend,
                    });
                } catch (error) {
                    setMessage(normalizedCommand);
                    messageRef.current = normalizedCommand;
                    toast.error(error instanceof Error ? error.message : t('chat.btw.toast.createFailed'));
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
                        providerIdToSend,
                        modelIdToSend,
                        agentNameToSend,
                        [],
                        agentMentionName,
                        [{ text: instructionsText, synthetic: true }],
                        variantToSend,
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
                        providerID: providerIdToSend,
                        modelID: modelIdToSend,
                        agent: agentNameToSend,
                        variant: variantToSend,
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
                        providerIdToSend,
                        modelIdToSend,
                        agentNameToSend,
                        [],
                        agentMentionName,
                        [{ text: instructionsText, synthetic: true }],
                        variantToSend,
                        inputMode,
                        submittedSendTarget,
                    );
                    scrollToBottom?.();
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.reviewFailed'));
                }
                return;
            }
            else if (
                commandName === 'craft-goal'
                && !isVSCodeRuntime()
                && (submittedSessionId || submittedNewSessionDraftOpen)
            ) {
                const craftGoalSupport = submittedSessionId
                    ? await probeSessionGoalSupportForSession(submittedSessionId)
                    : await probeSessionGoalSupport(
                        submittedNewSessionDraftOpen
                            ? useProjectsStore.getState().projects.find(
                                (project) => project.id === useSessionUIStore.getState().newSessionDraft?.selectedProjectId,
                            )?.serverId
                            : undefined,
                    );
                if (!craftGoalSupport.supported) {
                    toast.error(t(
                        craftGoalSupport.reason === 'unreachable'
                            ? 'chat.goal.toast.remoteUnreachable'
                            : 'chat.goal.toast.remoteUnsupported',
                    ));
                    return;
                }
                try {
                    await sessionActions.waitForConnectionOrThrow();
                    const idea = normalizedCommand.replace(/^\/craft-goal\b/i, '').trim();
                    const visibleText = await renderMagicPrompt('session.craftGoal.visible', {
                        idea_block: idea ? `\n\nHere is my initial idea:\n${idea}` : '',
                    });
                    const instructionsText = await renderMagicPrompt('session.craftGoal.instructions');
                    await sendMessage(
                        visibleText,
                        providerIdToSend,
                        modelIdToSend,
                        agentNameToSend,
                        [],
                        agentMentionName,
                        [{ text: instructionsText, synthetic: true }],
                        variantToSend,
                        inputMode,
                        submittedSendTarget,
                    );
                    scrollToBottom?.();
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.craftGoalFailed'));
                }
                return;
            }
            else if (
                commandName === 'schedule-task'
                && !isVSCodeRuntime()
                && (submittedSessionId || submittedNewSessionDraftOpen)
            ) {
                try {
                    await sessionActions.waitForConnectionOrThrow();
                    const idea = normalizedCommand.replace(/^\/schedule-task\b/i, '').trim();
                    const visibleText = await renderMagicPrompt('session.scheduleTask.visible', {
                        idea_block: idea ? `\n\nHere is my initial idea:\n${idea}` : '',
                    });
                    const instructionsText = await renderMagicPrompt('session.scheduleTask.instructions');
                    await sendMessage(
                        visibleText,
                        providerIdToSend,
                        modelIdToSend,
                        agentNameToSend,
                        [],
                        agentMentionName,
                        [{ text: instructionsText, synthetic: true }],
                        variantToSend,
                        inputMode,
                        submittedSendTarget,
                    );
                    scrollToBottom?.();
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.scheduleTaskFailed'));
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
                        providerIdToSend,
                        modelIdToSend,
                        agentNameToSend,
                        [],
                        agentMentionName,
                        [{ text: instructionsText, synthetic: true }],
                        variantToSend,
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

        const currentSessionDirectory = routedDirectory;
        if (routedSessionId && !currentSessionDirectory) {
            throw new Error(`Cannot send message: directory for session ${routedSessionId} is not available`);
        }
        const sendDirectory = currentSessionDirectory ?? undefined;
        const shouldAddResponseStyle = !isBtwActive && (
            submittedNewSessionDraftOpen
            || (routedSessionId ? !hasUserMessages(routedSessionId, sendDirectory) : false)
        );
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
            providerIdToSend,
            modelIdToSend,
            agentNameToSend,
            primaryAttachments,
            agentMentionName,
            additionalParts.length > 0 ? additionalParts : undefined,
            variantToSend,
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
            // Record the prompts that just went out so they still recall after
            // a reload (queued items are recorded by the queue store itself on
            // server acceptance; VS Code delivery records them here).
            const historyIdentity = createInputHistoryIdentity(
                getRuntimeKey(),
                submittedDirectory ?? '',
                submittedSessionId ?? '',
            );
            if (historyIdentity) {
                const historySubmissions = buildChatInputHistorySubmissions({
                    inputMode,
                    // Server-owned items were recorded on queue acceptance.
                    queuedMessages: isServerOwnedMessageQueue() ? [] : queuedMessagesSnapshot,
                    composerText: composerHistoryText,
                    composerAttachments: composerAttachmentsSnapshot,
                    includeComposer: composerHistoryText.length > 0,
                });
                if (historySubmissions?.length) {
                    useInputHistoryStore.getState().appendSubmissions(historyIdentity, historySubmissions);
                }
            }

            // Clear linked issue after successful message send
            if (linkedIssue) {
                setLinkedIssue(null);
            }
            if (linkedPr) {
                setLinkedPr(null);
            }
            if (linkedLinearIssue) {
                setLinkedLinearIssue(null);
            }
            if (linkedGuestIssue) {
                setLinkedGuestIssue(null);
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
                if (composerAttachmentsSnapshot.length > 0) {
                    if (restoreIntoVisibleInput) {
                        useInputStore.getState().setAttachedFiles(composerAttachmentsSnapshot);
                    } else if (submittedSessionId) {
                        // User already switched away: restore into the original
                        // session bucket so the image is not carried into the
                        // visible composer (and so returning to the session still has it).
                        useInputStore.getState().setAttachedFilesForSession(
                            submittedSessionId,
                            composerAttachmentsSnapshot,
                        );
                    }
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
                // The stream may still deliver the message, but swallowing the
                // error entirely reads as "input disappeared" when the request
                // actually died. Surface it once per burst instead.
                const now = Date.now();
                if (now - lastSoftNetworkErrorToastAtRef.current > 5000) {
                    lastSoftNetworkErrorToastAtRef.current = now;
                    toast.error(
                        composerAttachmentsSnapshot.length > 0
                            ? t('chat.chatInput.toast.sendAttachmentsFailed')
                            : (rawMessage || t('chat.chatInput.toast.messageSendFailed')),
                    );
                }
                return;
            }

            toast.error(rawMessage || t('chat.chatInput.toast.messageSendFailed'));
        });

        if (!isMobile) {
            composerRef.current?.focus();
        }
    };

    // Update ref with latest handleSubmit on every render
    handleSubmitRef.current = handleSubmit;

    const handlePrimaryAction = React.useCallback(() => {
        const inputSnapshot = getCurrentInputSnapshot();
        const canQueue = !isBtwActive && inputMode === 'normal' && inputSnapshot.hasContent && currentSessionId && (sessionPhase !== 'idle' || autoReviewRunning);
        const action = resolveFollowUpAction({
            behavior: followUpBehavior,
            canQueue: Boolean(canQueue),
            alternate: false,
        });
        if (action === 'queue') {
            return handleQueueMessage();
        }
        void handleSubmitRef.current({ deliveryMode: action });
    }, [inputMode, getCurrentInputSnapshot, currentSessionId, sessionPhase, autoReviewRunning, followUpBehavior, handleQueueMessage, isBtwActive]);

    const handleSendNow = React.useCallback(() => {
        void handleSubmitRef.current({ deliveryMode: 'steer' });
    }, []);

    const handleKeyDown = (e: KeyboardEvent) => {
        // Early return during IME composition to prevent interference with autocomplete.
        // Uses keyCode === 229 fallback for WebKit where compositionend fires before keydown.
        if (isIMECompositionEvent(e)) return;

        if (inputMode === 'normal' && e.key === '!') {
            const selection = composerRef.current?.getSelection();
            if (selection?.start === 0 && selection.end === 0) {
                e.preventDefault();
                setInputMode('shell');
                setShowCommandAutocomplete(false);
                setShowSkillAutocomplete(false);
                setShowSnippetAutocomplete(false);
                setShowFileMention(false);
                return;
            }
        }

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
            const editor = composerRef.current;
            const selection = editor?.getSelection();
            const selectionStart = selection?.start ?? message.length;
            const selectionEnd = selection?.end ?? message.length;
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
                        composerRef.current?.setSelection(tokenStart);
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
        const historySelection = composerRef.current?.getSelection();
        const historySelectionStart = historySelection?.start ?? 0;
        const historySelectionEnd = historySelection?.end ?? 0;
        const historyNavGate = {
          autocompleteOpen: isAnyAutocompleteOpen,
          messageLength: message.length,
          selectionStart: historySelectionStart,
          selectionEnd: historySelectionEnd,
        };
        const canNavigateHistoryUp = canNavigateComposerHistoryUp(historyNavGate);
        const canNavigateHistoryDown = canNavigateComposerHistoryDown(historyNavGate);

        if (inputMode === 'normal' && !isAnyAutocompleteOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const editor = composerRef.current;
            const selection = editor?.getSelection();
            const selectionStart = selection?.start ?? -1;
            const selectionEnd = selection?.end ?? -1;

            if (editor && selectionStart >= 0) {
                const applyEdit = (next: string, caretStart: number, caretEnd: number) => {
                    e.preventDefault();
                    setMessage(next);
                    composerRef.current?.setSelection(caretStart, caretEnd);
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
            const step = resolveComposerHistoryArrowUp({
              historyIndex,
              historyLength: userMessageHistory.length,
            });
            if (step.type === 'noop') return;
            e.preventDefault();
            if (step.type === 'enter') {
                setDraftMessage(message);
                setHistoryIndex(0);
                setMessage(userMessageHistory[0]);
            } else if (step.type === 'older') {
                setHistoryIndex(step.index);
                setMessage(userMessageHistory[step.index]);
            }
            requestAnimationFrame(() => {
                composerRef.current?.setSelection(0, 0);
            });
            return;
        }

        if (e.key === 'ArrowDown' && canNavigateHistoryDown && historyIndex >= 0) {
            const step = resolveComposerHistoryArrowDown({ historyIndex });
            if (step.type === 'noop') return;
            e.preventDefault();
            if (step.type === 'exit') {
                setHistoryIndex(-1);
                setMessage(draftMessage);
                setDraftMessage('');
            } else if (step.type === 'newer') {
                setHistoryIndex(step.index);
                setMessage(userMessageHistory[step.index]);
            }
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey)) {
            e.preventDefault();

            const isCtrlEnter = e.ctrlKey || e.metaKey;
            const canQueue = !isBtwActive && inputMode === 'normal' && hasContent && currentSessionId && (sessionPhase !== 'idle' || autoReviewRunning);
            const action = resolveFollowUpAction({
                behavior: followUpBehavior,
                canQueue: Boolean(canQueue),
                alternate: isCtrlEnter,
            });
            if (action === 'queue') {
                handleQueueMessage();
                return;
            }
            handleSubmit({ deliveryMode: action });
        }
    };

    const openAutocomplete = showCommandAutocomplete
        ? 'command'
        : showSkillAutocomplete
            ? 'skill'
            : showSnippetAutocomplete
                ? 'snippet'
                : showFileMention
                    ? 'mention'
                    : null;
    const {
        position: autocompleteOverlayPosition,
        update: updateAutocompleteOverlayPosition,
    } = useAutocompletePosition({
        enabled: isDesktopExpanded,
        openAutocomplete,
        message,
        editorRef: composerRef,
        containerRef: dropZoneRef,
    });

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
        const sessionId = isBtwActive ? btwPanel.btwSessionId : currentSessionId;
        if (!sessionId) return;

        void abortCurrentOperation(sessionId).then((sent) => {
            if (sent) {
                startAbortFeedback();
            }
        }).catch((error) => {
            console.error('[ChatInput] abort failed', error);
        });
    }, [abortCurrentOperation, btwPanel.btwSessionId, clearAbortPrompt, currentSessionId, isBtwActive, startAbortFeedback]);

    const handleCycleAgent = React.useCallback((direction: 1 | -1 = 1) => {
        const nextAgentName = getCycledPrimaryAgentName(agents, currentAgentName, direction);
        if (!nextAgentName) return;

        setAgent(nextAgentName);

        if (currentSessionId) {
            saveSessionAgentSelection(currentSessionId, nextAgentName);
        }
    }, [agents, currentAgentName, currentSessionId, setAgent, saveSessionAgentSelection]);

    const updateAutocompleteState = React.useCallback((
        value: string,
        cursorPosition: number,
        inputSource: FileMentionAutocompleteInputSource = 'manual',
        insertedText?: string,
    ) => {
        const trigger = resolveAutocompleteTrigger(value, cursorPosition, {
            inputMode,
            inputSource,
            insertedText,
        });
        setShowCommandAutocomplete(trigger?.kind === 'command');
        setShowSkillAutocomplete(trigger?.kind === 'skill');
        setShowSnippetAutocomplete(trigger?.kind === 'snippet');
        setShowFileMention(trigger?.kind === 'mention');
        setCommandQuery(trigger?.kind === 'command' ? trigger.query : '');
        setSkillQuery(trigger?.kind === 'skill' ? trigger.query : '');
        setSnippetQuery(trigger?.kind === 'snippet' ? trigger.query : '');
        setMentionQuery(trigger?.kind === 'mention' ? trigger.query : '');
        if (trigger?.kind === 'command') {
            setAutocompleteTab('commands');
        } else if (trigger?.kind === 'mention') {
            setAutocompleteTab((current) => current === 'files' ? 'files' : 'agents');
        }
    }, [inputMode]);

    const applyAutocompletePrefix = React.useCallback((prefix: '/' | '@') => {
        const nextMessage = message.length === 0
            ? prefix
            : (message[0] === '/' || message[0] === '@')
                ? `${prefix}${message.slice(1)}`
                : `${prefix}${message}`;
        setMessage(nextMessage);
        requestAnimationFrame(() => {
            const nextCursor = Math.min(nextMessage.length, composerRef.current?.getValue().length ?? nextMessage.length);
            composerRef.current?.setSelection(nextCursor);
            updateAutocompleteState(nextMessage, nextMessage.length);
        });
    }, [message, setMessage, updateAutocompleteState]);

    const handleAutocompleteTabSelect = React.useCallback((tab: 'commands' | 'agents' | 'files') => {
        const textarea = composerRef.current;
        if (isMobile && textarea) {
            try {
                textarea.focus({ preventScroll: true });
            } catch {
                textarea.focus();
            }
            const len = textarea.getValue().length;
            textarea.setSelection(len);
        }
        const cursorPosition = textarea?.getSelection().start ?? message.length;
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
        const textarea = composerRef.current;
        if (textarea) {
            try {
                textarea.focus({ preventScroll: true });
            } catch {
                textarea.focus();
            }
            const len = textarea.getValue().length;
            textarea.setSelection(len);
        }
        applyAutocompletePrefix('/');
        setCommandQuery('');
        setAutocompleteTab('commands');
        setShowCommandAutocomplete(true);
        setShowFileMention(false);
        setShowSkillAutocomplete(false);
        setShowSnippetAutocomplete(false);
    }, [applyAutocompletePrefix, isMobile, setAutocompleteTab, setCommandQuery, setShowCommandAutocomplete, setShowFileMention, setShowSkillAutocomplete]);

    const insertTextAtSelection = React.useCallback((
        text: string,
        inputSource: FileMentionAutocompleteInputSource = 'manual',
    ) => {
        if (!text) {
            return;
        }

        const textarea = composerRef.current;
        if (!textarea) {
            const nextValue = message + text;
            setMessage(nextValue);
            updateAutocompleteState(nextValue, nextValue.length, inputSource, text);
            return;
        }

        const { start, end } = textarea.getSelection();
        const nextValue = `${message.substring(0, start)}${text}${message.substring(end)}`;
        const cursorPosition = start + text.length;
        textarea.insertText(text);
        updateAutocompleteState(nextValue, cursorPosition, inputSource, text);
    }, [message, updateAutocompleteState]);

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

    const clearFileMentionPasteSuppression = React.useCallback(() => {
        suppressNextFileMentionPasteRef.current = false;
        if (suppressNextFileMentionPasteTimeoutRef.current) {
            clearTimeout(suppressNextFileMentionPasteTimeoutRef.current);
            suppressNextFileMentionPasteTimeoutRef.current = null;
        }
    }, []);

    const markFileMentionPasteSuppression = React.useCallback(() => {
        suppressNextFileMentionPasteRef.current = true;
        if (suppressNextFileMentionPasteTimeoutRef.current) {
            clearTimeout(suppressNextFileMentionPasteTimeoutRef.current);
        }
        suppressNextFileMentionPasteTimeoutRef.current = setTimeout(() => {
            suppressNextFileMentionPasteRef.current = false;
            suppressNextFileMentionPasteTimeoutRef.current = null;
        }, 700);
    }, []);

    const handleComposerChange = ({ value, selection, fromPaste, insertedText }: ComposerChange) => {
        if (shellTriggerNormalizationRef.current) {
            shellTriggerNormalizationRef.current = false;
            setMessage(value);
            return;
        }

        if (isVSCodeRuntime() && suppressNextFileDropTextInsertRef.current) {
            const candidateAbsolutePaths = pendingDroppedAbsolutePathsRef.current;
            if (candidateAbsolutePaths.some((path) => path.length > 0 && value.includes(path))) {
                clearDropTextSuppression();
                return;
            }
        }

        setUnsyncedSkillError(null);
        const pasteMarked = suppressNextFileMentionPasteRef.current;
        const pastedInsertedText = fromPaste ? insertedText : '';
        const isPasteInput = pastedInsertedText.includes('@') || pasteMarked;
        if (suppressNextFileMentionPasteRef.current) {
            clearFileMentionPasteSuppression();
        }
        const inputSource: FileMentionAutocompleteInputSource = isPasteInput ? 'paste' : 'manual';

        if (inputMode === 'normal' && value.startsWith('!')) {
            const shellCommand = value.slice(1);
            const nextCursor = Math.max(0, selection.start - 1);
            setInputMode('shell');
            setShowCommandAutocomplete(false);
            setShowSkillAutocomplete(false);
            setShowSnippetAutocomplete(false);
            setShowFileMention(false);
            const editor = composerRef.current;
            if (editor) {
                shellTriggerNormalizationRef.current = true;
                editor.replaceRange(0, 1, '', nextCursor);
            } else {
                setMessage(shellCommand);
            }
            return;
        }

        setMessage(value);
        updateAutocompleteState(value, selection.start, inputSource, pastedInsertedText);
    };

    React.useEffect(() => {
        return () => {
            clearDropTextSuppression();
            clearFileMentionPasteSuppression();
        };
    }, [clearDropTextSuppression, clearFileMentionPasteSuppression]);

    /**
     * Attach files that arrived by paste or drop and cite each one in the
     * draft as `[name]`, the same way pasted images are cited. Images get a
     * generated unique name up front; other files keep their own name and are
     * cited only once they attached, so a rejected file leaves no dangling
     * citation.
     */
    const attachFilesWithCitation = React.useCallback(async (
        files: File[],
        leadingText: string = '',
    ): Promise<void> => {
        const imageFiles = files.filter((file) => file.type.startsWith('image/'));
        const otherFiles = files.filter((file) => !file.type.startsWith('image/'));

        const insertCitation = (filenames: string[], text: string) => {
            if (filenames.length === 0 && !text) return;
            const citationText = buildAttachmentCitationText(filenames);
            const editor = composerRef.current;
            const currentMessage = editor?.getValue() ?? messageRef.current;
            const selectionStart = editor?.getSelection().start ?? currentMessage.length;
            const selectionEnd = editor?.getSelection().end ?? currentMessage.length;
            const insertionText = withInlineInsertionBoundaries(
                buildImagePasteInsertion(text, citationText),
                currentMessage.slice(0, selectionStart),
                currentMessage.slice(selectionEnd),
            );
            insertTextAtSelection(insertionText, getFileMentionInputSourceForInsertedText(insertionText));
        };

        const assignedImageNames = assignImageAttachmentFilenames(
            imageFiles,
            [
                ...useInputStore.getState().attachedFiles.map((file) => file.filename),
                ...pendingPastedAttachmentFilenamesRef.current,
            ],
        );
        insertCitation(assignedImageNames, leadingText);

        let attached = false;
        for (let index = 0; index < imageFiles.length; index += 1) {
            const filename = assignedImageNames[index];
            const file = renameFileForAttachmentCitation(imageFiles[index], filename);
            pendingPastedAttachmentFilenamesRef.current.add(filename);
            try {
                attached = (await addAttachedFile(file)) || attached;
            } catch (error) {
                console.error('Clipboard image attach failed', error);
                toast.error(error instanceof Error ? error.message : t('chat.chatInput.toast.clipboardAttachFailed'));
            } finally {
                pendingPastedAttachmentFilenamesRef.current.delete(filename);
            }
        }

        const attachedOtherNames: string[] = [];
        for (const file of otherFiles) {
            try {
                if (await addAttachedFile(file)) {
                    attached = true;
                    attachedOtherNames.push(file.name);
                }
            } catch (error) {
                console.error('File attach failed', error);
            }
        }
        insertCitation(attachedOtherNames, '');

        if (files.length > 0 && !attached) {
            toast.error(t('chat.chatInput.toast.attachFileFailed'));
        }
    }, [addAttachedFile, insertTextAtSelection, t]);

    const handlePaste = React.useCallback(async (e: ClipboardEvent) => {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;
        if (inputMode === 'normal' && (currentSessionId || newSessionDraftOpen)) {
            const editor = composerRef.current;
            const selection = editor?.getSelection();
            const selectionStart = selection?.start ?? -1;
            const selectionEnd = selection?.end ?? -1;
            if (editor && selectionEnd > selectionStart) {
                const clipboardText = clipboardData.getData('text');
                const url = clipboardText.trim();
                const selected = message.slice(selectionStart, selectionEnd);
                if (shouldWrapSelectionAsLink(url, selected)) {
                    e.preventDefault();
                    const next = `${message.slice(0, selectionStart)}[${selected}](${url})${message.slice(selectionEnd)}`;
                    const caret = selectionStart + 1 + selected.length + 2 + url.length + 1;
                    setMessage(next);
                    composerRef.current?.setSelection(caret);
                    updateAutocompleteState(next, caret, getFileMentionInputSourceForInsertedText(url), url);
                    return;
                }
            }
        }

        // Images get a citation and a generated name; every other clipboard
        // file (Finder/Explorer copy, a saved document) attaches as picked.
        const imageMap = new Map<string, File>();
        const otherFileMap = new Map<string, File>();
        const collectClipboardFile = (file: File) => {
            const target = file.type.startsWith('image/') ? imageMap : otherFileMap;
            target.set(`${file.name}-${file.size}`, file);
        };

        Array.from(clipboardData.files || []).forEach(collectClipboardFile);

        Array.from(clipboardData.items || []).forEach(item => {
            if (item.kind !== 'file') return;
            const file = item.getAsFile();
            if (file) collectClipboardFile(file);
        });

        const imageFiles = Array.from(imageMap.values());
        const otherFiles = Array.from(otherFileMap.values());
        const pastedText = clipboardData.getData('text');

        // Word/Excel/Google Docs etc. copy the selection as text/plain + text/html AND a
        // rendered PNG snapshot of that same selection. The PNG is a bitmap of the text,
        // not a separately intended image — attaching it on every Office paste is noise.
        // When real text rides along, drop the image and let the browser paste the text.
        if (imageFiles.length > 0 && clipboardHasMeaningfulText(clipboardData)) {
            if (pastedText.includes('@')) {
                markFileMentionPasteSuppression();
            }
            return;
        }

        if (imageFiles.length === 0 && otherFiles.length > 0) {
            // A copied file also carries its name as text; keep it out of the draft.
            e.preventDefault();
            if (!currentSessionId && !newSessionDraftOpen) {
                return;
            }
            await attachFilesWithCitation(otherFiles);
            return;
        }

        if (imageFiles.length === 0) {
            if (pastedText.includes('@')) {
                markFileMentionPasteSuppression();
            }
            return;
        }

        if (!currentSessionId && !newSessionDraftOpen) {
            if (pastedText.includes('@')) {
                markFileMentionPasteSuppression();
            }
            return;
        }

        e.preventDefault();
        await attachFilesWithCitation([...imageFiles, ...otherFiles], pastedText);
    }, [addAttachedFile, attachFilesWithCitation, currentSessionId, inputMode, markFileMentionPasteSuppression, message, newSessionDraftOpen, insertTextAtSelection, setMessage, t, updateAutocompleteState]);

    const handleFileSelect = (file: { name: string; path: string; relativePath?: string }) => {

        const cursorPosition = composerRef.current?.getSelection().start ?? 0;
        const textBeforeCursor = message.substring(0, cursorPosition);
        const lastAtSymbol = textBeforeCursor.lastIndexOf('@');

        const mentionPath = (file.relativePath && file.relativePath.trim().length > 0)
            ? file.relativePath.trim()
            : (toProjectRelativeMentionPath(file.path, chatSearchDirectory || '') || file.name);

        confirmedMentionsRef.current.add(mentionPath);

        if (lastAtSymbol !== -1) {
            const newMessage =
                message.substring(0, lastAtSymbol) +
                `@${mentionPath} ` +
                message.substring(cursorPosition);
            setMessage(newMessage);
            const nextCursor = lastAtSymbol + mentionPath.length + 2;
            requestAnimationFrame(() => {
                composerRef.current?.setSelection(nextCursor);
                updateAutocompleteState(newMessage, nextCursor);
            });
        } else if (composerRef.current) {
            const newMessage =
                message.substring(0, cursorPosition) +
                `@${mentionPath} ` +
                message.substring(cursorPosition);
            setMessage(newMessage);
            const nextCursor = cursorPosition + mentionPath.length + 2;
            requestAnimationFrame(() => {
                composerRef.current?.setSelection(nextCursor);
                updateAutocompleteState(newMessage, nextCursor);
            });
        }

        setShowFileMention(false);
        setMentionQuery('');
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        composerRef.current?.focus();
    };

    const handleAgentSelect = (agentName: string) => {
        const editor = composerRef.current;
        const cursorPosition = editor?.getSelection().start ?? message.length;
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
                composerRef.current?.setSelection(nextCursor);
                updateAutocompleteState(newMessage, nextCursor);
            });
        } else if (composerRef.current) {
            const newMessage =
                message.substring(0, cursorPosition) +
                `@${agentName} ` +
                message.substring(cursorPosition);
            setMessage(newMessage);

            const nextCursor = cursorPosition + agentName.length + 2;
            requestAnimationFrame(() => {
                composerRef.current?.setSelection(nextCursor);
                updateAutocompleteState(newMessage, nextCursor);
            });
        }

        setShowFileMention(false);
        setMentionQuery('');
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        composerRef.current?.focus();
    };

    const handleSkillSelect = (skillName: string) => {
        setUnsyncedSkillError(null);
        const editor = composerRef.current;
        const cursorPosition = editor?.getSelection().start ?? message.length;
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
                composerRef.current?.setSelection(nextCursor);
                updateAutocompleteState(newMessage, nextCursor);
            });
        }

        setShowSkillAutocomplete(false);
        setSkillQuery('');
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        composerRef.current?.focus();
    };

    const handleSnippetSelect = (_snippet: unknown, trigger: string) => {
        const editor = composerRef.current;
        const cursorPosition = editor?.getSelection().start ?? message.length;
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
            composerRef.current?.setSelection(nextCursor);
            updateAutocompleteState(newMessage, nextCursor);
        });

        composerRef.current?.focus();
    };

    const handleCommandSelect = (command: CommandInfo) => {

        setMessage(`/${command.name} `);

        setShowCommandAutocomplete(false);
        setCommandQuery('');
        setShowSnippetAutocomplete(false);
        setSnippetQuery('');

        const refocus = () => {
            if (composerRef.current) {
                try {
                    composerRef.current.focus({ preventScroll: true });
                } catch {
                    composerRef.current.focus();
                }
                const end = composerRef.current.getValue().length;
                composerRef.current.setSelection(end);
            }
        };

        requestAnimationFrame(() => {
            refocus();
            requestAnimationFrame(refocus);
        });
        setTimeout(refocus, 60);
    };

    React.useEffect(() => {

        if (currentSessionId && composerRef.current && !isMobile) {
            composerRef.current.focus();
        }
    }, [currentSessionId, isMobile]);

    React.useEffect(() => {
        if (!isMobile) {
            setMobileControlsPanel(null);
        }
    }, [isMobile]);

    React.useEffect(() => {
        const activeAbortSessionId = isBtwActive ? btwPanel.btwSessionId : currentSessionId;
        if (abortPromptSessionId && abortPromptSessionId !== activeAbortSessionId) {
            clearAbortPrompt();
        }
    }, [abortPromptSessionId, btwPanel.btwSessionId, currentSessionId, clearAbortPrompt, isBtwActive]);

    const addVSCodeDroppedUrisAsMentions = React.useCallback((uris: string[]) => {
        if (uris.length === 0) return;

        const paths = uris
            .map((entry) => normalizeDroppedPath(entry))
            .map((entry) => toProjectRelativeMentionPath(entry, chatSearchDirectory || ''))
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
    }, [chatSearchDirectory, setPendingInputText, t]);

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
            const textarea = composerRef.current;
            const currentMessage = messageRef.current;
            if (textarea) {
                const selection = textarea.getSelection();
                const pos = selection.start ?? cursorPosRef.current;
                const end = selection.end ?? pos;
                const before = currentMessage.slice(0, pos);
                const after = currentMessage.slice(end);
                const needSpaceBefore = before.length > 0 && !/\s$/.test(before);
                const needSpaceAfter = after.length > 0 && !/^\s/.test(after);
                const insert = `${needSpaceBefore ? ' ' : ''}${mention}${needSpaceAfter ? ' ' : ''}`;
                const nextMessage = `${before}${insert}${after}`;
                setMessage(nextMessage);
                requestAnimationFrame(() => {
                    const cursorPos = pos + insert.length;
                    textarea.setSelection(cursorPos);
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
            await attachFilesWithCitation(files);
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
            const params = new URLSearchParams({
                extensions: ACCEPTED_ATTACHMENT_EXTENSIONS.join(','),
            });
            const response = await fetch(`/api/vscode/pick-files?${params.toString()}`);
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
        if (newSessionDraft?.target === 'chat') return null;
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
    }, [activeProjectId, availableWorktreesByProject, newSessionDraft?.bootstrapPendingDirectory, newSessionDraft?.directoryOverride, newSessionDraft?.preserveDirectoryOverride, newSessionDraft?.selectedProjectId, newSessionDraft?.target, projects]);

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
        if (projectId === CHAT_DRAFT_PROJECT_ID) {
            const activeProject = activeProjectId
                ? projects.find((entry) => entry.id === activeProjectId) ?? null
                : null;
            setNewSessionDraftTarget({
                projectId: CHAT_DRAFT_PROJECT_ID,
                directoryOverride: null,
                serverId: activeProject?.serverId,
            }, { force: true });
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
    const sendIconSizeClass = isMobile ? 'h-4 w-4' : (isVSCode ? 'h-3.5 w-3.5' : 'h-4 w-4');
    const stopIconSizeClass = isMobile ? 'h-6 w-6' : (isVSCode ? 'h-4 w-4' : 'h-5 w-5');
    const iconSizeClass = isMobile ? 'h-[18px] w-[18px]' : (isVSCode ? 'h-4 w-4' : 'h-[18px] w-[18px]');

    const iconButtonBaseClass = 'flex cursor-pointer items-center justify-center text-foreground transition-none outline-none focus:outline-none flex-shrink-0 disabled:cursor-not-allowed';
    const footerIconButtonClass = cn(iconButtonBaseClass, buttonSizeClass);
    const permissionScopeSessionId = currentSessionId ?? currentManagementSessionId;
    const sessionPermissionAutoAcceptEnabled = usePermissionStore((state) => {
        if (!permissionScopeSessionId) {
            return false;
        }
        return state.isSessionAutoAccepting(permissionScopeSessionId);
    });
    const permissionAutoAcceptEnabled = permissionScopeSessionId
        ? sessionPermissionAutoAcceptEnabled
        : draftPermissionAutoAcceptEnabled;
    const isPermissionAutoAcceptInteractive = Boolean(permissionScopeSessionId || newSessionDraftOpen);

    const handlePermissionAutoAcceptToggle = React.useCallback(() => {
        if (!permissionScopeSessionId) {
            if (newSessionDraftOpen) {
                setDraftPermissionAutoAccept(!draftPermissionAutoAcceptEnabled);
                return;
            }
            toast.error(t('chat.chatInput.toast.openSessionFirst'));
            return;
        }

        const nextEnabled = !permissionAutoAcceptEnabled;
        setSessionAutoAccept(permissionScopeSessionId, nextEnabled).catch(() => {
            toast.error(t('chat.chatInput.toast.togglePermissionAutoAcceptFailed'));
        });
    }, [
        draftPermissionAutoAcceptEnabled,
        newSessionDraftOpen,
        permissionAutoAcceptEnabled,
        permissionScopeSessionId,
        setDraftPermissionAutoAccept,
        setSessionAutoAccept,
        t,
    ]);

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
                "oc-mobile-composer relative pt-0 pb-4",
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
                <AutoReviewBanner />
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
                        {browserElementNames ? (
                            <div
                                className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 max-w-full"
                                style={{
                                    backgroundColor: currentTheme?.colors?.surface?.elevated,
                                    borderColor: currentTheme?.colors?.interactive?.border,
                                }}
                            >
                                <Icon name="cursor" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="text-xs font-semibold truncate" style={{ color: currentTheme?.colors?.status?.info }} title={browserElementNames}>{browserElementNames}</span>
                                <button
                                    type="button"
                                    className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
                                    onClick={() => removePreviewDrafts('browser-element')}
                                    aria-label={t('chat.chatInput.previewContextRemove')}
                                    title={t('chat.chatInput.previewContextRemove')}
                                >
                                    <Icon name="close" className="h-3 w-3" />
                                </button>
                            </div>
                        ) : null}
                    </div>
                )}

                <RevertedMessageDock
                    sessionId={currentSessionId}
                    directory={currentSessionDirectoryForSync ?? currentDirectory}
                />
                <SessionGoalRow
                    sessionId={currentSessionId}
                    directory={currentSessionDirectoryForSync ?? currentDirectory}
                    className="mb-1.5"
                />
                <MemoStatusRow
                    showAssistantStatus={false}
                    showTodos
                    leftAccessory={newSessionDraftOpen || !hasPendingChanges ? null : <PendingChangesBar />}
                />
                {showDraftTargetSelectors && (selectedDraftProject || newSessionDraft?.target === 'chat') ? (
                    <div className="mb-1.5 flex min-w-0 items-center gap-1.5 px-0.5">
                        <Select
                            value={newSessionDraft?.target === 'chat' ? CHAT_DRAFT_PROJECT_ID : selectedDraftProject?.id}
                            onValueChange={handleDraftProjectChange}
                        >
                            <SelectTrigger
                                size="sm"
                                className="h-7 min-w-0 w-fit max-w-[42vw] sm:max-w-[18rem] border-transparent bg-transparent px-1.5 hover:bg-transparent data-[popup-open]:bg-transparent"
                            >
                                <SelectValue>
                                    {newSessionDraft?.target === 'chat' ? (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Icon name="chat-ai-3" className="size-3.5" />
                                            <span>{t('chat.chatInput.chats')}</span>
                                        </span>
                                    ) : selectedDraftProject ? renderProjectLabelWithIcon(selectedDraftProject) : null}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent fitContent>
                                <SelectItem value={CHAT_DRAFT_PROJECT_ID}>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Icon name="chat-ai-3" className="size-3.5" />
                                        <span>{t('chat.chatInput.chats')}</span>
                                    </span>
                                </SelectItem>
                                <SelectSeparator />
                                {projects.map((project) => (
                                    <SelectItem key={project.id} value={project.id} className="max-w-[24rem] truncate">
                                        {renderProjectLabelWithIcon(project)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {selectedDraftProject && shouldShowDraftBranchSelector ? (
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
                        "border border-border/80 focus-within:border-interactive-selection-foreground/35",
                        "shadow-[0_4px_16px_-4px_rgb(0_0_0_/_0.12)]",
                        // The box floats over the transcript, so it is glass.
                        'oc-glass-composer',
                        isDragging && "ring-2 ring-primary ring-offset-2"
                    )}
                    style={{
                        borderRadius: chatInputRadius,
                    }}
                    ref={dropZoneRef}
                    onDropCapture={handleDropCapture}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                >
                    {/* The autocomplete popups anchor to this wrapper, not to the
                        glass box: a backdrop-filter ancestor is a backdrop root,
                        so a glass popup inside the box would only blur the box's
                        own contents and read as a flat tint over the transcript. */}
                    <div className={cn('relative', isDesktopExpanded && 'flex flex-1 min-h-0 flex-col')}>
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
                            <AttachedFilesList />
                            {linkedIssue && !isVSCode ? (
                                <LinkedReferenceRow
                                    numberLabel={`#${linkedIssue.number}`}
                                    title={linkedIssue.title}
                                    url={linkedIssue.url}
                                    author={linkedIssue.author}
                                    openInBrowserLabel={t('chat.chatInput.linked.issue.openInBrowserAria')}
                                    removeLabel={t('chat.chatInput.linked.issue.removeAria')}
                                    onReopenPicker={() => setIssuePickerOpen(true)}
                                    onRemove={() => setLinkedIssue(null)}
                                />
                            ) : null}
                            {linkedGuestIssue && !isVSCode ? (
                                <LinkedReferenceRow
                                    numberLabel={linkedGuestIssue.thread === 'pull'
                                        ? t('chat.chatInput.linked.guest.pr.number', { id: linkedGuestIssue.id })
                                        : linkedGuestIssue.id}
                                    title={linkedGuestIssue.title}
                                    url={linkedGuestIssue.url}
                                    author={linkedGuestIssue.author ? { login: linkedGuestIssue.author } : undefined}
                                    branches={linkedGuestIssue.thread === 'pull' && linkedGuestIssue.head && linkedGuestIssue.base
                                        ? { head: linkedGuestIssue.head, base: linkedGuestIssue.base }
                                        : undefined}
                                    openInBrowserLabel={t('chat.chatInput.linked.guest.openInBrowserAria', { id: linkedGuestIssue.id })}
                                    removeLabel={t('chat.chatInput.linked.guest.removeAria', { id: linkedGuestIssue.id })}
                                    onReopenPicker={reopenGuestItem}
                                    onRemove={() => setLinkedGuestIssue(null)}
                                />
                            ) : null}
                            {linkedPr && !isVSCode ? (
                                <LinkedReferenceRow
                                    numberLabel={t('chat.chatInput.linked.pr.number', { number: linkedPr.number })}
                                    title={linkedPr.title}
                                    url={linkedPr.url}
                                    author={linkedPr.author}
                                    branches={linkedPr.head && linkedPr.base ? { head: linkedPr.head, base: linkedPr.base } : undefined}
                                    openInBrowserLabel={t('chat.chatInput.linked.pr.openInBrowserAria')}
                                    removeLabel={t('chat.chatInput.linked.pr.removeAria')}
                                    onReopenPicker={() => setPrPickerOpen(true)}
                                    onRemove={() => setLinkedPr(null)}
                                />
                            ) : null}
                            {linkedLinearIssue && !isVSCode ? (
                                <LinkedReferenceRow
                                    numberLabel={linkedLinearIssue.identifier}
                                    title={linkedLinearIssue.title}
                                    url={linkedLinearIssue.url}
                                    author={linkedLinearIssue.author}
                                    openInBrowserLabel={t('chat.chatInput.linked.linearIssue.openInBrowserAria')}
                                    removeLabel={t('chat.chatInput.linked.linearIssue.removeAria')}
                                    onReopenPicker={() => setLinearPickerOpen(true)}
                                    onRemove={() => setLinkedLinearIssue(null)}
                                />
                            ) : null}
                            <AttachedVSCodeFileChips />
                            <ActiveEditorFileSuggestion />
                        </div>
                        <div
                            data-chat-input="true"
                            className={cn("relative overflow-hidden", isDesktopExpanded && 'flex flex-1 min-h-0 flex-col')}
                            onDragEnter={handleDragEnter}
                            onDragOver={handleDragOver}
                            onDropCapture={handleDropCapture}
                            onDrop={handleDrop}
                            onDragEnd={handleDragEnd}
                        >
                            <ComposerEditor
                                ref={composerRef}
                                viewStore={composerViewStore}
                                data-testid="chat-input"
                                value={message}
                                languageContext={languageContext}
                                onChange={handleComposerChange}
                                onKeyDown={(event) => {
                                    handleKeyDown(event);
                                    return event.defaultPrevented;
                                }}
                                onPaste={handlePaste}
                                onSelectionChange={(selection) => {
                                    cursorPosRef.current = selection.start;
                                    updateAutocompleteOverlayPosition();
                                }}
                                placeholder={currentSessionId || newSessionDraftOpen
                                    ? isBtwActive
                                        ? t('chat.btw.inputPlaceholder')
                                        : inputMode === 'shell'
                                        ? t('chat.chatInput.placeholder.shell')
                                        : t(useCompactChatPlaceholder ? 'chat.chatInput.placeholder.chatCompact' : 'chat.chatInput.placeholder.chat')
                                    : t('chat.chatInput.placeholder.selectSession')}
                                editable={Boolean(currentSessionId || newSessionDraftOpen)}
                                autoCorrect={isMobile}
                                autoCapitalize={isMobile ? "sentences" : "none"}
                                spellCheck={isMobile || inputSpellcheckEnabled}
                                fillContainer={isDesktopExpanded}
                                maxLines={isMobile ? MAX_MOBILE_COMPOSER_LINES : MAX_VISIBLE_COMPOSER_LINES}
                                className={cn(
                                    'min-h-[52px] px-3 relative z-10',
                                    isDesktopExpanded
                                        ? 'h-full min-h-0 py-4'
                                        : isMobile
                                            ? 'py-2.5'
                                            : 'pt-4 pb-2',
                                    inputMode === 'shell' ? 'font-mono' : 'typography-markdown md:typography-ui-label',
                                )}
                            />
                        </div>
                    </div>
                    {unsyncedSkillError ? (
                        <div
                            role="alert"
                            className="typography-meta mx-3 mb-1 break-words rounded-xl border p-2"
                            style={{
                                backgroundColor: 'var(--status-error-background)',
                                color: 'var(--status-error)',
                                borderColor: 'var(--status-error-border)',
                            }}
                        >
                            {unsyncedSkillError}
                        </div>
                    ) : null}
                    {composerError ? (
                        <div
                            role="alert"
                            className="typography-meta mx-3 mb-1 break-words rounded-xl border p-2"
                            style={{
                                backgroundColor: 'var(--status-error-background)',
                                color: 'var(--status-error)',
                                borderColor: 'var(--status-error-border)',
                            }}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold">{composerError.name}</div>
                                    <div className="mt-0.5 whitespace-pre-wrap break-all opacity-90">{composerError.message}</div>
                                </div>
                                <div className="flex flex-shrink-0 items-center gap-1">
                                    <button
                                        type="button"
                                        className="rounded px-1.5 py-0.5 text-xs opacity-70 hover:opacity-100"
                                        onClick={() => {
                                            const text = `${composerError.name}: ${composerError.message}`;
                                            void copyTextToClipboard(text).then((result) => {
                                                if (!result.ok) console.error('Failed to copy composer error:', result.error);
                                            });
                                        }}
                                    >
                                        Copy
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded px-1.5 py-0.5 text-xs opacity-70 hover:opacity-100"
                                        onClick={() => setComposerError(null)}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : null}
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
                                    <div className="composer-mobile-actions flex items-center gap-x-2 pl-1">
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
                                            openLinearPicker={linearAvailable ? openLinearPicker : undefined}
                                            attachGuests={isMobile ? [] : guestAttachItems}
                                            onOpenGuestAttach={openGuestAttach}
                                            onOpenSettings={onOpenSettings}
                                        />
                                        <PermissionAutoAcceptButton
                                            footerIconButtonClass={footerIconButtonClass}
                                            iconSizeClass={iconSizeClass}
                                            isInteractive={isPermissionAutoAcceptInteractive}
                                            permissionAutoAcceptEnabled={permissionAutoAcceptEnabled}
                                            handlePermissionAutoAcceptToggle={handlePermissionAutoAcceptToggle}
                                        />
                                        <SessionGoalButton
                                            sessionId={currentSessionId}
                                            directory={currentSessionDirectoryForSync ?? currentDirectory}
                                            draftOpen={newSessionDraftOpen}
                                            serverIdHint={selectedDraftProject?.serverId}
                                            footerIconButtonClass={footerIconButtonClass}
                                            iconSizeClass={iconSizeClass}
                                        />
                                        <SessionGoalObjectiveCounter length={message.length} />
                                    </div>
                                    <div className="flex items-center min-w-0 gap-x-1 justify-end">
                                        <div className="flex items-center gap-x-2 min-w-0 max-w-[60vw] flex-shrink">
                                            <MemoMobileModelButton onOpenModel={() => handleOpenMobilePanel('model')} className="min-w-0 flex-shrink" />
                                            <MemoMobileAgentButton
                                                onOpenAgentPanel={handleOpenAgentPanel}
                                                onCycleAgent={handleCycleAgent}
                                                className="min-w-0 flex-shrink"
                                            />
                                        </div>
                                        <div className="flex items-center gap-x-1 flex-shrink-0">
                                            {voiceModeEnabled ? (
                                                <button
                                                    type="button"
                                                    className={cn(footerIconButtonClass, 'rounded-md')}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onPointerDownCapture={(event) => {
                                                        if (event.pointerType === 'touch') {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                        }
                                                    }}
                                                    onClick={handleOpenDictation}
                                                    disabled={!voice.isSupported}
                                                    aria-label={t('voice.dictation.title')}
                                                    title={t('voice.dictation.title')}
                                                >
                                                    <Icon
                                                        name={voice.isSupported ? 'mic' : 'mic-off'}
                                                        className={cn(iconSizeClass, !voice.isSupported && 'opacity-50')}
                                                    />
                                                </button>
                                            ) : null}
                                            <ComposerActionButtons
                                                isMobile={isMobile}
                                                footerIconButtonClass={footerIconButtonClass}
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
                                                onAbort={handleAbort}
                                                followUpBehavior={followUpBehavior}
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
                                        openLinearPicker={linearAvailable ? openLinearPicker : undefined}
                                        attachGuests={isMobile ? [] : guestAttachItems}
                                        onOpenGuestAttach={openGuestAttach}
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
                                        isInteractive={isPermissionAutoAcceptInteractive}
                                        permissionAutoAcceptEnabled={permissionAutoAcceptEnabled}
                                        handlePermissionAutoAcceptToggle={handlePermissionAutoAcceptToggle}
                                        withTooltip
                                    />
                                    <SessionGoalButton
                                        sessionId={currentSessionId}
                                        directory={currentSessionDirectoryForSync ?? currentDirectory}
                                        draftOpen={newSessionDraftOpen}
                                        serverIdHint={selectedDraftProject?.serverId}
                                        footerIconButtonClass={footerIconButtonClass}
                                        iconSizeClass={iconSizeClass}
                                        withTooltip
                                    />
                                    <SessionGoalObjectiveCounter length={message.length} />
                                </div>
                                <div className={cn('flex items-center flex-1 justify-end', footerGapClass, 'md:gap-x-3')}>
                                    {shouldShowComposerContextUsage ? (
                                        <ContextUsageDisplay
                                            totalTokens={stableComposerContextUsage.totalTokens}
                                            percentage={composerContextUsagePercentage}
                                            colorPercentage={stableComposerContextUsage.percentage}
                                            contextLimit={stableComposerContextUsage.contextLimit}
                                            outputLimit={stableComposerContextUsage.outputLimit ?? 0}
                                            size="compact"
                                            hideIcon
                                            showPercentIcon
                                            onClick={handleOpenComposerContextPanel}
                                            pressed={isComposerContextPanelActive}
                                            className="shrink-0"
                                            valueClassName="typography-ui-label font-medium leading-none text-foreground"
                                            percentIconClassName="h-4.5 w-4.5"
                                        />
                                    ) : null}
                                    <MemoModelControls className={cn('flex-1 min-w-0 justify-end')} />
                                    <MemoBrowserVoiceButton voice={voice} />
                                    <ComposerActionButtons
                                        isMobile={isMobile}
                                        footerIconButtonClass={footerIconButtonClass}
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
                                                onAbort={handleAbort}
                                                followUpBehavior={followUpBehavior}
                                            />
                                </div>
                            </>
                        )}
                    </div>

                    {/* order-first inside the composer column — compact header by default */}
                    {isMobile && <MobileSessionStatusBar />}
                    </div>
                </div>
            </div>
            {/* Floating panels share one absolute `bottom-full` dock above the
                composer form, outside the editor and the collapsed mobile pill.
                Visibility priority: btw, then a nonempty queue, then suggestion;
                hiding the queue does not pause its delivery. */}
            <SessionSuggestionChip
                sessionId={currentSessionId}
                directory={currentSessionDirectoryForSync}
                hidden={hasContent || newSessionDraftOpen || isBtwActive || isBtwPanelVisible || hasQueuedMessages}
                onApply={applyAssistSuggestion}
            />
            <QueuedMessageChips
                hidden={newSessionDraftOpen || isBtwActive || isBtwPanelVisible}
                onEditMessage={handleQueuedMessageEdit}
                onSendMessage={handleQueuedMessageSend}
            />
            {currentSessionId ? <BtwPanel parentSessionId={currentSessionId} panel={btwPanel} /> : null}
        </form>

        {/* Issue Picker Dialog */}
        {isMobile ? (
            <ComposerDictation
                open={showDictation}
                voice={voice}
                composerMessage={message}
                onClose={handleCloseDictation}
                onCommit={handleCloseDictation}
            />
        ) : null}
        <GitHubIssuePickerDialog
            open={issuePickerOpen}
            onOpenChange={setIssuePickerOpen}
            mode="select"
            onSelect={(issue) => {
                setLinkedIssue(issue);
                setLinkedPr(null);
                setLinkedGuestIssue(null);
            }}
        />
        <GitHubPrPickerDialog
            open={prPickerOpen}
            onOpenChange={setPrPickerOpen}
            onSelect={(pr) => {
                setLinkedPr(pr);
                setLinkedIssue(null);
                setLinkedGuestIssue(null);
            }}
        />
        {attachDialogGuestId && !isMobile ? (
            <React.Suspense fallback={null}>
                <GuestAttachDialog
                    guestId={attachDialogGuestId}
                    item={attachDialogItem}
                    onOpenChange={(open) => {
                        if (!open) {
                            setAttachDialogGuestId(null);
                            setAttachDialogItem(null);
                        }
                    }}
                />
            </React.Suspense>
        ) : null}
        <LinearIssuePickerDialog
            open={linearPickerOpen}
            onOpenChange={setLinearPickerOpen}
            mode="select"
            onSelect={(issue) => {
                setLinkedLinearIssue(issue);
                setLinkedIssue(null);
                setLinkedGuestIssue(null);
                setLinkedPr(null);
            }}
        />
        </>
    );
};

ChatInputComponent.displayName = 'ChatInput';

export const ChatInput = React.memo(ChatInputComponent);

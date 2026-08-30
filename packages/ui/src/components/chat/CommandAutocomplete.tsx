import React from 'react';
import { cn } from '@/lib/utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionMessages } from '@/sync/sync-context';
import { selectCommandsForDirectory, useCommandsStore } from '@/stores/useCommandsStore';
import { selectSkillsForTarget, useSkillsStore } from '@/stores/useSkillsStore';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { resolveSessionGoalServerId } from '@/lib/sessionGoalLocal';
import { useSessionGoalServerSupport } from '@/hooks/useSessionGoalServerSupport';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { CommandAutocompleteRow } from './CommandAutocompleteRow';
import {
  buildCommandAutocompleteEntries,
  buildFallbackCommandAutocompleteEntries,
  type CommandAutocompleteDescriptions,
} from './commandAutocompleteCommands';
import type { AutocompleteTab, CommandAutocompleteHandle, CommandInfo } from './commandAutocompleteTypes';
import { useChatSearchDirectory } from '@/hooks/useChatSearchDirectory';
import { useActiveServerBaseUrl, useActiveServerId } from '@/hooks/useActiveServerId';

export type { AutocompleteTab, CommandAutocompleteHandle, CommandInfo } from './commandAutocompleteTypes';

interface CommandAutocompleteProps {
  searchQuery: string;
  onCommandSelect: (command: CommandInfo, options?: { dismissKeyboard?: boolean }) => void;
  onClose: () => void;
  showTabs?: boolean;
  activeTab?: AutocompleteTab;
  onTabSelect?: (tab: AutocompleteTab) => void;
  style?: React.CSSProperties;
}

export const CommandAutocomplete = React.forwardRef<CommandAutocompleteHandle, CommandAutocompleteProps>(({
  searchQuery,
  onCommandSelect,
  onClose,
  showTabs,
  activeTab = 'commands',
  onTabSelect,
  style,
}, ref) => {
  const { t } = useI18n();
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const sessionMessages = useSessionMessages(currentSessionId ?? '');
  const hasMessagesInCurrentSession = sessionMessages.length > 0;
  const hasSession = Boolean(currentSessionId);
  const hasNewSessionDraft = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const canStartSessionCommand = hasSession || hasNewSessionDraft;
  const isMobile = useUIStore((state) => state.isMobile);
  const canUseReviewHandoffFlow = hasSession && !isMobile && !isVSCodeRuntime();
  const draftProjectId = useSessionUIStore((state) => state.newSessionDraft?.selectedProjectId ?? null);
  const draftProjectServerId = useProjectsStore((state) => {
    if (!draftProjectId) return undefined;
    return state.projects.find((project) => project.id === draftProjectId)?.serverId;
  });
  const craftGoalServerId = hasSession
    ? resolveSessionGoalServerId(currentSessionId)
    : (draftProjectServerId ?? null);
  const craftGoalSupport = useSessionGoalServerSupport(craftGoalServerId);
  const canUseCraftGoal = canStartSessionCommand
    && !isVSCodeRuntime()
    && craftGoalSupport.supported;
  const canUseScheduleTask = canStartSessionCommand && !isVSCodeRuntime();

  const [commands, setCommands] = React.useState<CommandInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const effectiveDirectory = useChatSearchDirectory();
  const serverId = useActiveServerId();
  const serverBaseUrl = useActiveServerBaseUrl();
  const commandsWithMetadata = useCommandsStore((s) => selectCommandsForDirectory(s, effectiveDirectory ?? null, serverId));
  const loadCommands = useCommandsStore((s) => s.loadCommands);
  const skills = useSkillsStore((s) => selectSkillsForTarget(s, effectiveDirectory ?? null, serverBaseUrl));
  const loadSkills = useSkillsStore((s) => s.loadSkills);
  const refreshCommands = React.useCallback(
    () => loadCommands(effectiveDirectory ?? null, serverBaseUrl, serverId),
    [effectiveDirectory, loadCommands, serverBaseUrl, serverId],
  );
  const refreshSkills = React.useCallback(
    () => loadSkills(serverBaseUrl, effectiveDirectory ?? null),
    [effectiveDirectory, loadSkills, serverBaseUrl],
  );
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const selectedIndexRef = React.useRef(0);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const ignoreTabClickRef = React.useRef(false);
  const commandDescriptions = React.useMemo<CommandAutocompleteDescriptions>(() => ({
    init: t('chat.commandAutocomplete.command.initDescription'),
    undo: t('chat.commandAutocomplete.command.undoDescription'),
    redo: t('chat.commandAutocomplete.command.redoDescription'),
    timeline: t('chat.commandAutocomplete.command.timelineDescription'),
    compact: t('chat.commandAutocomplete.command.compactDescription'),
    btw: t('chat.commandAutocomplete.command.btwDescription'),
    summary: t('chat.commandAutocomplete.command.summaryDescription'),
    workspaceReview: t('chat.commandAutocomplete.command.workspaceReviewDescription'),
    handoffReview: t('chat.commandAutocomplete.command.handoffReviewDescription'),
    featurePlan: t('chat.commandAutocomplete.command.featurePlanDescription'),
    craftGoal: t('chat.commandAutocomplete.command.craftGoalDescription'),
    scheduleTask: t('chat.commandAutocomplete.command.scheduleTaskDescription'),
    catchUp: t('chat.commandAutocomplete.command.catchUpDescription'),
    debug: t('chat.commandAutocomplete.command.debugDescription'),
    weigh: t('chat.commandAutocomplete.command.weighDescription'),
    explore: t('chat.commandAutocomplete.command.exploreDescription'),
  }), [t]);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !containerRef.current) {
        return;
      }
      if (containerRef.current.contains(target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  React.useEffect(() => {
    // Force refresh to get latest project context when mounting
    void refreshCommands();
    void refreshSkills();
  }, [refreshCommands, refreshSkills]);

  React.useEffect(() => {
    const loadCommands = async () => {
      setLoading(true);
      try {
        setCommands(buildCommandAutocompleteEntries({
          commandsWithMetadata,
          skills,
          searchQuery,
          hasSession,
          hasMessagesInCurrentSession,
          canStartSessionCommand,
          canUseReviewHandoffFlow,
          canUseCraftGoal,
          canUseScheduleTask,
          descriptions: commandDescriptions,
        }));
      } catch {
        setCommands(buildFallbackCommandAutocompleteEntries({
          searchQuery,
          hasSession,
          hasMessagesInCurrentSession,
          canStartSessionCommand,
          canUseReviewHandoffFlow,
          canUseCraftGoal,
          canUseScheduleTask,
          descriptions: commandDescriptions,
        }));
      } finally {
        setLoading(false);
      }
    };

    loadCommands();
  }, [searchQuery, hasMessagesInCurrentSession, hasSession, canStartSessionCommand, canUseReviewHandoffFlow, canUseCraftGoal, canUseScheduleTask, commandsWithMetadata, skills, commandDescriptions]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [commands]);

  React.useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  React.useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: 'nearest'
    });
  }, [selectedIndex]);

  React.useImperativeHandle(ref, () => ({
    handleKeyDown: (key: string) => {
      const total = commands.length;
      if (key === 'Escape') {
        onClose();
        return;
      }

      if (total === 0) {
        return;
      }

      if (key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % total);
        return;
      }

      if (key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev - 1 + total) % total);
        return;
      }

      if (key === 'Enter' || key === 'Tab') {
        const safeIndex = ((selectedIndexRef.current % total) + total) % total;
        const command = commands[safeIndex];
        if (command) {
          onCommandSelect(command);
        }
      }
    }
  }), [commands, onClose, onCommandSelect]);

  const setCommandItemRef = React.useCallback((index: number, element: HTMLDivElement | null) => {
    itemRefs.current[index] = element;
  }, []);
  const handleCommandMouseSelect = React.useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);
  const commandRowLabels = React.useMemo(() => ({
    skill: t('chat.commandAutocomplete.badge.skill'),
    command: t('chat.commandAutocomplete.badge.command'),
    system: t('chat.commandAutocomplete.badge.system'),
  }), [t]);
  const isDenseCommandList = commands.length >= 8 && commands.some((command) => command.isSkill);

  return (
    <div
      ref={containerRef}
      className="absolute z-[100] min-w-0 w-full max-w-none max-h-[min(420px,calc(100dvh-12rem))] bg-background border-2 border-border/60 rounded-xl shadow-none bottom-full mb-2 left-0 flex flex-col"
      style={style}
    >
      {showTabs ? (
        <div className="px-2 pt-2 pb-1 border-b border-border/60">
          <div className="flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)] p-1">
            {([
              { id: 'commands' as const, label: t('chat.autocomplete.tabs.commands') },
              { id: 'agents' as const, label: t('chat.autocomplete.tabs.agents') },
              { id: 'files' as const, label: t('chat.autocomplete.tabs.files') },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  'flex-1 px-2.5 py-1 rounded-md typography-meta font-semibold transition-none',
                  activeTab === tab.id
                    ? 'bg-interactive-selection text-interactive-selection-foreground shadow-none'
                    : 'text-muted-foreground hover:bg-interactive-hover/50'
                )}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'touch') {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  ignoreTabClickRef.current = true;
                  onTabSelect?.(tab.id);
                }}
                onClick={() => {
                  if (ignoreTabClickRef.current) {
                    ignoreTabClickRef.current = false;
                    return;
                  }
                  onTabSelect?.(tab.id);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <ScrollableOverlay outerClassName="flex-1 min-h-0" className={cn('px-0', isDenseCommandList ? 'pb-1' : 'pb-2')}>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Icon name="refresh" className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div>
            {commands.map((command, index) => (
              <CommandAutocompleteRow
                key={command.id}
                command={command}
                index={index}
                isSelected={index === selectedIndex}
                isDense={isDenseCommandList}
                searchQuery={searchQuery}
                labels={commandRowLabels}
                itemRef={(element) => setCommandItemRef(index, element)}
                onCommandSelect={onCommandSelect}
                onMouseSelect={handleCommandMouseSelect}
              />
            ))}
            {commands.length === 0 && (
              <div className="px-3 py-2 typography-ui-label text-muted-foreground">
                {t('chat.commandAutocomplete.empty')}
              </div>
            )}
          </div>
        )}
      </ScrollableOverlay>
      <div className="px-3 pt-1 pb-1.5 border-t typography-meta text-muted-foreground">
        {t('chat.autocomplete.keyboardHint')}
      </div>
    </div>
  );
});

CommandAutocomplete.displayName = 'CommandAutocomplete';

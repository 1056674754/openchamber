import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSelectionStore } from '@/sync/selection-store';
import * as sessionActions from '@/sync/session-actions';
import { useUIStore } from '@/stores/useUIStore';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useAssistantStatus } from '@/hooks/useAssistantStatus';
import { createWorktreeSession } from '@/lib/worktreeSessionCreator';
import { useConfigStore } from '@/stores/useConfigStore';
import { canUseElectronDesktopIPC, invokeDesktop, isVSCodeRuntime } from '@/lib/desktop';
import { showOpenCodeStatus } from '@/lib/openCodeStatus';
import { eventMatchesShortcut, getEffectiveShortcutCombo, normalizeCombo } from '@/lib/shortcuts';
import { ShortcutDispatcher } from '@/lib/shortcuts-registry/dispatcher';
import { ShortcutRegistry as LeaderRegistry } from '@/lib/shortcuts-registry/registry';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { closeSessionTabAndActivateNeighbour } from '@/lib/sessionTabs';
import { getCycledPrimaryAgentName } from '@/components/chat/mobileControlsUtils';
import { focusChatInput } from '@/components/chat/composer/editor/dom';
import { addSelectionToChat } from '@/lib/addSelectionToChat';

export const useKeyboardShortcuts = () => {
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft);
  const armAbortPrompt = useSessionUIStore((s) => s.armAbortPrompt);
  const clearAbortPrompt = useSessionUIStore((s) => s.clearAbortPrompt);
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const abortCurrentOperation = sessionActions.abortCurrentOperation;;
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const toggleHelpDialog = useUIStore((s) => s.toggleHelpDialog);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openContextTerminal = useUIStore((s) => s.openContextTerminal);
  const effectiveDirectory = useEffectiveDirectory() ?? '';
  const isMobile = useUIStore((s) => s.isMobile);
  const setSessionSwitcherOpen = useUIStore((s) => s.setSessionSwitcherOpen);
  const setActiveMainTab = useUIStore((s) => s.setActiveMainTab);
  const setSettingsDialogOpen = useUIStore((s) => s.setSettingsDialogOpen);
  const setModelSelectorOpen = useUIStore((s) => s.setModelSelectorOpen);
  const setTimelineDialogOpen = useUIStore((s) => s.setTimelineDialogOpen);
  const togglePromptNavigatorPanel = useUIStore((s) => s.togglePromptNavigatorPanel);
  const toggleExpandedInput = useUIStore((s) => s.toggleExpandedInput);
  const shortcutOverrides = useUIStore((s) => s.shortcutOverrides);
  const sessionTabsEnabled = useUIStore((s) => s.sessionTabsEnabled);
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory);
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const { themeMode, setThemeMode } = useThemeSystem();
  const { working } = useAssistantStatus();
  const abortPrimedUntilRef = React.useRef<number | null>(null);
  const abortPrimedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeModeRef = React.useRef(themeMode);

  React.useEffect(() => {
    themeModeRef.current = themeMode;
  }, [themeMode]);

  // mod+k leader registry (upstream shortcuts-registry): "open/go" sequences
  // for actions the fork exposes. Registered once; the dispatcher owns the
  // two-chord sequence state machine (arm on mod+k, complete or expire).
  const leaderHandlersInitializedRef = React.useRef(false);
  const leaderHandlerRef = React.useRef<Record<string, () => void>>({});
  if (!leaderHandlersInitializedRef.current) {
    leaderHandlersInitializedRef.current = true;
    leaderHandlerRef.current = {
      t: () => setTimelineDialogOpen(true),
      p: () => toggleCommandPalette(),
      g: () => setActiveMainTab('git'),
      n: () => setActiveMainTab('chat'),
    };
  }
  const leaderHandler = leaderHandlerRef.current;

  const dispatcherRef = React.useRef<ShortcutDispatcher | null>(null);
  if (!dispatcherRef.current) {
    const registry = new LeaderRegistry();
    registry.register('open_timeline_dialog', () => { leaderHandler.t?.(); });
    registry.register('open_draft_project_picker', () => { leaderHandler.p?.(); });
    registry.register('open_draft_worktree_picker', () => { leaderHandler.g?.(); });
    registry.register('new_chat', () => { leaderHandler.n?.(); });
    dispatcherRef.current = new ShortcutDispatcher({
      registry,
      // Fork bindings for the leader actions (mod+k + mnemonic).
      getBinding: (actionId) => {
        const bindings: Record<string, string> = {
          open_timeline_dialog: 'mod+k t',
          open_draft_project_picker: 'mod+k p',
          open_draft_worktree_picker: 'mod+k g',
          new_chat: 'mod+k n',
        };
        return bindings[actionId] ?? '';
      },
    });
  }
  const leaderDispatcher = dispatcherRef.current;

  const resetAbortPriming = React.useCallback(() => {
    if (abortPrimedTimeoutRef.current) {
      clearTimeout(abortPrimedTimeoutRef.current);
      abortPrimedTimeoutRef.current = null;
    }
    abortPrimedUntilRef.current = null;
    clearAbortPrompt();
  }, [clearAbortPrompt]);

  React.useEffect(() => {
    const combo = (actionId: string) => getEffectiveShortcutCombo(actionId, shortcutOverrides);
    const isTerminalEventTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return false;
      }

      return Boolean(
        target.closest('.terminal-viewport-container') ||
        target.getAttribute('data-terminal-hidden-input') === 'true'
      );
    };
    const handleTerminalShortcutCapture = (e: KeyboardEvent) => {
      if (!isTerminalEventTarget(e.target)) {
        return;
      }

      if (eventMatchesShortcut(e, combo('toggle_terminal'))) {
        const { isMobile } = useUIStore.getState();
        if (isMobile) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        openContextTerminal(effectiveDirectory);
        return;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTerminalEventTarget(e.target)) {
        return;
      }

      // mod+k leader sequences first: an armed leader consumes the next
      // chord even when it would also match a single-chord binding below.
      if (leaderDispatcher.dispatch(e)) {
        e.preventDefault();
        return;
      }

      if (eventMatchesShortcut(e, combo('close_session_tab'))) {
        if (sessionTabsEnabled && currentSessionId) {
          e.preventDefault();
          closeSessionTabAndActivateNeighbour(currentSessionId);
        }
        return;
      }

      if (eventMatchesShortcut(e, combo('open_command_palette'))) {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      if (eventMatchesShortcut(e, combo('open_timeline_dialog'))) {
        e.preventDefault();
        setTimelineDialogOpen(true);
        return;
      }

      if (eventMatchesShortcut(e, combo('toggle_prompt_navigator'))) {
        const {
          activeMainTab,
          isAboutDialogOpen,
          isCommandPaletteOpen,
          isHelpDialogOpen,
          isImagePreviewOpen,
          isMobile: isMobileViewport,
          isMultiRunLauncherOpen,
          isSessionSwitcherOpen,
          isSettingsDialogOpen,
          promptNavigatorEnabled,
        } = useUIStore.getState();
        const hasOverlay = isAboutDialogOpen
          || isCommandPaletteOpen
          || isHelpDialogOpen
          || isImagePreviewOpen
          || isMultiRunLauncherOpen
          || isSessionSwitcherOpen
          || isSettingsDialogOpen;
        if (!isMobileViewport && promptNavigatorEnabled && activeMainTab === 'chat' && currentSessionId && !hasOverlay) {
          e.preventDefault();
          togglePromptNavigatorPanel();
        }
        return;
      }

      if (eventMatchesShortcut(e, combo('open_status'))) {
        e.preventDefault();
        void showOpenCodeStatus();
        return;
      }

      if (eventMatchesShortcut(e, combo('open_help'))) {
        e.preventDefault();
        toggleHelpDialog();
        return;
      }

      if (canUseElectronDesktopIPC() && eventMatchesShortcut(e, combo('new_mini_chat'))) {
        e.preventDefault();
        void invokeDesktop('desktop_open_draft_mini_chat_window', {
          directory: currentDirectory || activeProject?.path || '',
          projectId: activeProject?.id ?? null,
        }).catch((error) => {
          console.warn('[keyboard-shortcuts] failed to open draft mini chat window', error);
        });
        return;
      }

      const matchedNewSessionShortcut = eventMatchesShortcut(e, combo('new_chat'));
      const matchedWorktreeShortcut = eventMatchesShortcut(e, combo('new_chat_worktree'));

      if (matchedNewSessionShortcut || matchedWorktreeShortcut) {
        e.preventDefault();

        setActiveMainTab('chat');
        setSessionSwitcherOpen(false);

        if (!isVSCodeRuntime() && matchedWorktreeShortcut) {
          createWorktreeSession();
          return;
        }

        openNewSessionDraft();
        return;
      }

      const isChatInputTarget = (target: EventTarget | null) => {
        return target instanceof Element && Boolean(target.closest('[data-chat-input="true"]'));
      };

      const cycleAgentCombo = combo('cycle_agent');
      const cycleAgentBackwardCombo = cycleAgentCombo && !cycleAgentCombo.includes('shift')
        ? normalizeCombo(`shift+${cycleAgentCombo}`)
        : '';
      const cycleAgentDirection = cycleAgentBackwardCombo && eventMatchesShortcut(e, cycleAgentBackwardCombo)
        ? -1
        : eventMatchesShortcut(e, cycleAgentCombo)
          ? 1
          : 0;

      if (cycleAgentDirection !== 0) {
        const {
          isSettingsDialogOpen,
          isCommandPaletteOpen,
          isHelpDialogOpen,
          isSessionSwitcherOpen,
          isAboutDialogOpen,
          activeMainTab,
        } = useUIStore.getState();

        const hasOverlay = isSettingsDialogOpen || isCommandPaletteOpen || isHelpDialogOpen || isSessionSwitcherOpen || isAboutDialogOpen;
        if (hasOverlay || activeMainTab !== 'chat' || !isChatInputTarget(e.target)) {
          return;
        }

        const configState = useConfigStore.getState();
        const nextAgentName = getCycledPrimaryAgentName(
          configState.getVisibleAgents(),
          configState.currentAgentName,
          cycleAgentDirection,
        );

        if (!nextAgentName) {
          return;
        }

        e.preventDefault();
        configState.setAgent(nextAgentName);
        useUIStore.getState().addRecentAgent(nextAgentName);

        const sessionId = useSessionUIStore.getState().currentSessionId;
        if (sessionId) {
          useSelectionStore.getState().saveSessionAgentSelection(sessionId, nextAgentName);
        }
        return;
      }

      if (eventMatchesShortcut(e, combo('cycle_theme'))) {
        e.preventDefault();
        const modes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
        const activeElement = document.activeElement as HTMLElement | null;
        const currentIndex = modes.indexOf(themeModeRef.current);
        const nextIndex = (currentIndex + 1) % modes.length;
        setThemeMode(modes[nextIndex]);
        requestAnimationFrame(() => {
          if (typeof document === 'undefined' || typeof window === 'undefined') {
            return;
          }
          if (!document.hasFocus()) {
            window.focus();
          }
          if (activeElement && document.contains(activeElement)) {
            activeElement.focus({ preventScroll: true });
          }
        });
        return;
      }

      if (eventMatchesShortcut(e, combo('open_settings'))) {
        e.preventDefault();
        const { isSettingsDialogOpen } = useUIStore.getState();
        setSettingsDialogOpen(!isSettingsDialogOpen);
        return;
      }

      if (eventMatchesShortcut(e, combo('add_selection_to_chat'))) {
        e.preventDefault();
        addSelectionToChat();
        return;
      }

      if (eventMatchesShortcut(e, combo('toggle_sidebar'))) {
        e.preventDefault();
        const { isMobile, isSessionSwitcherOpen } = useUIStore.getState();
        if (isMobile) {
          setSessionSwitcherOpen(!isSessionSwitcherOpen);
        } else {
          toggleSidebar();
        }
        return;
      }

      if (eventMatchesShortcut(e, combo('focus_input'))) {
        e.preventDefault();
        focusChatInput();
        return;
      }

      if (eventMatchesShortcut(e, combo('toggle_terminal'))) {
        const { isMobile } = useUIStore.getState();
        if (isMobile) {
          return;
        }
        e.preventDefault();
        openContextTerminal(effectiveDirectory);
        return;
      }

      // Cmd/Ctrl+Shift+M: Open model selector (same conditions as double-ESC: chat tab, no overlays)
      if (eventMatchesShortcut(e, combo('open_model_selector'))) {
        const {
          isSettingsDialogOpen,
          isCommandPaletteOpen,
          isHelpDialogOpen,
          isSessionSwitcherOpen,
          isAboutDialogOpen,
          activeMainTab,
          isModelSelectorOpen,
        } = useUIStore.getState();

        // Skip if settings open
        if (isSettingsDialogOpen) {
          return;
        }

        // Skip if any overlay open or not on chat tab
        const hasOverlay = isCommandPaletteOpen || isHelpDialogOpen || isSessionSwitcherOpen || isAboutDialogOpen;
        const isChatActive = activeMainTab === 'chat';

        if (hasOverlay || !isChatActive) {
          return;
        }

        e.preventDefault();
        setModelSelectorOpen(!isModelSelectorOpen);
        return;
      }

      // Cmd/Ctrl+Shift+T: Cycle thinking variant (same gating as Shift+M)
      if (eventMatchesShortcut(e, combo('cycle_thinking_variant'))) {
        const {
          isSettingsDialogOpen,
          isCommandPaletteOpen,
          isHelpDialogOpen,
          isSessionSwitcherOpen,
          isAboutDialogOpen,
          activeMainTab,
        } = useUIStore.getState();

        if (isSettingsDialogOpen) {
          return;
        }

        const hasOverlay = isCommandPaletteOpen || isHelpDialogOpen || isSessionSwitcherOpen || isAboutDialogOpen;
        const isChatActive = activeMainTab === 'chat';

        if (hasOverlay || !isChatActive) {
          return;
        }

        const configState = useConfigStore.getState();
        const variants = configState.getCurrentModelVariants();
        if (variants.length === 0) {
          return;
        }

        e.preventDefault();
        configState.cycleCurrentVariant();

        const nextVariant = useConfigStore.getState().currentVariant;
        const sessionId = useSessionUIStore.getState().currentSessionId;
        const agentName = useConfigStore.getState().currentAgentName;
        const providerId = useConfigStore.getState().currentProviderId;
        const modelId = useConfigStore.getState().currentModelId;

        if (sessionId && agentName && providerId && modelId) {
          useSelectionStore.getState().saveAgentModelVariantForSession(sessionId, agentName, providerId, modelId, nextVariant);
        }

        return;
      }

      // Ctrl+] / Ctrl+[: Cycle through starred models (same gating as Shift+M)
      if (
        eventMatchesShortcut(e, combo('cycle_favorite_model_forward')) ||
        eventMatchesShortcut(e, combo('cycle_favorite_model_backward'))
      ) {
        const {
          isSettingsDialogOpen,
          isCommandPaletteOpen,
          isHelpDialogOpen,
          isSessionSwitcherOpen,
          isAboutDialogOpen,
          activeMainTab,
          favoriteModels,
          addRecentModel,
        } = useUIStore.getState();

        if (isSettingsDialogOpen) {
          return;
        }

        const hasOverlay = isCommandPaletteOpen || isHelpDialogOpen || isSessionSwitcherOpen || isAboutDialogOpen;
        const isChatActive = activeMainTab === 'chat';

        if (hasOverlay || !isChatActive || favoriteModels.length === 0) {
          return;
        }

        e.preventDefault();

        const { currentProviderId, currentModelId, setProvider, setModel } = useConfigStore.getState();
        const len = favoriteModels.length;
        const currentIdx = favoriteModels.findIndex(
          (f) => f.providerID === currentProviderId && f.modelID === currentModelId,
        );
        const delta = eventMatchesShortcut(e, combo('cycle_favorite_model_forward')) ? 1 : -1;
        const next = favoriteModels[(currentIdx + delta + len) % len];

        setProvider(next.providerID);
        setModel(next.modelID);
        addRecentModel(next.providerID, next.modelID);
        return;
      }

      if (eventMatchesShortcut(e, combo('expand_input'))) {
        if (isMobile) {
          return;
        }
        e.preventDefault();
        toggleExpandedInput();
        return;
      }

      if (e.key === 'Escape') {
        const target = e.target as Element | null;
        const isInsideDialog = Boolean(target?.closest('[role="dialog"]'));
        const isSettingsMounted = Boolean(document.querySelector('[data-settings-view="true"]'));
        const isInsideTerminal = Boolean(
          target?.closest('.terminal-viewport-container') ||
          target?.getAttribute('data-terminal-hidden-input') === 'true'
        );

        const {
          isSettingsDialogOpen,
          isCommandPaletteOpen,
          isHelpDialogOpen,
          isSessionSwitcherOpen,
          isAboutDialogOpen,
          isMultiRunLauncherOpen,
          isImagePreviewOpen,
          isPromptNavigatorPanelOpen,
          activeMainTab,
        } = useUIStore.getState();

        if (isInsideDialog || isInsideTerminal) {
          resetAbortPriming();
          return;
        }

        if (isPromptNavigatorPanelOpen) {
          e.preventDefault();
          useUIStore.getState().setPromptNavigatorPanelOpen(false);
          resetAbortPriming();
          return;
        }

        // If settings is open, close it
        if (isSettingsDialogOpen) {
          e.preventDefault();
          setSettingsDialogOpen(false);
          resetAbortPriming();
          return;
        }

        if (isSettingsMounted) {
          resetAbortPriming();
          return;
        }

        // Check if any overlay is open or not on chat tab - don't process abort
        const hasOverlay = isCommandPaletteOpen || isHelpDialogOpen || isSessionSwitcherOpen || isAboutDialogOpen || isMultiRunLauncherOpen || isImagePreviewOpen;
        const isChatActive = activeMainTab === 'chat';

        if (hasOverlay || !isChatActive) {
          resetAbortPriming();
          return;
        }

        // Double-ESC abort logic - only when on chat tab with no overlays
        const sessionId = currentSessionId;
        const canAbortNow = working.canAbort && Boolean(sessionId);
        if (!canAbortNow) {
          resetAbortPriming();
          return;
        }

        const now = Date.now();
        const primedUntil = abortPrimedUntilRef.current;

        if (primedUntil && now < primedUntil) {
          e.preventDefault();
          resetAbortPriming();
          void abortCurrentOperation(sessionId ?? '');
          return;
        }

        e.preventDefault();
        const expiresAt = armAbortPrompt(3000) ?? now + 3000;
        abortPrimedUntilRef.current = expiresAt;

        if (abortPrimedTimeoutRef.current) {
          clearTimeout(abortPrimedTimeoutRef.current);
        }

        const delay = Math.max(expiresAt - now, 0);
        abortPrimedTimeoutRef.current = setTimeout(() => {
          if (abortPrimedUntilRef.current && Date.now() >= abortPrimedUntilRef.current) {
            resetAbortPriming();
          }
        }, delay || 0);
        return;
      }
    };

    window.addEventListener('keydown', handleTerminalShortcutCapture, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleTerminalShortcutCapture, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    openNewSessionDraft,
    abortCurrentOperation,
    toggleCommandPalette,
    toggleHelpDialog,
    toggleSidebar,
    openContextTerminal,
    effectiveDirectory,
    isMobile,
    setSessionSwitcherOpen,
    setActiveMainTab,
    setSettingsDialogOpen,
    setModelSelectorOpen,
    setTimelineDialogOpen,
    togglePromptNavigatorPanel,
    toggleExpandedInput,
    setThemeMode,
    working,
    armAbortPrompt,
    resetAbortPriming,
    currentSessionId,
    currentDirectory,
    activeProject?.id,
    activeProject?.path,
    sessionTabsEnabled, shortcutOverrides,
  ]);

  React.useEffect(() => {
    return () => {
      resetAbortPriming();
    };
  }, [resetAbortPriming]);
};

import React from 'react';
import { toast } from '@/components/ui';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useUIStore } from '@/stores/useUIStore';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { sessionEvents } from '@/lib/sessionEvents';
import { createWorktreeSession } from '@/lib/worktreeSessionCreator';
import { showOpenCodeStatus } from '@/lib/openCodeStatus';
import { canUseElectronDesktopIPC, invokeDesktop, listenDesktopEvent } from '@/lib/desktop';
import { executeCloseAction } from '@/lib/closeTarget';
import { addSelectionToChat } from '@/lib/addSelectionToChat';

const getActiveElementSelectedText = (): string => {
  if (typeof document === 'undefined') {
    return '';
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLTextAreaElement) {
    return activeElement.value.slice(activeElement.selectionStart ?? 0, activeElement.selectionEnd ?? 0);
  }

  if (activeElement instanceof HTMLInputElement) {
    const type = activeElement.type?.toLowerCase() ?? 'text';
    if (['text', 'search', 'url', 'tel', 'password'].includes(type)) {
      return activeElement.value.slice(activeElement.selectionStart ?? 0, activeElement.selectionEnd ?? 0);
    }
  }

  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    return activeElement.ownerDocument.defaultView?.getSelection?.()?.toString() ?? '';
  }

  return '';
};

const copyCurrentSelectionFallback = async (): Promise<boolean> => {
  const selectionText = getActiveElementSelectedText() || window.getSelection()?.toString() || '';
  if (!selectionText.trim()) {
    return false;
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(selectionText);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback when Clipboard API is unavailable.
  }

  return document.execCommand('copy');
};

const MENU_ACTION_EVENT = 'openchamber:menu-action';
const CHECK_FOR_UPDATES_EVENT = 'openchamber:check-for-updates';

type MenuAction =
  | 'about'
  | 'settings'
  | 'command-palette'
  | 'quick-open'
  | 'new-session'
  | 'new-worktree-session'
  | 'change-workspace'
  | 'toggle-terminal'
  | 'toggle-terminal-expanded'
  | 'copy'
  | 'theme-light'
  | 'theme-dark'
  | 'theme-system'
  | 'toggle-sidebar'
  | 'add-selection-to-chat'
  | 'toggle-memory-debug'
  | 'help-dialog'
  | 'download-logs'
  | 'close';

const normalizeMenuDirectory = (value?: string | null): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.replace(/\\/g, '/');
  if (normalized === '/') {
    return '/';
  }

  return normalized.replace(/\/+$/, '') || normalized;
};

const resolveMenuActionDirectory = (): string => {
  const sessionState = useSessionUIStore.getState();
  const currentSessionId = sessionState.currentSessionId;

  if (currentSessionId) {
    return normalizeMenuDirectory(sessionState.getDirectoryForSession(currentSessionId));
  }

  const draft = sessionState.newSessionDraft;
  if (draft?.open) {
    const draftDirectory = normalizeMenuDirectory(draft.bootstrapPendingDirectory || draft.directoryOverride);
    if (draftDirectory) {
      return draftDirectory;
    }

    const projectsState = useProjectsStore.getState();
    const draftProjectId = draft.selectedProjectId || projectsState.activeProjectId;
    const draftProject = draftProjectId
      ? projectsState.projects.find((project) => project.id === draftProjectId)
      : null;
    const draftProjectPath = normalizeMenuDirectory(draftProject?.path);
    if (draftProjectPath) {
      return draftProjectPath;
    }
  }

  return normalizeMenuDirectory(useDirectoryStore.getState().currentDirectory);
};

export const useMenuActions = (
  onToggleMemoryDebug?: () => void
) => {
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const toggleHelpDialog = useUIStore((s) => s.toggleHelpDialog);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setSessionSwitcherOpen = useUIStore((s) => s.setSessionSwitcherOpen);
  const setActiveMainTab = useUIStore((s) => s.setActiveMainTab);
  const setSettingsDialogOpen = useUIStore((s) => s.setSettingsDialogOpen);
  const setAboutDialogOpen = useUIStore((s) => s.setAboutDialogOpen);
  const setHelpDialogOpen = useUIStore((s) => s.setHelpDialogOpen);
  const setImagePreviewOpen = useUIStore((s) => s.setImagePreviewOpen);
  const setModelSelectorOpen = useUIStore((s) => s.setModelSelectorOpen);
  const setMultiRunLauncherOpen = useUIStore((s) => s.setMultiRunLauncherOpen);
  const openContextTerminal = useUIStore((s) => s.openContextTerminal);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const { setThemeMode } = useThemeSystem();
  const checkUpdatesInFlightRef = React.useRef(false);

  const handleCheckForUpdates = React.useCallback(() => {
    if (checkUpdatesInFlightRef.current) {
      return;
    }
    checkUpdatesInFlightRef.current = true;

    void checkForUpdates()
      .then(() => {
        const { available, error } = useUpdateStore.getState();
        if (error) {
          toast.error('Failed to check for updates', {
            description: error,
          });
          return;
        }

        if (!available) {
          toast.success('You are on the latest version');
        }
      })
      .finally(() => {
        checkUpdatesInFlightRef.current = false;
      });
  }, [checkForUpdates]);

  const handleChangeWorkspace = React.useCallback(() => {
    sessionEvents.requestDirectoryDialog();
  }, []);

  const handleAction = React.useCallback(
    (action: MenuAction) => {
      switch (action) {
        case 'about':
          setAboutDialogOpen(true);
          break;

        case 'settings':
          setSettingsDialogOpen(true);
          break;

        case 'command-palette':
          toggleCommandPalette();
          break;

        case 'quick-open':
          setCommandPaletteOpen(true);
          break;

        case 'new-session':
          setActiveMainTab('chat');
          setSessionSwitcherOpen(false);
          openNewSessionDraft();
          break;

        case 'new-worktree-session':
          setActiveMainTab('chat');
          setSessionSwitcherOpen(false);
          createWorktreeSession();
          break;

        case 'change-workspace':
          handleChangeWorkspace();
          break;

        case 'toggle-terminal':
          openContextTerminal(resolveMenuActionDirectory());
          break;

        case 'toggle-terminal-expanded': {
          const { activeMainTab } = useUIStore.getState();
          setActiveMainTab(activeMainTab === 'terminal' ? 'chat' : 'terminal');
          break;
        }

        case 'copy': {
          const copyEvent = new Event('openchamber:copy', { cancelable: true });
          const wasHandled = !window.dispatchEvent(copyEvent);
          if (!wasHandled) {
            void copyCurrentSelectionFallback();
          }
          break;
        }

        case 'theme-light':
          setThemeMode('light');
          break;

        case 'theme-dark':
          setThemeMode('dark');
          break;

        case 'theme-system':
          setThemeMode('system');
          break;

        case 'toggle-sidebar':
          toggleSidebar();
          break;

        case 'add-selection-to-chat':
          addSelectionToChat();
          break;

        case 'toggle-memory-debug':
          onToggleMemoryDebug?.();
          break;

        case 'help-dialog':
          toggleHelpDialog();
          break;

        case 'download-logs': {
          void showOpenCodeStatus().catch(() => {
            toast.error('Failed to collect OpenCode status');
          });
          break;
        }

        case 'close': {
          const uiState = useUIStore.getState();
          executeCloseAction(
            {
              isImagePreviewOpen: uiState.isImagePreviewOpen,
              isCommandPaletteOpen: uiState.isCommandPaletteOpen,
              isModelSelectorOpen: uiState.isModelSelectorOpen,
              isHelpDialogOpen: uiState.isHelpDialogOpen,
              isAboutDialogOpen: uiState.isAboutDialogOpen,
              isMultiRunLauncherOpen: uiState.isMultiRunLauncherOpen,
              isSessionSwitcherOpen: uiState.isSessionSwitcherOpen,
              isSettingsDialogOpen: uiState.isSettingsDialogOpen,
            },
            {
              setSettingsDialogOpen,
              setCommandPaletteOpen,
              setHelpDialogOpen,
              setAboutDialogOpen,
              setModelSelectorOpen,
              setImagePreviewOpen,
              setMultiRunLauncherOpen,
              setSessionSwitcherOpen,
              closeDesktopWindow: () => {
                if (canUseElectronDesktopIPC()) {
                  void invokeDesktop('desktop_close_current_window');
                }
              },
            },
          );
          break;
        }
      }
    },
    [
      handleChangeWorkspace,
      onToggleMemoryDebug,
      openContextTerminal,
      openNewSessionDraft,
      setAboutDialogOpen,
      setActiveMainTab,
      setCommandPaletteOpen,
      setHelpDialogOpen,
      setImagePreviewOpen,
      setModelSelectorOpen,
      setMultiRunLauncherOpen,
      setSessionSwitcherOpen,
      setSettingsDialogOpen,
      setThemeMode,
      toggleCommandPalette,
      toggleHelpDialog,
      toggleSidebar,
    ]
  );

  React.useEffect(() => {
    const handleMenuAction = (event: Event) => {
      const action = (event as CustomEvent<MenuAction>).detail;
      if (!action) return;
      handleAction(action);
    };

    const handleCheckForUpdatesEvent = () => {
      handleCheckForUpdates();
    };

    window.addEventListener(MENU_ACTION_EVENT, handleMenuAction);
    window.addEventListener(CHECK_FOR_UPDATES_EVENT, handleCheckForUpdatesEvent);
    return () => {
      window.removeEventListener(MENU_ACTION_EVENT, handleMenuAction);
      window.removeEventListener(CHECK_FOR_UPDATES_EVENT, handleCheckForUpdatesEvent);
    };
  }, [handleAction, handleCheckForUpdates]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    let unlistenMenu: null | (() => void | Promise<void>) = null;
    let unlistenUpdate: null | (() => void | Promise<void>) = null;

    listenDesktopEvent('openchamber:menu-action', (evt) => {
      const action = evt?.payload;
      if (typeof action !== 'string') return;
      handleAction(action as MenuAction);
    })
      .then((fn) => {
        unlistenMenu = fn;
      })
      .catch(() => {
        // ignore
      });

    listenDesktopEvent('openchamber:check-for-updates', () => {
      window.dispatchEvent(new Event(CHECK_FOR_UPDATES_EVENT));
    })
      .then((fn) => {
        unlistenUpdate = fn;
      })
      .catch(() => {
        // ignore
      });

    return () => {
      const cleanup = async () => {
        try {
          const a = unlistenMenu?.();
          if (a instanceof Promise) await a;
        } catch {
          // ignore
        }
        try {
          const b = unlistenUpdate?.();
          if (b instanceof Promise) await b;
        } catch {
          // ignore
        }
      };
      void cleanup();
    };
  }, [handleAction]);
};

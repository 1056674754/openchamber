/**
 * Determines what surface a "close window" intent (macOS Cmd+W / Windows
 * Ctrl+W) should act on.
 *
 * On macOS the native menu binds Cmd+W to `role: 'close'`, which by default
 * triggers BrowserWindow.close(). The main-process close handler then hides
 * the last visible window, leaving the app with no presented surface even
 * when a Settings dialog (or other in-app overlay) is the actual focus of
 * the user's intent. Routing the shortcut through the renderer first lets us
 * close the topmost overlay instead of hiding the whole window when one is
 * open.
 *
 * When no overlay is open the caller should forward the intent to the
 * desktop shell so it performs the standard close-window behavior.
 */
export type CloseOverlayTarget =
  | 'image-preview'
  | 'command-palette'
  | 'model-selector'
  | 'help'
  | 'about'
  | 'multi-run-launcher'
  | 'session-switcher'
  | 'settings'
  | 'window';

export interface CloseOverlayState {
  isImagePreviewOpen: boolean;
  isCommandPaletteOpen: boolean;
  isModelSelectorOpen: boolean;
  isHelpDialogOpen: boolean;
  isAboutDialogOpen: boolean;
  isMultiRunLauncherOpen: boolean;
  isSessionSwitcherOpen: boolean;
  isSettingsDialogOpen: boolean;
}

const OVERLAY_PRIORITY: ReadonlyArray<{ key: keyof CloseOverlayState; target: CloseOverlayTarget }> = [
  { key: 'isImagePreviewOpen', target: 'image-preview' },
  { key: 'isCommandPaletteOpen', target: 'command-palette' },
  { key: 'isModelSelectorOpen', target: 'model-selector' },
  { key: 'isHelpDialogOpen', target: 'help' },
  { key: 'isAboutDialogOpen', target: 'about' },
  { key: 'isMultiRunLauncherOpen', target: 'multi-run-launcher' },
  { key: 'isSessionSwitcherOpen', target: 'session-switcher' },
  { key: 'isSettingsDialogOpen', target: 'settings' },
];

export const resolveCloseTarget = (state: CloseOverlayState): CloseOverlayTarget => {
  for (const { key, target } of OVERLAY_PRIORITY) {
    if (state[key]) {
      return target;
    }
  }
  return 'window';
};

export interface CloseActionHandlers {
  setSettingsDialogOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setHelpDialogOpen: (open: boolean) => void;
  setAboutDialogOpen: (open: boolean) => void;
  setModelSelectorOpen: (open: boolean) => void;
  setImagePreviewOpen: (open: boolean) => void;
  setMultiRunLauncherOpen: (open: boolean) => void;
  setSessionSwitcherOpen: (open: boolean) => void;
  closeDesktopWindow: () => void;
};

/**
 * Resolves which surface a close-window intent should act on and dispatches
 * the matching close operation. When no overlay is open it delegates to the
 * desktop shell's close-window command.
 */
export const executeCloseAction = (
  state: CloseOverlayState,
  handlers: CloseActionHandlers,
): void => {
  const target = resolveCloseTarget(state);
  switch (target) {
    case 'settings':
      handlers.setSettingsDialogOpen(false);
      break;
    case 'command-palette':
      handlers.setCommandPaletteOpen(false);
      break;
    case 'help':
      handlers.setHelpDialogOpen(false);
      break;
    case 'about':
      handlers.setAboutDialogOpen(false);
      break;
    case 'model-selector':
      handlers.setModelSelectorOpen(false);
      break;
    case 'image-preview':
      handlers.setImagePreviewOpen(false);
      break;
    case 'multi-run-launcher':
      handlers.setMultiRunLauncherOpen(false);
      break;
    case 'session-switcher':
      handlers.setSessionSwitcherOpen(false);
      break;
    case 'window':
      handlers.closeDesktopWindow();
      break;
  }
};

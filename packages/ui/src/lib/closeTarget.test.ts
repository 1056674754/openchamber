import { describe, expect, mock, test } from 'bun:test';

import { executeCloseAction, resolveCloseTarget, type CloseOverlayState } from './closeTarget';

const allClosed: CloseOverlayState = {
  isImagePreviewOpen: false,
  isCommandPaletteOpen: false,
  isModelSelectorOpen: false,
  isHelpDialogOpen: false,
  isAboutDialogOpen: false,
  isMultiRunLauncherOpen: false,
  isSessionSwitcherOpen: false,
  isSettingsDialogOpen: false,
};

describe('resolveCloseTarget', () => {
  test('returns window when no overlay is open', () => {
    expect(resolveCloseTarget(allClosed)).toBe('window');
  });

  test('returns settings instead of window when Settings dialog is open', () => {
    const state: CloseOverlayState = { ...allClosed, isSettingsDialogOpen: true };
    expect(resolveCloseTarget(state)).toBe('settings');
    expect(resolveCloseTarget(state)).not.toBe('window');
  });

  test('returns command-palette when command palette is open', () => {
    const state: CloseOverlayState = { ...allClosed, isCommandPaletteOpen: true };
    expect(resolveCloseTarget(state)).toBe('command-palette');
  });

  test('returns help when help dialog is open', () => {
    const state: CloseOverlayState = { ...allClosed, isHelpDialogOpen: true };
    expect(resolveCloseTarget(state)).toBe('help');
  });

  test('returns about when about dialog is open', () => {
    const state: CloseOverlayState = { ...allClosed, isAboutDialogOpen: true };
    expect(resolveCloseTarget(state)).toBe('about');
  });

  test('returns model-selector when model selector is open', () => {
    const state: CloseOverlayState = { ...allClosed, isModelSelectorOpen: true };
    expect(resolveCloseTarget(state)).toBe('model-selector');
  });

  test('returns image-preview when image preview is open', () => {
    const state: CloseOverlayState = { ...allClosed, isImagePreviewOpen: true };
    expect(resolveCloseTarget(state)).toBe('image-preview');
  });

  test('returns multi-run-launcher when multi-run launcher is open', () => {
    const state: CloseOverlayState = { ...allClosed, isMultiRunLauncherOpen: true };
    expect(resolveCloseTarget(state)).toBe('multi-run-launcher');
  });

  test('returns session-switcher when session switcher is open', () => {
    const state: CloseOverlayState = { ...allClosed, isSessionSwitcherOpen: true };
    expect(resolveCloseTarget(state)).toBe('session-switcher');
  });

  test('prefers higher-priority overlay when multiple are open', () => {
    const state: CloseOverlayState = {
      ...allClosed,
      isSettingsDialogOpen: true,
      isCommandPaletteOpen: true,
    };
    // Command palette renders above settings, so it should close first.
    expect(resolveCloseTarget(state)).toBe('command-palette');
  });

  test('prefers image preview over all others when multiple are open', () => {
    const state: CloseOverlayState = {
      ...allClosed,
      isSettingsDialogOpen: true,
      isCommandPaletteOpen: true,
      isImagePreviewOpen: true,
      isModelSelectorOpen: true,
    };
    expect(resolveCloseTarget(state)).toBe('image-preview');
  });
});

describe('executeCloseAction', () => {
  const createHandlers = () => {
    const calls: string[] = [];
    return {
      calls,
      setSettingsDialogOpen: mock((open: boolean) => { calls.push(`settings:${open}`); }),
      setCommandPaletteOpen: mock((open: boolean) => { calls.push(`command-palette:${open}`); }),
      setHelpDialogOpen: mock((open: boolean) => { calls.push(`help:${open}`); }),
      setAboutDialogOpen: mock((open: boolean) => { calls.push(`about:${open}`); }),
      setModelSelectorOpen: mock((open: boolean) => { calls.push(`model-selector:${open}`); }),
      setImagePreviewOpen: mock((open: boolean) => { calls.push(`image-preview:${open}`); }),
      setMultiRunLauncherOpen: mock((open: boolean) => { calls.push(`multi-run:${open}`); }),
      setSessionSwitcherOpen: mock((open: boolean) => { calls.push(`session-switcher:${open}`); }),
      closeDesktopWindow: mock(() => { calls.push('close-window'); }),
    };
  };

  test('closes settings dialog when it is open instead of hiding the window', () => {
    const handlers = createHandlers();
    executeCloseAction({ ...allClosed, isSettingsDialogOpen: true }, handlers);
    expect(handlers.calls).toEqual(['settings:false']);
  });

  test('closes command palette when it is open', () => {
    const handlers = createHandlers();
    executeCloseAction({ ...allClosed, isCommandPaletteOpen: true }, handlers);
    expect(handlers.calls).toEqual(['command-palette:false']);
  });

  test('requests desktop window close when no overlay is open', () => {
    const handlers = createHandlers();
    executeCloseAction(allClosed, handlers);
    expect(handlers.calls).toEqual(['close-window']);
  });

  test('closes only the highest-priority overlay when multiple are open', () => {
    const handlers = createHandlers();
    executeCloseAction(
      { ...allClosed, isSettingsDialogOpen: true, isImagePreviewOpen: true },
      handlers,
    );
    expect(handlers.calls).toEqual(['image-preview:false']);
  });

  test('does not close the window when any overlay is open', () => {
    const handlers = createHandlers();
    executeCloseAction({ ...allClosed, isHelpDialogOpen: true }, handlers);
    expect(handlers.calls).toEqual(['help:false']);
  });
});

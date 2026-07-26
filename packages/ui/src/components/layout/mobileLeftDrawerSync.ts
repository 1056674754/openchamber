import { useUIStore } from '@/stores/useUIStore';

/** Keep the legacy session-switcher flag aligned with the mobile left drawer. */
export function syncSessionSwitcherWithDrawer(open: boolean): void {
  if (useUIStore.getState().isSessionSwitcherOpen === open) {
    return;
  }
  useUIStore.getState().setSessionSwitcherOpen(open);
}

export function resolveLeftDrawerOpen(
  currentOpen: boolean,
  sessionSwitcherOpen: boolean,
): boolean {
  return sessionSwitcherOpen;
}

export function shouldCloseDrawerAfterSessionPick(
  drawerOpen: boolean,
  sessionSwitcherOpen: boolean,
): boolean {
  // After a session pick, switcher becomes false; drawer must follow.
  return drawerOpen && !sessionSwitcherOpen;
}

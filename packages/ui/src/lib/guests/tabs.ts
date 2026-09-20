import { pluginModeFromId, type PluginContextPanelMode } from '@/lib/surfaces/modes';
import { useUIStore } from '@/stores/useUIStore';

/** Close every context-panel tab of one guest in every project. Disable, remove, and a catalog that no longer lists the guest all end here. */
export const closeGuestTabsEverywhere = (mode: PluginContextPanelMode): void => {
  const ui = useUIStore.getState();
  for (const [panelKey, panel] of Object.entries(ui.contextPanelByDirectory)) {
    // [fork-port] The fork closes tabs one at a time and keys panel state by
    // its resolved storage key (directory or `session:<id>`).
    const tabIds = panel.tabs.filter((tab) => tab.mode === mode).map((tab) => tab.id);
    for (const tabId of tabIds) {
      ui.closeContextPanelTab(panelKey, tabId);
    }
  }
};

export const closeGuestTabsById = (guestId: string): void => closeGuestTabsEverywhere(pluginModeFromId(guestId));

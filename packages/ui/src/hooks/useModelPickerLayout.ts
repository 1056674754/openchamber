import React from 'react';
import { useActiveServerId } from '@/hooks/useActiveServerId';
import {
  EMPTY_MODEL_PICKER_LAYOUT,
  modelPickerProviderSectionKey,
  type ModelPickerLayout,
} from '@/lib/modelPickerLayout';
import { useUIStore } from '@/stores/useUIStore';

export const useModelPickerLayout = () => {
  const serverId = useActiveServerId();
  const layout = useUIStore(
    (state): ModelPickerLayout => state.modelPickerLayoutByServerId[serverId] ?? EMPTY_MODEL_PICKER_LAYOUT,
  );
  const toggleModelPickerSectionCollapsed = useUIStore((state) => state.toggleModelPickerSectionCollapsed);
  const setModelPickerSectionsCollapsed = useUIStore((state) => state.setModelPickerSectionsCollapsed);
  const reorderModelProviders = useUIStore((state) => state.reorderModelProviders);

  const collapsedSections = React.useMemo(
    () => new Set(layout.collapsedProviders),
    [layout.collapsedProviders],
  );

  const toggleSectionCollapsed = React.useCallback((sectionKey: string) => {
    toggleModelPickerSectionCollapsed(serverId, sectionKey);
  }, [serverId, toggleModelPickerSectionCollapsed]);

  const setSectionsCollapsed = React.useCallback((sectionKeys: string[], collapsed: boolean) => {
    setModelPickerSectionsCollapsed(serverId, sectionKeys, collapsed);
  }, [serverId, setModelPickerSectionsCollapsed]);

  const reorderProviders = React.useCallback((orderedProviderIDs: string[]) => {
    reorderModelProviders(serverId, orderedProviderIDs);
  }, [reorderModelProviders, serverId]);

  const isProviderExpanded = React.useCallback((providerID: string) => (
    !collapsedSections.has(modelPickerProviderSectionKey(providerID))
  ), [collapsedSections]);

  const toggleProviderExpanded = React.useCallback((providerID: string) => {
    toggleModelPickerSectionCollapsed(serverId, modelPickerProviderSectionKey(providerID));
  }, [serverId, toggleModelPickerSectionCollapsed]);

  return {
    serverId,
    providerOrder: layout.providerOrder,
    collapsedSections,
    toggleSectionCollapsed,
    setSectionsCollapsed,
    reorderProviders,
    isProviderExpanded,
    toggleProviderExpanded,
  };
};

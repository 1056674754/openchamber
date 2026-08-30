import React from 'react';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { resolveSettingsProjectTarget, type SettingsProjectTarget } from '@/lib/settingsProjectTarget';
import { useInstanceContextStore } from '@/stores/useInstanceContextStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';

export const useSettingsProjectTarget = (): SettingsProjectTarget => {
  const currentInstance = useInstanceContextStore((state) => state.currentInstance);
  const settingsServerId = currentInstance?.type === 'remote' ? currentInstance.id : DEFAULT_SERVER_ID;
  const selectedProjectIdByServer = useUIStore((state) => state.settingsConfigProjectIdByServer);
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);

  return React.useMemo(
    () => resolveSettingsProjectTarget(selectedProjectIdByServer, projects, activeProjectId, settingsServerId),
    [activeProjectId, projects, selectedProjectIdByServer, settingsServerId],
  );
};

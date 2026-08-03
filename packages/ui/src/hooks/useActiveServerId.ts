import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { serverRegistry, DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { UNRESOLVED_SERVER_ID, resolveSessionAuthority } from '@/sync/session-authority';

export function useActiveServerId(): string {
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
  const draftProjectId = useSessionUIStore((s) => s.newSessionDraft?.selectedProjectId ?? null);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const projects = useProjectsStore((s) => s.projects);
  const currentSessionServerId = React.useSyncExternalStore(
    React.useCallback(
      (notify) => currentSessionId
        ? serverRegistry.onSessionServerChange(currentSessionId, notify)
        : () => undefined,
      [currentSessionId],
    ),
    React.useCallback(
      () => currentSessionId
        ? serverRegistry.getServerForSession(currentSessionId) ?? UNRESOLVED_SERVER_ID
        : DEFAULT_SERVER_ID,
      [currentSessionId],
    ),
    () => DEFAULT_SERVER_ID,
  );

  if (currentSessionId) {
    if (currentSessionServerId !== UNRESOLVED_SERVER_ID) {
      return currentSessionServerId;
    }
    // No runtime index yet: recover from the authoritative session→project
    // binding before declaring unresolved. A remote session must never
    // degrade to DEFAULT_SERVER_ID.
    return resolveSessionAuthority(currentSessionId).serverId ?? UNRESOLVED_SERVER_ID;
  }

  const projectId = draftProjectId || activeProjectId;
  const project = projectId ? projects.find((entry) => entry.id === projectId) : null;
  return project?.serverId || DEFAULT_SERVER_ID;
}

export function useActiveServerBaseUrl(): string {
  const serverId = useActiveServerId();
  if (serverId === DEFAULT_SERVER_ID || serverId === UNRESOLVED_SERVER_ID) return '';
  const connection = serverRegistry.get(serverId);
  return connection?.config.baseUrl ?? '';
}

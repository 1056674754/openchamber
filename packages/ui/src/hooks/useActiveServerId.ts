import { useSessionUIStore } from '@/sync/session-ui-store';
import { serverRegistry, DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { useProjectsStore } from '@/stores/useProjectsStore';

export function useActiveServerId(): string {
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
  const draftProjectId = useSessionUIStore((s) => s.newSessionDraft?.selectedProjectId ?? null);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const projects = useProjectsStore((s) => s.projects);

  if (currentSessionId) {
    const serverId = serverRegistry.getServerForSession(currentSessionId);
    return serverId || DEFAULT_SERVER_ID;
  }

  const projectId = draftProjectId || activeProjectId;
  const project = projectId ? projects.find((entry) => entry.id === projectId) : null;
  return project?.serverId || DEFAULT_SERVER_ID;
}

export function useActiveServerBaseUrl(): string {
  const serverId = useActiveServerId();
  if (serverId === DEFAULT_SERVER_ID) return '';
  const connection = serverRegistry.get(serverId);
  return connection?.config.baseUrl || '';
}

import { resolveApiUrl } from './api/serverUrl';
import { DEFAULT_SERVER_ID, serverRegistry } from './opencode/server-registry';
import { createProjectIdFromPath } from './projectId';
import { registerRemoteInstanceProxy } from './remote-instances/registry';

export interface ProjectRef {
  id: string;
  path: string;
  serverId?: string;
}

/** Project ids in settings can churn; the path-derived storage id cannot. */
export const resolveProjectContextId = (project: ProjectRef | null | undefined): string => {
  const projectPath = typeof project?.path === 'string' ? project.path.trim() : '';
  return projectPath ? createProjectIdFromPath(projectPath) : '';
};

const requireProjectId = (project: ProjectRef): string => {
  const projectId = resolveProjectContextId(project);
  if (!projectId) throw new Error('Project has no resolvable path');
  return projectId;
};

export const resolveProjectServerBaseUrl = (project: ProjectRef): string => {
  const serverId = project.serverId?.trim();
  if (!serverId || serverId === DEFAULT_SERVER_ID) return '';
  const connection = serverRegistry.get(serverId) ?? registerRemoteInstanceProxy({
    id: serverId,
    label: serverId,
    healthStatus: 'connecting',
  });
  if (!connection?.config.baseUrl) throw new Error(`Project server ${serverId} is unavailable`);
  return connection.config.baseUrl;
};

/** Route any project-owned API call through the project's explicit instance. */
export const resolveProjectApiUrl = (project: ProjectRef, route: string): string => (
  resolveApiUrl(route, resolveProjectServerBaseUrl(project))
);

export const resolveProjectContextApiBasePath = (project: ProjectRef): string => resolveApiUrl(
  `/api/project-context/${encodeURIComponent(requireProjectId(project))}`,
  resolveProjectServerBaseUrl(project),
);

import type { ProjectEntry } from '@/lib/api/types';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';

export type SettingsProjectTarget = {
  serverId: string;
  project: ProjectEntry | null;
  projectId: string | null;
  directory: string | null;
  projects: ProjectEntry[];
};

const projectServerId = (project: ProjectEntry): string => project.serverId?.trim() || DEFAULT_SERVER_ID;

export const resolveSettingsProjectTarget = (
  selectedProjectIdByServer: Record<string, string>,
  projects: ProjectEntry[],
  activeProjectId: string | null,
  settingsServerId: string,
): SettingsProjectTarget => {
  const matchingProjects = projects.filter((project) => projectServerId(project) === settingsServerId);
  const selectedId = selectedProjectIdByServer[settingsServerId];
  const selected = selectedId
    ? matchingProjects.find((project) => project.id === selectedId) ?? null
    : null;
  const active = matchingProjects.find((project) => project.id === activeProjectId) ?? null;
  const project = selected ?? active ?? matchingProjects[0] ?? null;
  return {
    serverId: settingsServerId,
    project,
    projectId: project?.id ?? null,
    directory: project?.path ?? null,
    projects: matchingProjects,
  };
};

import { runtimeFetch } from './runtime-fetch';
import {
  resolveProjectApiUrl,
  resolveProjectContextId,
  type ProjectRef,
} from './projectContextAuthority';

export type AgentMemoryScope = 'global' | 'project';
export type AgentMemoryType = 'fact' | 'preference' | 'reference';

export interface AgentMemoryEntry {
  id: string;
  title: string;
  body: string;
  type: AgentMemoryType;
  createdAt: number;
  updatedAt: number;
  flagged?: boolean;
  sessionId?: string;
}

export interface AgentMemorySnapshot {
  global: AgentMemoryEntry[];
  project: AgentMemoryEntry[];
  globalFailed: boolean;
  projectFailed: boolean;
}

export type AgentMemoryLoadResult =
  | { enabled: false }
  | ({ enabled: true } & AgentMemorySnapshot);

const readError = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = await response.json() as { error?: unknown } | null;
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
  } catch {
    // Use the status-bearing fallback below.
  }
  return `${fallback} (${response.status})`;
};

const parseEntries = (value: unknown): AgentMemoryEntry[] => (
  Array.isArray(value) ? value as AgentMemoryEntry[] : []
);

const projectMemoryId = (project: ProjectRef): string => {
  const value = resolveProjectContextId(project);
  if (!value) throw new Error('Project has no resolvable path');
  return value;
};

const memoryRoute = (project: ProjectRef, suffix = ''): string => (
  resolveProjectApiUrl(project, `/api/agent-memory${suffix}`)
);

const scopeQuery = (project: ProjectRef, scope: AgentMemoryScope): string => {
  const query = new URLSearchParams({ scope });
  if (scope === 'project') query.set('projectId', projectMemoryId(project));
  return query.toString();
};

export const fetchAgentMemory = async (
  project: ProjectRef,
  options: { signal?: AbortSignal } = {},
): Promise<AgentMemoryLoadResult> => {
  const query = new URLSearchParams({ projectId: projectMemoryId(project) });
  const response = await runtimeFetch(`${memoryRoute(project, '/all')}?${query}`, {
    cache: 'no-store',
    signal: options.signal,
  });
  if (response.status === 404) {
    const payload = await response.json().catch(() => null) as { disabled?: unknown; error?: unknown } | null;
    if (payload?.disabled === true) return { enabled: false };
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Agent memory was not found');
  }
  if (!response.ok) throw new Error(await readError(response, 'Failed to load agent memory'));
  const payload = await response.json() as Partial<AgentMemorySnapshot> | null;
  if (!payload || typeof payload !== 'object') throw new Error('Malformed agent memory response');
  return {
    enabled: true,
    global: parseEntries(payload.global),
    project: parseEntries(payload.project),
    globalFailed: payload.globalFailed === true,
    projectFailed: payload.projectFailed === true,
  };
};

export const updateAgentMemory = async (
  project: ProjectRef,
  scope: AgentMemoryScope,
  memoryId: string,
  patch: { title?: string; body?: string; type?: AgentMemoryType },
): Promise<{ entry: AgentMemoryEntry; entries: AgentMemoryEntry[] }> => {
  const response = await runtimeFetch(
    `${memoryRoute(project, `/${encodeURIComponent(memoryId)}`)}?${scopeQuery(project, scope)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) throw new Error(await readError(response, 'Failed to update agent memory'));
  const payload = await response.json() as { entry?: AgentMemoryEntry; entries?: unknown };
  if (!payload.entry) throw new Error('Malformed agent memory update response');
  return { entry: payload.entry, entries: parseEntries(payload.entries) };
};

export const deleteAgentMemory = async (
  project: ProjectRef,
  scope: AgentMemoryScope,
  memoryId: string,
): Promise<AgentMemoryEntry[]> => {
  const response = await runtimeFetch(
    `${memoryRoute(project, `/${encodeURIComponent(memoryId)}`)}?${scopeQuery(project, scope)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(await readError(response, 'Failed to delete agent memory'));
  const payload = await response.json() as { entries?: unknown };
  return parseEntries(payload.entries);
};

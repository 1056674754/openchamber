export type ScheduledTaskStatus = 'idle' | 'running' | 'success' | 'error';

export type ScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'daily' | 'weekly' | 'once' | 'cron';
    times?: string[];
    time?: string;
    date?: string;
    weekdays?: number[];
    cron?: string;
    timezone?: string;
  };
  execution: {
    prompt: string;
    providerID: string;
    modelID: string;
    variant?: string;
    agent?: string;
  };
  state: {
    createdAt: number;
    updatedAt: number;
    lastRunAt?: number;
    lastStatus?: ScheduledTaskStatus;
    lastError?: string;
    lastDurationMs?: number;
    lastSessionId?: string;
    nextRunAt?: number;
  };
};

const parseErrorMessage = async (response: Response, fallback: string) => {
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const ensureProjectID = (projectID: string): string => {
  const trimmed = typeof projectID === 'string' ? projectID.trim() : '';
  if (!trimmed) {
    throw new Error('projectId is required');
  }
  return trimmed;
};

const projectUrl = (projectID: string, suffix: string, baseUrl?: string): string => {
  const path = `/api/projects/${encodeURIComponent(projectID)}${suffix}`;
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : path;
};

export const fetchScheduledTasks = async (projectID: string, baseUrl?: string): Promise<ScheduledTask[]> => {
  const safeProjectID = ensureProjectID(projectID);
  const response = await fetch(projectUrl(safeProjectID, '/scheduled-tasks', baseUrl));
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to load scheduled tasks'));
  }
  const parsed = await response.json().catch(() => null);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return [];
  }
  return parsed.tasks as ScheduledTask[];
};

export const upsertScheduledTask = async (projectID: string, task: Partial<ScheduledTask>, baseUrl?: string): Promise<ScheduledTask[]> => {
  const safeProjectID = ensureProjectID(projectID);
  const response = await fetch(projectUrl(safeProjectID, '/scheduled-tasks', baseUrl), {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ task }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to save scheduled task'));
  }
  const parsed = await response.json().catch(() => null);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return [];
  }
  return parsed.tasks as ScheduledTask[];
};

export const deleteScheduledTask = async (projectID: string, taskID: string, baseUrl?: string): Promise<ScheduledTask[]> => {
  const safeProjectID = ensureProjectID(projectID);
  const safeTaskID = ensureProjectID(taskID);
  const response = await fetch(projectUrl(safeProjectID, `/scheduled-tasks/${encodeURIComponent(safeTaskID)}`, baseUrl), {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to delete scheduled task'));
  }
  const parsed = await response.json().catch(() => null);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return [];
  }
  return parsed.tasks as ScheduledTask[];
};

export const runScheduledTaskNow = async (projectID: string, taskID: string, baseUrl?: string): Promise<{ sessionId?: string }> => {
  const safeProjectID = ensureProjectID(projectID);
  const safeTaskID = ensureProjectID(taskID);
  const response = await fetch(projectUrl(safeProjectID, `/scheduled-tasks/${encodeURIComponent(safeTaskID)}/run`, baseUrl), {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to run scheduled task'));
  }
  const parsed = await response.json().catch(() => null);
  return {
    sessionId: typeof parsed?.sessionId === 'string' && parsed.sessionId.length > 0 ? parsed.sessionId : undefined,
  };
};

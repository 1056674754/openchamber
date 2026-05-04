export async function createTempSession(topic: string): Promise<{ path: string; topic: string }> {
  const response = await fetch('/api/temp-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to create temporary session');
  }

  return response.json();
}

export async function createTempSessionWithOpenCodeSession(
  topic: string,
  options?: { title?: string; parentID?: string },
): Promise<{ path: string; topic: string; session: Record<string, unknown> | null }> {
  const response = await fetch('/api/temp-sessions/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title: options?.title, parentID: options?.parentID }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    const err = new Error(error.error || 'Failed to create temp session with OpenCode session');
    (err as { status?: number }).status = response.status;
    (err as { path?: string }).path = error.path;
    throw err;
  }

  return response.json();
}

export async function listTempSessions(): Promise<Array<{
  path: string;
  topic: string;
  date: string;
  createdAt: number;
}>> {
  const response = await fetch('/api/temp-sessions');

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to list temporary sessions');
  }

  const data = await response.json();
  return data.directories || [];
}

export async function cleanupTempSessions(maxAgeDays?: number): Promise<{
  deleted: number;
  errors: number;
}> {
  const response = await fetch('/api/temp-sessions/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxAgeDays }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to cleanup temporary sessions');
  }

  return response.json();
}

export async function deleteTempSession(dirPath: string): Promise<void> {
  const response = await fetch('/api/temp-sessions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to delete temporary session');
  }
}

export async function renameTempSession(dirPath: string, newTopic: string): Promise<{ path: string; topic: string }> {
  const response = await fetch('/api/temp-sessions/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath, topic: newTopic }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to rename temporary session');
  }

  return response.json();
}

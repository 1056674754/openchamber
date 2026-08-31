import { ensureGlobalSessionsLoaded, resolveGlobalSessionDirectory } from '@/stores/useGlobalSessionsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

/**
 * Select a session named by `/?session=`. Cold loads often do not know the
 * owning directory yet, so a first selection may guess the active project.
 * After the global session list is available, re-select with that directory
 * unless the user already moved to a different session. The fork's store is
 * multi-instance, so the re-selection also carries the session's owning
 * server when one is registered.
 */
export async function openSessionFromRoute(sessionId: string): Promise<void> {
  const id = sessionId.trim();
  if (!id) return;

  const directoryFor = (): string | null =>
    useSessionUIStore.getState().getDirectoryForSession(id);

  const initial = useSessionUIStore.getState();
  if (initial.currentSessionId !== id) {
    initial.setCurrentSession(id, directoryFor());
  }

  const snapshot = await ensureGlobalSessionsLoaded().catch(() => null);
  if (!snapshot) return;

  const latest = useSessionUIStore.getState();
  if (latest.currentSessionId !== id) return;

  const session = [...snapshot.activeSessions, ...snapshot.archivedSessions]
    .find((entry) => entry.id === id);
  if (!session) return;

  const directory = resolveGlobalSessionDirectory(session);
  const currentDirectory = directoryFor();
  if (!directory || directory === currentDirectory) return;

  latest.setCurrentSession(id, directory);
}

import { getSyncStoresForServer } from '@/sync/multi-server-registry';

export type RemoteProjectRef = {
  id: string;
  normalizedPath: string;
  serverId?: string;
};

export type RemoteProjectLoadState = {
  phase: 'pending' | 'loading' | 'complete';
};

/**
 * Session-list skeleton for remotes.
 *
 * Missing SyncProvider is NOT "still loading" — after host-aggregated list
 * mode, inactive remotes intentionally have no live sync store. Treat that as
 * complete so the sidebar shows empty/sessions from the catalog instead of a
 * permanent skeleton.
 */
export function getRemoteProjectLoadStates(
  projects: RemoteProjectRef[],
): Map<string, RemoteProjectLoadState> {
  const result = new Map<string, RemoteProjectLoadState>();

  for (const project of projects) {
    if (!project.serverId || project.serverId === 'default') continue;

    const stores = getSyncStoresForServer(project.serverId);
    if (!stores) {
      result.set(project.id, { phase: 'complete' });
      continue;
    }

    const store = stores.getChild(project.normalizedPath);
    const storeStatus = store?.getState().status;
    result.set(project.id, {
      phase: !store ? 'pending' : storeStatus === 'complete' ? 'complete' : 'loading',
    });
  }

  return result;
}

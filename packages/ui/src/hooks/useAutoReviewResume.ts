import React from 'react';

import { resumeAllAutoReviewRuns } from '@/lib/reviewFlow';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { useAutoReviewStore } from '@/stores/useAutoReviewStore';

/** Resume persisted auto-review loops and stop runs when a remote server unregisters. */
export function useAutoReviewResume(): void {
  const runsSignature = useAutoReviewStore((state) => {
    return Object.values(state.runsByOriginalSessionID)
      .filter((run) => run.status === 'running')
      .map((run) => `${run.originalSessionID}:${run.serverId}:${run.phase}:${run.iteration}`)
      .sort()
      .join('|');
  });

  React.useEffect(() => {
    resumeAllAutoReviewRuns();
  }, [runsSignature]);

  React.useEffect(() => {
    return serverRegistry.onUnregister((serverId) => {
      useAutoReviewStore.getState().stopRunningRunsForServer(serverId);
    });
  }, []);
}

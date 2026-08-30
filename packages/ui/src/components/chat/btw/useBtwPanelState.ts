import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';

import { getBtwBoundaryMessageID, getBtwSessionID } from '@/lib/sessionBtwMetadata';
import { useBtwStore } from '@/stores/useBtwStore';
import { useSession } from '@/sync/sync-context';

export type BtwPanelState = {
  parentSession: Session | null;
  btwSessionId: string | null;
  btwSession: Session | null;
  btwDirectory: string | null;
  boundaryMessageID: string | null;
  collapsed: boolean;
  creating: boolean;
};

/** One authority chain: parent metadata link -> live fork -> transient presentation. */
export const useBtwPanelState = (
  parentSessionId: string | null | undefined,
  directory: string | undefined,
): BtwPanelState => {
  const parentSession = useSession(parentSessionId, directory) ?? null;
  const linkedBtwSessionId = getBtwSessionID(parentSession);
  const linkedSession = useSession(linkedBtwSessionId, directory) ?? null;
  const uiState = useBtwStore(
    React.useCallback(
      (state) => (parentSessionId ? state.byParent[parentSessionId] : undefined),
      [parentSessionId],
    ),
  );
  const btwSessionId = linkedSession && !uiState?.destroying ? linkedBtwSessionId : null;
  const btwSession = btwSessionId ? linkedSession : null;
  const btwDirectory = btwSession
    ? ((btwSession as Session & { directory?: string | null }).directory?.trim() || directory || null)
    : null;

  return {
    parentSession,
    btwSessionId,
    btwSession,
    btwDirectory,
    boundaryMessageID: btwSession ? getBtwBoundaryMessageID(btwSession) : null,
    collapsed: uiState?.collapsed === true,
    creating: uiState?.creating === true,
  };
};

import React from 'react';
import type { PermissionRequest } from '@/types/permission';
import type { FormRequest } from '@/types/form';
import type { InlineBlockingRequests } from './lib/blockingRequests';
import { getToolRequestKey } from './lib/blockingRequests';

const EMPTY_FORMS: FormRequest[] = [];
const EMPTY_PERMISSIONS: PermissionRequest[] = [];
const EMPTY_INLINE_BLOCKING_REQUESTS: InlineBlockingRequests = {
  forms: EMPTY_FORMS,
  permissions: EMPTY_PERMISSIONS,
};
const EMPTY_PENDING_CALL_IDS: ReadonlySet<string> = new Set();

export type InlineBlockingRequestsByTool = ReadonlyMap<string, InlineBlockingRequests>;

export type InlineBlockingRequestsContextValue = {
  inlineByTool: InlineBlockingRequestsByTool;
  /**
   * callIDs of ALL pending forms on the server for the scoped sessions
   * (including forms routed to trailing, not just inline). Used by the
   * form recovery mechanism to avoid creating a duplicate recovered card
   * when the form is already being rendered elsewhere.
   */
  pendingFormCallIDs: ReadonlySet<string>;
};

const EMPTY_CONTEXT_VALUE: InlineBlockingRequestsContextValue = {
  inlineByTool: new Map(),
  pendingFormCallIDs: EMPTY_PENDING_CALL_IDS,
};

export const InlineBlockingRequestsContext = React.createContext<InlineBlockingRequestsContextValue>(EMPTY_CONTEXT_VALUE);

export const useInlineBlockingRequestsForTool = (
  messageID: string | null | undefined,
  callID: string | null | undefined,
): InlineBlockingRequests => {
  const { inlineByTool } = React.useContext(InlineBlockingRequestsContext);
  if (!messageID || !callID) return EMPTY_INLINE_BLOCKING_REQUESTS;
  return inlineByTool.get(getToolRequestKey(messageID, callID)) ?? EMPTY_INLINE_BLOCKING_REQUESTS;
};

/**
 * Returns the set of callIDs for ALL pending forms on the server for the
 * scoped sessions. Used to prevent form recovery from creating a duplicate
 * card when the form is already pending (and may be rendered as trailing).
 */
export const usePendingFormCallIDs = (): ReadonlySet<string> => {
  return React.useContext(InlineBlockingRequestsContext).pendingFormCallIDs;
};

import React from 'react';
import type { PermissionRequest } from '@/types/permission';
import type { QuestionRequest } from '@/types/question';
import type { InlineBlockingRequests } from './lib/blockingRequests';
import { getToolRequestKey } from './lib/blockingRequests';

const EMPTY_QUESTIONS: QuestionRequest[] = [];
const EMPTY_PERMISSIONS: PermissionRequest[] = [];
const EMPTY_INLINE_BLOCKING_REQUESTS: InlineBlockingRequests = {
  questions: EMPTY_QUESTIONS,
  permissions: EMPTY_PERMISSIONS,
};
const EMPTY_PENDING_CALL_IDS: ReadonlySet<string> = new Set();

export type InlineBlockingRequestsByTool = ReadonlyMap<string, InlineBlockingRequests>;

export type InlineBlockingRequestsContextValue = {
  inlineByTool: InlineBlockingRequestsByTool;
  /**
   * callIDs of ALL pending questions on the server for the scoped sessions
   * (including questions routed to trailing, not just inline). Used by the
   * question recovery mechanism to avoid creating a duplicate recovered card
   * when the question is already being rendered elsewhere.
   */
  pendingQuestionCallIDs: ReadonlySet<string>;
};

const EMPTY_CONTEXT_VALUE: InlineBlockingRequestsContextValue = {
  inlineByTool: new Map(),
  pendingQuestionCallIDs: EMPTY_PENDING_CALL_IDS,
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
 * Returns the set of callIDs for ALL pending questions on the server for the
 * scoped sessions. Used to prevent question recovery from creating a duplicate
 * card when the question is already pending (and may be rendered as trailing).
 */
export const usePendingQuestionCallIDs = (): ReadonlySet<string> => {
  return React.useContext(InlineBlockingRequestsContext).pendingQuestionCallIDs;
};

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

export type InlineBlockingRequestsByTool = ReadonlyMap<string, InlineBlockingRequests>;

export const InlineBlockingRequestsContext = React.createContext<InlineBlockingRequestsByTool>(new Map());

export const useInlineBlockingRequestsForTool = (
  messageID: string | null | undefined,
  callID: string | null | undefined,
): InlineBlockingRequests => {
  const requestsByTool = React.useContext(InlineBlockingRequestsContext);
  if (!messageID || !callID) return EMPTY_INLINE_BLOCKING_REQUESTS;
  return requestsByTool.get(getToolRequestKey(messageID, callID)) ?? EMPTY_INLINE_BLOCKING_REQUESTS;
};

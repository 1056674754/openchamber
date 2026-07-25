import type { Message } from '@opencode-ai/sdk/v2/client';
import type { AutoReviewRun } from '@/stores/useAutoReviewStore';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';

export const AUTO_REVIEW_FINAL_MARKER = 'FINAL_REVIEW_STATUS: no_remaining_findings';
const AUTO_REVIEW_FINAL_MARKER_NORMALIZED = AUTO_REVIEW_FINAL_MARKER.toLowerCase();

const activeAutoReviewForwardKeys = new Set<string>();

const getMessageParentID = (message: Message): string | null => {
  const parentID = (message as { parentID?: unknown }).parentID;
  return typeof parentID === 'string' && parentID.trim().length > 0 ? parentID : null;
};

export const isAutoReviewServerCurrent = (serverId: string): boolean => {
  if (!serverId) return false;
  if (serverId === DEFAULT_SERVER_ID) return true;
  return serverRegistry.has(serverId);
};

export const assertAutoReviewServerStillCurrent = (expectedServerId?: string): void => {
  if (expectedServerId && !isAutoReviewServerCurrent(expectedServerId)) {
    throw new Error('Auto-review stopped because the server became unavailable.');
  }
};

export const hasFinalReviewMarker = (text: string): boolean => {
  const lines = text.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1)?.toLowerCase() === AUTO_REVIEW_FINAL_MARKER_NORMALIZED;
};

export const stripFinalReviewMarker = (text: string): string => {
  const lines = text.trimEnd().split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.at(-1)?.trim().toLowerCase() === AUTO_REVIEW_FINAL_MARKER_NORMALIZED) {
    lines.pop();
  }
  return lines.join('\n').trim();
};

export const isExpectedAutoReviewAssistantParent = (message: Message, expectedParentID?: string): boolean => {
  if (!expectedParentID) return true;
  return getMessageParentID(message) === expectedParentID;
};

const getAutoReviewForwardKey = (run: AutoReviewRun, messageID: string): string => [
  run.serverId,
  run.originalSessionID,
  run.phase,
  run.expectedAssistantParentID ?? '',
  messageID,
].join(':');

export const claimAutoReviewForward = (run: AutoReviewRun, messageID: string): string | null => {
  const key = getAutoReviewForwardKey(run, messageID);
  if (activeAutoReviewForwardKeys.has(key)) return null;
  activeAutoReviewForwardKeys.add(key);
  return key;
};

export const releaseAutoReviewForward = (key: string): void => {
  activeAutoReviewForwardKeys.delete(key);
};

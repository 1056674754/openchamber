export type QueuedAutoSendSessionStatus = 'idle' | 'busy' | 'retry';

export type QueuedAutoSendFailure = {
  readonly messageId: string;
  readonly failures: number;
  readonly nextAttemptAt: number;
};

const AUTO_SEND_RETRY_BASE_DELAY_MS = 2_000;
const AUTO_SEND_RETRY_MAX_DELAY_MS = 60_000;

export const getQueuedAutoSendRetryDelayMs = (failures: number): number => {
  const exponent = Math.max(failures - 1, 0);
  return Math.min(AUTO_SEND_RETRY_BASE_DELAY_MS * 2 ** exponent, AUTO_SEND_RETRY_MAX_DELAY_MS);
};

export const isQueuedAutoSendBackedOff = (
  failure: QueuedAutoSendFailure | undefined,
  messageId: string,
  now: number,
): boolean => failure !== undefined
  && failure.messageId === messageId
  && now < failure.nextAttemptAt;

export const shouldDispatchQueuedAutoSend = (
  previousStatusType: QueuedAutoSendSessionStatus | undefined,
  currentStatusType: QueuedAutoSendSessionStatus,
  hasQueuedItems = false,
): boolean => {
  if (hasQueuedItems && currentStatusType === 'idle') {
    return true;
  }
  return (previousStatusType === 'busy' || previousStatusType === 'retry')
    && currentStatusType === 'idle';
};

type ChronologicalMessage = { id: string; time?: { created?: unknown } };

const createdAt = (message: ChronologicalMessage): number => {
  const value = message.time?.created;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export const compareMessagesChronologically = (left: ChronologicalMessage, right: ChronologicalMessage): number => {
  const timeDifference = createdAt(left) - createdAt(right);
  if (timeDifference !== 0) return timeDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

export const sortMessagesChronologically = <T extends ChronologicalMessage>(messages: readonly T[]): T[] =>
  [...messages].sort(compareMessagesChronologically);

export const findMessageIndex = (messages: readonly ChronologicalMessage[], messageID: string): number =>
  messages.findIndex((message) => message.id === messageID);

export const insertMessageChronologically = <T extends ChronologicalMessage>(messages: T[], message: T): number => {
  let low = 0;
  let high = messages.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareMessagesChronologically(messages[middle], message) < 0) low = middle + 1;
    else high = middle;
  }
  messages.splice(low, 0, message);
  return low;
};

export const messagesBefore = <T extends ChronologicalMessage>(messages: readonly T[], messageID?: string): T[] => {
  if (!messageID) return messages as T[];
  const index = findMessageIndex(messages, messageID);
  return index < 0 ? messages as T[] : messages.slice(0, index);
};

export const messagesFrom = <T extends ChronologicalMessage>(messages: readonly T[], messageID?: string): T[] => {
  if (!messageID) return [];
  const index = findMessageIndex(messages, messageID);
  return index < 0 ? [] : messages.slice(index);
};

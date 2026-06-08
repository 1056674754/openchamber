import type { QueuedMessage } from '@/stores/messageQueueStore';
import { parseAgentMentions } from '@/lib/messages/agentMentions';
import type { Agent } from '@opencode-ai/sdk/v2';

export const buildQueuedAutoSendPayload = (queue: QueuedMessage[], agents: Agent[] = []) => {
  const queued = queue[0];
  if (!queued) {
    return null;
  }

  const { sanitizedText, mention } = parseAgentMentions(queued.content, agents);

  return {
    queuedMessageId: queued.id,
    primaryText: sanitizedText,
    primaryAttachments: queued.attachments ?? [],
    agentMentionName: mention?.name,
    sendConfig: queued.sendConfig,
    sendTarget: queued.sendTarget,
  };
};

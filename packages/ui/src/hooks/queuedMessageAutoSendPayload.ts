import type { QueuedMessage, QueuedContextPart } from '@/stores/messageQueueStore';
import { parseAgentMentions } from '@/lib/messages/agentMentions';
import type { Agent } from '@opencode-ai/sdk/v2';

/** Captured context rides the auto-send as plain synthetic text parts. */
export const queuedContextToAdditionalParts = (context: readonly QueuedContextPart[] = []): Array<{
  text: string;
  synthetic: boolean;
}> => context
  .flatMap((part) => (part.kind === 'context' && part.instructions
    ? [{ text: part.instructions, synthetic: true }, { text: part.text, synthetic: true }]
    : [{ text: part.text, synthetic: true }]))
  .filter((part) => part.text.trim().length > 0);

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
    additionalParts: queuedContextToAdditionalParts(queued.context),
    sendConfig: queued.sendConfig,
    sendTarget: queued.sendTarget,
  };
};

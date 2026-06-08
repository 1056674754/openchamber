/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Part } from "@opencode-ai/sdk/v2";
import { isFullySyntheticMessage } from "@/lib/messages/synthetic";

export interface MessageInfo {
    id: string;
    role: string;
    time?: {
        created?: number;
        completed?: number;
    };
    status?: string;
    streaming?: boolean;
    finish?: string;
}

export interface MessageRecord {
    info: MessageInfo & Record<string, any>;
    parts: Part[];
}

const TERMINAL_FINISH_REASONS = new Set(["stop", "error", "abort", "cancel"]);
const TERMINAL_MESSAGE_STATUSES = new Set(["completed", "error", "aborted", "failed", "cancelled"]);

export interface TerminalMessageSignalInfo {
    finish?: unknown;
    status?: unknown;
    time?: {
        created?: unknown;
        completed?: unknown;
    };
}

export function getStepFinishReason(parts: readonly Part[] | null | undefined): string | undefined {
    if (!parts) {
        return undefined;
    }

    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index] as { type?: unknown; reason?: unknown } | undefined;
        if (part?.type !== "step-finish") {
            continue;
        }
        return typeof part.reason === "string" ? part.reason : undefined;
    }

    return undefined;
}

export function getMessageFinishReason(
    messageInfo: TerminalMessageSignalInfo | null | undefined,
    parts?: readonly Part[] | null,
): string | undefined {
    if (!messageInfo) {
        return getStepFinishReason(parts);
    }

    const finish = messageInfo.finish;
    if (typeof finish === "string") {
        return finish;
    }

    return getStepFinishReason(parts);
}

export function hasTerminalMessageSignal(
    messageInfo: TerminalMessageSignalInfo | null | undefined,
    parts?: readonly Part[] | null,
): boolean {
    if (!messageInfo && !parts) {
        return false;
    }

    const finish = getMessageFinishReason(messageInfo, parts);
    if (typeof finish === "string" && TERMINAL_FINISH_REASONS.has(finish)) {
        return true;
    }

    const status = messageInfo?.status;
    if (typeof status === "string" && TERMINAL_MESSAGE_STATUSES.has(status)) {
        return true;
    }

    const completedAt = messageInfo?.time?.completed;
    return typeof completedAt === "number" && completedAt > 0;
}

export function isMessageComplete(messageInfo: MessageInfo, parts: Part[] = []): boolean {
    if (isFullySyntheticMessage(parts)) {
        return true;
    }

    const timeInfo = messageInfo?.time ?? {};
    const completedAt = typeof timeInfo?.completed === 'number' ? timeInfo.completed : undefined;
    const messageStatus = messageInfo?.status;

    const hasStopFinish = getMessageFinishReason(messageInfo, parts) === 'stop';

    const hasCompletedFlag = (typeof completedAt === 'number' && completedAt > 0) || messageStatus === 'completed';
    if (!hasCompletedFlag || !hasStopFinish) {
        return false;
    }

    const hasActiveTools = parts.some((part) => {
        switch (part.type) {
            case 'reasoning': {
                const time = (part as any)?.time;
                return !time || typeof time.end === 'undefined';
            }
            case 'tool': {
                const status = (part as any)?.state?.status;
                return status === 'running' || status === 'pending';
            }
            default:
                return false;
        }
    });

    return !hasActiveTools;
}

export function getLatestAssistantMessageId(messages: MessageRecord[]): string | null {
    const assistantMessages = messages
        .filter(msg => msg.info.role === 'assistant' && !isFullySyntheticMessage(msg.parts))
        .sort((a, b) => (a.info.id || "").localeCompare(b.info.id || ""));

    return assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1].info.id
        : null;
}

export function hasAnimatingWork(messages: MessageRecord[]): boolean {
    if (messages.length === 0) {
        return false;
    }

    for (const message of messages) {
        if (message.info.role !== 'assistant') {
            continue;
        }

        if (isFullySyntheticMessage(message.parts)) {
            continue;
        }

        if (!isMessageComplete(message.info, message.parts)) {
            return true;
        }
    }

    return false;
}

export function shouldContinueStreaming(
    messages: MessageRecord[],
    currentStreamingId: string | null
): boolean {
    const latestId = getLatestAssistantMessageId(messages);
    if (!latestId) {
        return false;
    }

    if (currentStreamingId && currentStreamingId !== latestId) {
        return true;
    }

    const latestMessage = messages.find(
        (msg) => msg.info.id === latestId && !isFullySyntheticMessage(msg.parts)
    );
    if (!latestMessage) {
        return false;
    }

    return !isMessageComplete(latestMessage.info, latestMessage.parts);
}

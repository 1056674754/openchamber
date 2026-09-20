import type { QueuedMessage } from '@/stores/messageQueueStore';
import type { ContextPartPayload } from './contextParts';

// The fork's ContextPartPayload is an open record; read display fields
// defensively instead of relying on the upstream discriminated union.
const readText = (payload: ContextPartPayload, key: string): string => {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
};

function contextPreview(payload: ContextPartPayload): string {
    switch (payload.kind) {
        case 'code-comment':
            return readText(payload, 'text').trim() || readText(payload, 'code').trim() || readText(payload, 'fileLabel');
        case 'chat-quote':
        case 'file-quote':
            return readText(payload, 'text').trim() || readText(payload, 'quote');
        case 'browser-annotation':
            return readText(payload, 'text').trim() || readText(payload, 'prompt').trim() || readText(payload, 'pageUrl');
        case 'pr-comment':
            return readText(payload, 'text').trim() || readText(payload, 'body').trim() || readText(payload, 'label');
        case 'pr-check':
            return readText(payload, 'text').trim() || readText(payload, 'label').trim() || readText(payload, 'output');
        case 'terminal':
            return readText(payload, 'output').trim() || readText(payload, 'terminalLabel');
        case 'github-issue':
        case 'github-pr':
        case 'linear-issue':
        case 'guest-issue':
        case 'guest-pr':
            return readText(payload, 'title').trim() || readText(payload, 'url');
        default:
            return readText(payload, 'text').trim();
    }
}

/** Display-only summary; never substitute it for the editable or delivered text. */
export function getQueuedMessagePreview(message: Pick<QueuedMessage, 'content' | 'context' | 'contextPreview' | 'attachments'>): string {
    let text = message.content.trim() || message.contextPreview?.trim() || '';
    if (!text) {
        for (const part of message.context ?? []) {
            if (part.kind === 'instruction') continue;
            text = (part.kind === 'context' ? contextPreview(part.metadata.openchamberContext) : part.text).trim();
            if (text) break;
        }
    }
    text ||= message.attachments?.[0]?.filename ?? '';
    const firstLine = text.split('\n', 1)[0];
    return firstLine.slice(0, 100) + (text.length > firstLine.length || firstLine.length > 100 ? '...' : '');
}

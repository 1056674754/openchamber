import React from 'react';
import type { Part } from '@opencode-ai/sdk/v2';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import type { StreamPhase } from '../types';
import type { ContentChangeReason } from '@/hooks/useChatAutoFollow';
import { useStreamingTextThrottle } from '../../hooks/useStreamingTextThrottle';
import { resolveAssistantDisplayText, shouldRenderAssistantText } from './assistantTextVisibility';
import { streamPerfCount, streamPerfObserve } from '@/stores/utils/streamDebug';
import { parseThinkingSegments, hasThinkingTags } from '@/lib/thinkingTagParser';
import type { ThinkingSegment } from '@/lib/thinkingTagParser';
import { ReasoningTimelineBlock } from './ReasoningPart';
import { GeneratedJsonResultCard } from './GeneratedJsonResultCard';
import { parseGeneratedJsonResult } from './generatedJsonResult';

type PartWithText = Part & { text?: string; content?: string; value?: string; time?: { start?: number; end?: number } };

interface AssistantTextPartProps {
    part: Part;
    sessionId?: string;
    messageId: string;
    streamPhase: StreamPhase;
    chatRenderMode?: 'sorted' | 'live';
    onContentChange?: (reason?: ContentChangeReason, messageId?: string) => void;
}

const AssistantTextPart: React.FC<AssistantTextPartProps> = ({
    part,
    messageId,
    streamPhase,
    chatRenderMode = 'live',
    onContentChange,
}) => {
    // Use part directly from props — parent provides the latest version from the store.
    // No store subscription here to avoid re-render cascade from unrelated delta events.
    const partWithText = part as PartWithText;
    const rawText = typeof partWithText.text === 'string' ? partWithText.text : '';
    const contentText = typeof partWithText.content === 'string' ? partWithText.content : '';
    const valueText = typeof partWithText.value === 'string' ? partWithText.value : '';
    const textContent = [rawText, contentText, valueText].reduce((best, candidate) => {
        return candidate.length > best.length ? candidate : best;
    }, '');
    const isStreamingPhase = streamPhase === 'streaming';
    const isCooldownPhase = streamPhase === 'cooldown';
    const isStreaming = chatRenderMode === 'live' && (isStreamingPhase || isCooldownPhase);

    streamPerfCount('ui.assistant_text_part.render');
    if (isStreaming) {
        streamPerfCount('ui.assistant_text_part.render.streaming');
    }

    const throttledTextContent = useStreamingTextThrottle({
        text: textContent,
        isStreaming,
        identityKey: `${messageId}:${part.id ?? 'text'}`,
    });

    const displayTextContent = resolveAssistantDisplayText({
        textContent,
        throttledTextContent,
        isStreaming,
    });

    streamPerfObserve('ui.assistant_text_part.display_len', displayTextContent.length);

    const time = partWithText.time;
    const isFinalized = Boolean(time && typeof time.end !== 'undefined');

    // Hooks must be called unconditionally (before early returns).
    const thinkingSegments: ThinkingSegment[] | null = React.useMemo(() => {
        if (part.type !== 'text' || !hasThinkingTags(displayTextContent)) {
            return null;
        }
        return parseThinkingSegments(displayTextContent);
    }, [part.type, displayTextContent]);

    const isRenderableTextPart = part.type === 'text' || part.type === 'reasoning';
    if (!isRenderableTextPart) {
        return null;
    }

    if (!shouldRenderAssistantText({
        displayTextContent,
        isFinalized,
    })) {
        return null;
    }

    const generatedResult = !isStreaming && isFinalized ? parseGeneratedJsonResult(displayTextContent) : null;
    if (generatedResult) {
        return (
            <div
                className={`group/assistant-text relative break-words ${chatRenderMode === 'live' ? 'my-1' : ''}`}
                key={part.id || `${messageId}-text`}
            >
                <GeneratedJsonResultCard result={generatedResult} />
            </div>
        );
    }

    if (part.type === 'reasoning' || !thinkingSegments || thinkingSegments.length === 0 || (thinkingSegments.length === 1 && thinkingSegments[0].type === 'text')) {
        return (
            <div
                className={`group/assistant-text relative break-words ${chatRenderMode === 'live' ? 'my-1' : ''}`}
                key={part.id || `${messageId}-text`}
            >
                <MarkdownRenderer
                    content={displayTextContent}
                    part={part}
                    messageId={messageId}
                    isAnimated={false}
                    isStreaming={isStreaming}
                    disableStreamAnimation={chatRenderMode === 'sorted'}
                    variant={part.type === 'reasoning' ? 'reasoning' : 'assistant'}
                    enableFileReferences={isFinalized}
                />
            </div>
        );
    }

    return (
        <div
            className={`group/assistant-text relative break-words ${chatRenderMode === 'live' ? 'my-1' : ''}`}
            key={part.id || `${messageId}-text`}
        >
            {thinkingSegments.map((segment, index) => {
                if (segment.type === 'thinking') {
                    return (
                        <ReasoningTimelineBlock
                            key={`${messageId}-thinking-${index}`}
                            variant="thinking"
                            text={segment.content}
                            blockId={`${messageId}-thinking-${index}`}
                            time={partWithText.time}
                            isStreaming={isStreaming}
                            onContentChange={onContentChange}
                        />
                    );
                }
                return (
                    <MarkdownRenderer
                        key={`${messageId}-text-${index}`}
                        content={segment.content}
                        part={part}
                        messageId={messageId}
                        isAnimated={false}
                        isStreaming={isStreaming}
                        disableStreamAnimation={chatRenderMode === 'sorted'}
                        variant="assistant"
                        enableFileReferences={isFinalized}
                    />
                );
            })}
        </div>
    );
};

export default React.memo(AssistantTextPart);

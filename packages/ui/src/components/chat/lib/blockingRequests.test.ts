import { describe, expect, test } from 'bun:test';
import type { QuestionRequest } from '@/types/question';
import {
    collectVisibleToolRequestKeys,
    getToolPartRequestKey,
    getToolRequestKey,
    splitBlockingRequestsByVisibleTool,
} from './blockingRequests';

describe('blocking request tool anchoring', () => {
    test('uses tool callID instead of part id when matching visible tool requests', () => {
        const visibleKeys = collectVisibleToolRequestKeys([
            {
                info: { id: 'msg-1' },
                parts: [
                    {
                        id: 'part-1',
                        sessionID: 'ses-1',
                        type: 'tool',
                        messageID: 'msg-1',
                        callID: 'call-1',
                        tool: 'question',
                        state: {
                            status: 'running',
                            input: {},
                            time: { start: 1 },
                        },
                    },
                ],
            },
        ]);

        const question: QuestionRequest = {
            id: 'que-1',
            sessionID: 'ses-1',
            questions: [],
            tool: {
                messageID: 'msg-1',
                callID: 'call-1',
            },
        };
        const split = splitBlockingRequestsByVisibleTool([question], [], visibleKeys);

        expect(visibleKeys.has(getToolRequestKey('msg-1', 'call-1'))).toBe(true);
        expect(visibleKeys.has(getToolRequestKey('msg-1', 'part-1'))).toBe(false);
        expect(split.inlineByTool.get(getToolRequestKey('msg-1', 'call-1'))?.questions).toEqual([question]);
        expect(split.trailingQuestions).toEqual([]);
    });

    test('falls back to part id for older tool records without callID', () => {
        expect(getToolPartRequestKey('msg-1', { id: 'part-1', messageID: 'msg-2' })).toBe(
            getToolRequestKey('msg-2', 'part-1'),
        );
    });
});

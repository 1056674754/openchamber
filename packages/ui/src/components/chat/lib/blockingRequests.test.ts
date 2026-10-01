import { describe, expect, test } from 'bun:test';
import type { FormRequest } from '@/types/form';
import {
    collectVisibleToolRequestKeys,
    getToolPartRequestKey,
    getToolRequestKey,
    splitBlockingRequestsByVisibleTool,
} from './blockingRequests';

describe('blocking request tool anchoring', () => {
    test('indexes both tool callID and part id when matching visible tool requests', () => {
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

        const question: FormRequest = {
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
        expect(visibleKeys.has(getToolRequestKey('msg-1', 'part-1'))).toBe(true);
        expect(split.inlineByTool.get(getToolRequestKey('msg-1', 'call-1'))?.forms).toEqual([question]);
        expect(split.trailingForms).toEqual([]);
    });

    test('matches pending requests that use the rendered part id as call id', () => {
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

        const question: FormRequest = {
            id: 'que-1',
            sessionID: 'ses-1',
            questions: [],
            tool: {
                messageID: 'msg-1',
                callID: 'part-1',
            },
        };
        const split = splitBlockingRequestsByVisibleTool([question], [], visibleKeys);

        expect(split.inlineByTool.get(getToolRequestKey('msg-1', 'part-1'))?.forms).toEqual([question]);
        expect(split.trailingForms).toEqual([]);
    });

    test('renders the same pending question request only once', () => {
        const visibleKey = getToolRequestKey('msg-1', 'call-1');
        const question: FormRequest = {
            id: 'que-1',
            sessionID: 'ses-1',
            questions: [],
            tool: {
                messageID: 'msg-1',
                callID: 'call-1',
            },
        };

        const split = splitBlockingRequestsByVisibleTool(
            [question, question],
            [],
            new Set([visibleKey]),
        );

        expect(split.inlineByTool.get(visibleKey)?.forms).toEqual([question]);
        expect(split.trailingForms).toEqual([]);
    });

    test('falls back to part id for older tool records without callID', () => {
        expect(getToolPartRequestKey('msg-1', { id: 'part-1', messageID: 'msg-2' })).toBe(
            getToolRequestKey('msg-2', 'part-1'),
        );
    });
});

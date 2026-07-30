import { describe, expect, test } from 'bun:test';

import {
    formatToolDuration,
    getStreamingOutputAppend,
    getToolOutput,
} from './toolOutput';

describe('tool output helpers', () => {
    test('keeps state output authoritative, including an empty completed output', () => {
        expect(getToolOutput('bash', 'complete', 'streaming')).toBe('complete');
        expect(getToolOutput('bash', '', 'streaming')).toBe('');
    });

    test('uses live metadata output only for Bash tools', () => {
        expect(getToolOutput('bash', undefined, 'line 1')).toBe('line 1');
        expect(getToolOutput('read', undefined, 'line 1')).toBe(undefined);
        expect(getToolOutput('bash', undefined, '')).toBe(undefined);
    });

    test('extracts appended text and rejects rewrites', () => {
        expect(getStreamingOutputAppend('line 1', 'line 1\nline 2')).toBe('\nline 2');
        expect(getStreamingOutputAppend('line 1', 'rewritten')).toBe(undefined);
        expect(getStreamingOutputAppend('long output', 'short')).toBe(undefined);
    });

    test('does not cap elapsed tool time at five minutes', () => {
        expect(formatToolDuration(0, 6 * 60 * 1000)).toBe('360.0s');
    });
});

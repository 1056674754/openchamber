import { describe, expect, test } from 'bun:test';

import {
    formatToolDuration,
    getStreamingOutputAppend,
    getToolOutput,
    renderTerminalOutput,
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

    test('applies terminal rewrites and strips ANSI and OSC sequences', () => {
        expect(renderTerminalOutput('progress 10%\rprogress 100%')).toBe('progress 100%');
        expect(renderTerminalOutput('abc\b\bXY')).toBe('aXY');
        expect(renderTerminalOutput('\u001B[31mred\u001B[0m')).toBe('red');
        expect(renderTerminalOutput('\u001B]0;secret title\u0007visible')).toBe('visible');
        expect(renderTerminalOutput('obsolete\r\u001B[2Kdone')).toBe('done');
    });

    test('normalizes completed Bash output without mutating live output', () => {
        const output = '\u001B[32mready\u001B[0m\rfinished';
        expect(getToolOutput('bash', output, undefined, 'completed')).toBe('finished');
        expect(getToolOutput('bash', output, undefined, 'running')).toBe(output);
        expect(getToolOutput('read', output, undefined, 'completed')).toBe(output);
    });

    test('does not cap elapsed tool time at five minutes', () => {
        expect(formatToolDuration(0, 6 * 60 * 1000)).toBe('360.0s');
    });
});

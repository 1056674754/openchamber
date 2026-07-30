import { describe, expect, test } from 'bun:test';

import { getStreamingThrottleText } from './useStreamingTextThrottle';

describe('getStreamingThrottleText', () => {
    test('preserves monotonic streaming text by default', () => {
        expect(getStreamingThrottleText('long output', 'short', true, false)).toBe('long output');
    });

    test('allows authoritative output rewrites when requested', () => {
        expect(getStreamingThrottleText('long output', 'short', true, true)).toBe('short');
        expect(getStreamingThrottleText('old output', 'rewritten output', true, true)).toBe('rewritten output');
    });
});

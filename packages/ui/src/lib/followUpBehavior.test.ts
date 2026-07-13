import { describe, expect, test } from 'bun:test';

import {
    resolveFollowUpAction,
    resolvePersistedFollowUpBehavior,
} from './followUpBehavior';

describe('resolvePersistedFollowUpBehavior', () => {
    test('prefers the new setting over legacy queue values', () => {
        expect(resolvePersistedFollowUpBehavior('steer', true)).toBe('steer');
        expect(resolvePersistedFollowUpBehavior('queue', false)).toBe('queue');
    });

    test('migrates legacy queue and immediate values', () => {
        expect(resolvePersistedFollowUpBehavior(undefined, true)).toBe('queue');
        expect(resolvePersistedFollowUpBehavior(undefined, false)).toBe('steer');
        expect(resolvePersistedFollowUpBehavior('immediate', undefined)).toBe('steer');
    });

    test('defaults new installations to steer', () => {
        expect(resolvePersistedFollowUpBehavior(undefined, undefined)).toBe('steer');
    });
});

describe('resolveFollowUpAction', () => {
    test('uses normal delivery whenever the session is idle', () => {
        expect(resolveFollowUpAction({
            behavior: 'queue',
            canQueue: false,
            alternate: false,
        })).toBe('normal');
        expect(resolveFollowUpAction({
            behavior: 'steer',
            canQueue: false,
            alternate: true,
        })).toBe('normal');
    });

    test('uses the selected busy behavior and swaps it for the alternate shortcut', () => {
        expect(resolveFollowUpAction({
            behavior: 'queue',
            canQueue: true,
            alternate: false,
        })).toBe('queue');
        expect(resolveFollowUpAction({
            behavior: 'queue',
            canQueue: true,
            alternate: true,
        })).toBe('steer');
        expect(resolveFollowUpAction({
            behavior: 'steer',
            canQueue: true,
            alternate: false,
        })).toBe('steer');
        expect(resolveFollowUpAction({
            behavior: 'steer',
            canQueue: true,
            alternate: true,
        })).toBe('queue');
    });
});

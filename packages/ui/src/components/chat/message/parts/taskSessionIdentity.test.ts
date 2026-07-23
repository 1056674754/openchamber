import { describe, expect, test } from 'bun:test';

import {
    readTaskSessionIdFromRecord,
    resolveAuthoritativeTaskSessionId,
} from './taskSessionIdentity';

describe('taskSessionIdentity', () => {
    test('prefers the live OpenCode task metadata identity', () => {
        expect(resolveAuthoritativeTaskSessionId({
            stateMetadata: { sessionId: 'child-live' },
            partMetadata: { sessionID: 'child-persisted' },
            parsedOutputSessionId: 'child-metadata-block',
            outputSessionId: 'child-output',
        })).toBe('child-live');
    });

    test('supports explicit IDs from older persisted task records', () => {
        expect(resolveAuthoritativeTaskSessionId({
            stateMetadata: {},
            partMetadata: { sessionID: ' child-persisted ' },
            parsedOutputSessionId: 'child-metadata-block',
            outputSessionId: 'child-output',
        })).toBe('child-persisted');

        expect(readTaskSessionIdFromRecord({ sessionId: ' child-part ' })).toBe('child-part');
    });

    test('uses the resumed task id when an interrupted task has no output metadata', () => {
        expect(resolveAuthoritativeTaskSessionId({
            stateMetadata: {},
            partMetadata: {},
            stateInput: { task_id: ' ses_resumed_child ' },
        })).toBe('ses_resumed_child');
    });

    test('does not invent an identity when no explicit source contains one', () => {
        expect(resolveAuthoritativeTaskSessionId({
            stateMetadata: {},
            partMetadata: null,
            parsedOutputSessionId: ' ',
        })).toBe(undefined);
    });
});

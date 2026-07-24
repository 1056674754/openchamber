import { describe, expect, test } from 'bun:test';

import { shouldMaterializeTaskDetails } from './taskToolVisibility';

describe('shouldMaterializeTaskDetails', () => {
    test('keeps completed historical tasks collapsed until the user expands them', () => {
        expect(shouldMaterializeTaskDetails({
            isExpanded: false,
            streamPhase: 'completed',
        })).toBe(false);

        expect(shouldMaterializeTaskDetails({
            isExpanded: true,
            streamPhase: 'completed',
        })).toBe(true);
    });

    test('keeps live task details visible while the turn is active', () => {
        expect(shouldMaterializeTaskDetails({
            isExpanded: false,
            streamPhase: 'streaming',
        })).toBe(true);

        expect(shouldMaterializeTaskDetails({
            isExpanded: false,
            streamPhase: 'cooldown',
        })).toBe(true);
    });
});

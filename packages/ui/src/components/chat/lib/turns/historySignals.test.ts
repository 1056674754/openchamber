import { describe, expect, test } from 'bun:test';

import { deriveTimelineHistorySignals } from './historySignals';

describe('deriveTimelineHistorySignals', () => {
    test('does not expose a server cursor when raw messages fill a page but the visible turn window is sparse', () => {
        const signals = deriveTimelineHistorySignals({
            historyMeta: { complete: false, loading: false },
            loadedMessageCount: 150,
            loadedRealUserGroupCount: 7,
            turnStart: 0,
            defaultHistoryLimit: 200,
            initialTurns: 40,
        });

        expect(signals.hasMoreAboveTurns).toBe(false);
        expect(signals.canLoadEarlier).toBe(false);
    });

    test('keeps the server history cursor actionable once the visible turn window is full', () => {
        const signals = deriveTimelineHistorySignals({
            historyMeta: { complete: false, loading: false },
            loadedMessageCount: 150,
            loadedRealUserGroupCount: 40,
            turnStart: 0,
            defaultHistoryLimit: 200,
            initialTurns: 40,
        });

        expect(signals.hasMoreAboveTurns).toBe(true);
        expect(signals.canLoadEarlier).toBe(true);
    });

    test('does not infer more history from a full page when no loaded turns are hidden', () => {
        const signals = deriveTimelineHistorySignals({
            historyMeta: null,
            loadedMessageCount: 200,
            loadedRealUserGroupCount: 4,
            turnStart: 0,
            defaultHistoryLimit: 200,
            initialTurns: 20,
        });

        expect(signals.hasMoreAboveTurns).toBe(false);
        expect(signals.canLoadEarlier).toBe(false);
    });

    test('allows revealing buffered turns independently of server completion', () => {
        const signals = deriveTimelineHistorySignals({
            historyMeta: { complete: true, loading: false },
            loadedMessageCount: 200,
            loadedRealUserGroupCount: 40,
            turnStart: 20,
            defaultHistoryLimit: 200,
            initialTurns: 20,
        });

        expect(signals.hasBufferedTurns).toBe(true);
        expect(signals.hasMoreAboveTurns).toBe(false);
        expect(signals.canLoadEarlier).toBe(true);
    });
});

import React from 'react';
import { projectTurnRecords } from '../lib/turns/projectTurnRecords';
import type { ChatMessageEntry, TurnProjectionResult, TurnRecord } from '../lib/turns/types';
import { streamPerfMeasure } from '@/stores/utils/streamDebug';

interface UseTurnRecordsOptions {
    sessionKey?: string;
    showTextJustificationActivity: boolean;
}

export interface TurnRecordsResult {
    projection: TurnProjectionResult;
    staticTurns: TurnProjectionResult['turns'];
    streamingTurn: TurnProjectionResult['turns'][number] | undefined;
}

export const useTurnRecords = (
    messages: ChatMessageEntry[],
    options: UseTurnRecordsOptions,
): TurnRecordsResult => {
    const previousProjectionRef = React.useRef<TurnProjectionResult | null>(null);
    const staticTurnsRef = React.useRef<TurnRecord[]>([]);
    const streamingTurnRef = React.useRef<TurnRecord | undefined>(undefined);
    const previousSessionKeyRef = React.useRef<string | undefined>(options.sessionKey);

    if (previousSessionKeyRef.current !== options.sessionKey) {
        previousSessionKeyRef.current = options.sessionKey;
        previousProjectionRef.current = null;
        staticTurnsRef.current = [];
        streamingTurnRef.current = undefined;
    }

    React.useEffect(() => {
        previousProjectionRef.current = null;
        staticTurnsRef.current = [];
        streamingTurnRef.current = undefined;
    }, [options.sessionKey, options.showTextJustificationActivity]);

    const projection = React.useMemo(() => {
        return streamPerfMeasure('ui.turns.projection_ms', () => {
            const nextProjection = projectTurnRecords(messages, {
                previousProjection: previousProjectionRef.current,
                showTextJustificationActivity: options.showTextJustificationActivity,
            });
            previousProjectionRef.current = nextProjection;
            return nextProjection;
        });
    }, [messages, options.showTextJustificationActivity]);

    const staticTurns = React.useMemo(() => {
        if (projection.turns.length === 0) {
            staticTurnsRef.current = [];
            return [];
        }

        const lastTurn = projection.turns[projection.turns.length - 1];

        // When the last turn is a directive, include ALL turns in staticTurns
        // so the grouping logic in MessageList can correctly attach it to its
        // parent real user turn for two-layer sticky rendering.
        const nextStatic = lastTurn.isDirectiveTurn
            ? projection.turns
            : projection.turns.length <= 1
                ? []
                : projection.turns.slice(0, -1);

        const previousStatic = staticTurnsRef.current;

        if (previousStatic.length === nextStatic.length) {
            let isSame = true;
            for (let index = 0; index < nextStatic.length; index += 1) {
                if (previousStatic[index] !== nextStatic[index]) {
                    isSame = false;
                    break;
                }
            }
            if (isSame) {
                return previousStatic;
            }
        }

        staticTurnsRef.current = nextStatic;
        return nextStatic;
    }, [projection.turns]);

    const streamingTurn = React.useMemo(() => {
        if (projection.turns.length === 0) {
            streamingTurnRef.current = undefined;
            return undefined;
        }

        const lastTurn = projection.turns[projection.turns.length - 1];

        // Directive turns must stay in staticTurns for grouping — they are
        // never the streaming turn.
        const nextStreamingTurn = lastTurn.isDirectiveTurn ? undefined : lastTurn;

        if (streamingTurnRef.current === nextStreamingTurn) {
            return streamingTurnRef.current;
        }
        streamingTurnRef.current = nextStreamingTurn;
        return nextStreamingTurn;
    }, [projection.turns]);

    return {
        projection,
        staticTurns,
        streamingTurn,
    };
};

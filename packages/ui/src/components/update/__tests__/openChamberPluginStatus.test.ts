import { describe, expect, test } from 'bun:test';

import {
    formatOpenChamberPluginStatusReason,
    normalizeOpenChamberPluginStatus,
    resolveOpenChamberPluginStatusDecision,
} from '../openChamberPluginStatus';

describe('OpenChamber plugin status decisions', () => {
    test('keeps not-checked status pending', () => {
        const status = normalizeOpenChamberPluginStatus({ loaded: false, reason: 'not-checked' });

        expect(status).not.toBeNull();
        expect(resolveOpenChamberPluginStatusDecision(status!)).toEqual({ kind: 'pending' });
    });

    test('treats live steer status as loaded', () => {
        const status = normalizeOpenChamberPluginStatus({
            loaded: true,
            features: { liveSteer: true, imageFallback: true },
        });

        expect(status).not.toBeNull();
        expect(resolveOpenChamberPluginStatusDecision(status!)).toEqual({ kind: 'loaded' });
    });

    test('reports an artifact-only tool gap as degraded without disabling live steer', () => {
        const status = normalizeOpenChamberPluginStatus({
            loaded: true,
            features: { liveSteer: true, imageFallback: true, artifactPublishing: false },
            missingTools: ['publish_artifact'],
        });

        expect(status).not.toBeNull();
        const decision = resolveOpenChamberPluginStatusDecision(status!);
        expect(decision.kind).toBe('degraded');
        expect(decision.kind === 'degraded' ? decision.reason : '').toBe(
            'missing tools: publish_artifact',
        );
    });

    test('fails loaded=true payloads that do not prove live steer is active', () => {
        const status = normalizeOpenChamberPluginStatus({
            loaded: true,
            features: { imageFallback: true },
        });

        expect(status).not.toBeNull();
        const decision = resolveOpenChamberPluginStatusDecision(status!);
        expect(decision.kind).toBe('failed');
        expect(decision.kind === 'failed' ? decision.reason : '').toBe('missing features: liveSteer');
    });

    test('includes missing tools and runtime features in the failure reason', () => {
        const status = normalizeOpenChamberPluginStatus({
            loaded: false,
            reason: 'plugin not fully loaded',
            missingTools: ['describe_image'],
            missingFeatures: ['liveSteer'],
        });

        expect(status).not.toBeNull();
        expect(formatOpenChamberPluginStatusReason(status!)).toBe(
            'plugin not fully loaded; missing tools: describe_image; missing features: liveSteer',
        );
    });
});

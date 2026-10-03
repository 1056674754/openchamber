export type OpenChamberPluginStatus = {
    readonly loaded: boolean;
    readonly reason?: string;
    readonly tools?: readonly string[];
    readonly missingTools?: readonly string[];
    readonly missingFeatures?: readonly string[];
    readonly checkedAt?: string;
    readonly features?: Record<string, boolean>;
    readonly runtime?: unknown;
    /** Track the server used for the check (spine finale): the v2 probe reads
     *  the server's plugin inventory and does not report v1 hook features. */
    readonly protocolMode?: 'v1' | 'v2';
};

export type OpenChamberPluginStatusDecision =
    | { readonly kind: 'pending' }
    | { readonly kind: 'loaded' }
    | { readonly kind: 'degraded'; readonly reason: string; readonly copyText: string }
    | { readonly kind: 'failed'; readonly reason: string; readonly copyText: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter((item): item is string => typeof item === 'string');
}

function booleanRecord(value: unknown): Record<string, boolean> | undefined {
    if (!isRecord(value)) return undefined;
    const next: Record<string, boolean> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'boolean') next[key] = entry;
    }
    return next;
}

export function normalizeOpenChamberPluginStatus(raw: unknown): OpenChamberPluginStatus | null {
    if (!isRecord(raw) || typeof raw.loaded !== 'boolean') return null;
    return {
        loaded: raw.loaded,
        ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
        ...(typeof raw.checkedAt === 'string' ? { checkedAt: raw.checkedAt } : {}),
        ...(raw.runtime === undefined ? {} : { runtime: raw.runtime }),
        ...(raw.protocolMode === 'v1' || raw.protocolMode === 'v2' ? { protocolMode: raw.protocolMode } : {}),
        ...(stringArray(raw.tools) ? { tools: stringArray(raw.tools) } : {}),
        ...(stringArray(raw.missingTools) ? { missingTools: stringArray(raw.missingTools) } : {}),
        ...(stringArray(raw.missingFeatures) ? { missingFeatures: stringArray(raw.missingFeatures) } : {}),
        ...(booleanRecord(raw.features) ? { features: booleanRecord(raw.features) } : {}),
    };
}

export function formatOpenChamberPluginStatusReason(status: OpenChamberPluginStatus): string {
    const details: string[] = [];
    // The v2 probe reads the server's plugin inventory; the v1 hook features
    // (liveSteer) are not part of its contract, so their absence is not a gap.
    const v2WithoutFeatureReport = status.protocolMode === 'v2' && !status.features;

    if (status.reason && status.reason !== 'not-checked') {
        details.push(status.reason);
    }
    if (status.missingTools && status.missingTools.length > 0) {
        details.push(`missing tools: ${status.missingTools.join(', ')}`);
    }
    if (status.missingFeatures && status.missingFeatures.length > 0) {
        details.push(`missing features: ${status.missingFeatures.join(', ')}`);
    }
    if (status.loaded && status.features?.liveSteer !== true && !v2WithoutFeatureReport) {
        details.push('missing features: liveSteer');
    }

    return Array.from(new Set(details)).join('; ') || 'unknown failure';
}

export function formatOpenChamberPluginStatusCopyText(status: OpenChamberPluginStatus): string {
    return JSON.stringify(status, null, 2);
}

export function resolveOpenChamberPluginStatusDecision(
    status: OpenChamberPluginStatus,
): OpenChamberPluginStatusDecision {
    if (!status.loaded && status.reason === 'not-checked') {
        return { kind: 'pending' };
    }
    const featureReportSatisfied = status.features?.liveSteer === true
        || (status.protocolMode === 'v2' && !status.features);
    if (status.loaded && featureReportSatisfied) {
        if (status.missingTools && status.missingTools.length > 0) {
            return {
                kind: 'degraded',
                reason: formatOpenChamberPluginStatusReason(status),
                copyText: formatOpenChamberPluginStatusCopyText(status),
            };
        }
        return { kind: 'loaded' };
    }
    return {
        kind: 'failed',
        reason: formatOpenChamberPluginStatusReason(status),
        copyText: formatOpenChamberPluginStatusCopyText(status),
    };
}

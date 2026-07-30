export const getToolOutput = (
    tool: string,
    stateOutput: unknown,
    metadataOutput: unknown,
): string | undefined => {
    if (typeof stateOutput === 'string') {
        return stateOutput;
    }
    if (tool === 'bash' && typeof metadataOutput === 'string' && metadataOutput.length > 0) {
        return metadataOutput;
    }
    return undefined;
};

export const getStreamingOutputAppend = (previous: string, next: string): string | undefined => (
    next.startsWith(previous) ? next.slice(previous.length) : undefined
);

export const formatToolDuration = (start: number, end?: number, now: number = Date.now()): string => {
    const duration = Math.max(0, (end ?? now) - start);
    const seconds = duration / 1000;
    const displaySeconds = seconds < 0.05 && end !== undefined ? 0.1 : seconds;
    return `${displaySeconds.toFixed(1)}s`;
};

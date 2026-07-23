const normalizeTaskSessionId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

export const readTaskSessionIdFromRecord = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    return normalizeTaskSessionId(record.sessionID) ?? normalizeTaskSessionId(record.sessionId);
};

const readTaskSessionIdFromInput = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    return normalizeTaskSessionId(record.task_id) ?? normalizeTaskSessionId(record.taskId);
};

type TaskSessionIdentitySources = {
    stateMetadata: unknown;
    partMetadata: unknown;
    stateInput?: unknown;
    parsedOutputSessionId?: string;
    outputSessionId?: string;
};

export const resolveAuthoritativeTaskSessionId = ({
    stateMetadata,
    partMetadata,
    stateInput,
    parsedOutputSessionId,
    outputSessionId,
}: TaskSessionIdentitySources): string | undefined => {
    return (
        readTaskSessionIdFromRecord(stateMetadata)
        ?? readTaskSessionIdFromRecord(partMetadata)
        ?? readTaskSessionIdFromInput(stateInput)
        ?? normalizeTaskSessionId(parsedOutputSessionId)
        ?? normalizeTaskSessionId(outputSessionId)
    );
};

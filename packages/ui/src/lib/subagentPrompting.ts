export const resolvePromptReadOnly = (
    readOnly: boolean,
    hasParentSession: boolean,
    allowPromptingSubagentSessions: boolean,
): boolean => {
    if (hasParentSession) {
        return !allowPromptingSubagentSessions;
    }

    return readOnly;
};

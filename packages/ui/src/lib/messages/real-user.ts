import type { Part } from '@opencode-ai/sdk/v2';

import { isSystemDirectiveMessage } from './system-directive';

export const hasSubtaskPart = (parts: Part[] | undefined): boolean => {
    if (!Array.isArray(parts)) {
        return false;
    }

    return parts.some((part) => part?.type === 'subtask');
};

export const hasRealUserMessageParts = (parts: Part[] | undefined): boolean => {
    return !isSystemDirectiveMessage(parts) && !hasSubtaskPart(parts);
};

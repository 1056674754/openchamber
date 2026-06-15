export type QuestionDraftSnapshot = {
    readonly activeTab: string;
    readonly selectedOptions: Record<number, string[]>;
    readonly customMode: Record<number, boolean>;
    readonly customText: Record<number, string>;
};

type QuestionDraftStorage = {
    readonly getItem: (key: string) => string | null;
    readonly setItem: (key: string, value: string) => void;
    readonly removeItem: (key: string) => void;
};

const DRAFT_PREFIX = 'openchamber:question-card-draft:v1:';
const HANDLED_PREFIX = 'openchamber:question-card-handled:v1:';
const HANDLED_TOOL_PREFIX = 'openchamber:question-card-handled-tool:v1:';

const keyFor = (prefix: string, questionId: string): string => `${prefix}${encodeURIComponent(questionId)}`;

const toolKeyFor = (tool: { messageID: string; callID: string }): string => (
    `${HANDLED_TOOL_PREFIX}${encodeURIComponent(tool.messageID)}:${encodeURIComponent(tool.callID)}`
);

const getBrowserStorage = (): QuestionDraftStorage | null => {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const parseIndex = (key: string): number | null => {
    if (!/^\d+$/.test(key)) return null;
    const parsed = Number(key);
    return Number.isSafeInteger(parsed) ? parsed : null;
};

const parseStringArrayRecord = (value: unknown): Record<number, string[]> => {
    const result: Record<number, string[]> = {};
    if (!isPlainObject(value)) return result;

    for (const [key, entry] of Object.entries(value)) {
        const index = parseIndex(key);
        if (index === null || !Array.isArray(entry)) continue;
        const strings = entry.filter((item): item is string => typeof item === 'string');
        if (strings.length > 0) {
            result[index] = strings;
        }
    }

    return result;
};

const parseBooleanRecord = (value: unknown): Record<number, boolean> => {
    const result: Record<number, boolean> = {};
    if (!isPlainObject(value)) return result;

    for (const [key, entry] of Object.entries(value)) {
        const index = parseIndex(key);
        if (index !== null && typeof entry === 'boolean') {
            result[index] = entry;
        }
    }

    return result;
};

const parseStringRecord = (value: unknown): Record<number, string> => {
    const result: Record<number, string> = {};
    if (!isPlainObject(value)) return result;

    for (const [key, entry] of Object.entries(value)) {
        const index = parseIndex(key);
        if (index !== null && typeof entry === 'string') {
            result[index] = entry;
        }
    }

    return result;
};

const hasMeaningfulDraft = (draft: QuestionDraftSnapshot): boolean => {
    if (draft.activeTab !== '0') return true;
    if (Object.values(draft.selectedOptions).some((answers) => answers.length > 0)) return true;
    if (Object.values(draft.customMode).some(Boolean)) return true;
    return Object.values(draft.customText).some((value) => value.trim().length > 0);
};

export const loadQuestionDraft = (
    questionId: string,
    storage: QuestionDraftStorage | null = getBrowserStorage(),
): QuestionDraftSnapshot | null => {
    if (!storage) return null;

    try {
        const raw = storage.getItem(keyFor(DRAFT_PREFIX, questionId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isPlainObject(parsed)) return null;

        const activeTab = typeof parsed.activeTab === 'string' && parsed.activeTab.length > 0
            ? parsed.activeTab
            : '0';

        return {
            activeTab,
            selectedOptions: parseStringArrayRecord(parsed.selectedOptions),
            customMode: parseBooleanRecord(parsed.customMode),
            customText: parseStringRecord(parsed.customText),
        };
    } catch {
        return null;
    }
};

export const saveQuestionDraft = (
    questionId: string,
    draft: QuestionDraftSnapshot,
    storage: QuestionDraftStorage | null = getBrowserStorage(),
): void => {
    if (!storage) return;

    try {
        const key = keyFor(DRAFT_PREFIX, questionId);
        if (!hasMeaningfulDraft(draft)) {
            storage.removeItem(key);
            return;
        }
        storage.setItem(key, JSON.stringify(draft));
    } catch {
        // Ignore localStorage quota and privacy-mode failures.
    }
};

export const clearQuestionDraft = (
    questionId: string,
    storage: QuestionDraftStorage | null = getBrowserStorage(),
): void => {
    if (!storage) return;

    try {
        storage.removeItem(keyFor(DRAFT_PREFIX, questionId));
    } catch {
        // Ignore localStorage privacy-mode failures.
    }
};

export const isQuestionHandled = (
    questionId: string,
    storage: QuestionDraftStorage | null = getBrowserStorage(),
): boolean => {
    if (!storage) return false;

    try {
        return storage.getItem(keyFor(HANDLED_PREFIX, questionId)) === '1';
    } catch {
        return false;
    }
};

export const markQuestionHandled = (
    questionId: string,
    storage: QuestionDraftStorage | null = getBrowserStorage(),
): void => {
    if (!storage) return;

    try {
        storage.setItem(keyFor(HANDLED_PREFIX, questionId), '1');
        storage.removeItem(keyFor(DRAFT_PREFIX, questionId));
    } catch {
        // Ignore localStorage quota and privacy-mode failures.
    }
};

export const isQuestionHandledByTool = (
    tool: { messageID: string; callID: string },
    storage: QuestionDraftStorage | null = getBrowserStorage(),
): boolean => {
    if (!storage) return false;

    try {
        return storage.getItem(toolKeyFor(tool)) === '1';
    } catch {
        return false;
    }
};

export const markQuestionHandledByTool = (
    tool: { messageID: string; callID: string },
    storage: QuestionDraftStorage | null = getBrowserStorage(),
): void => {
    if (!storage) return;

    try {
        storage.setItem(toolKeyFor(tool), '1');
    } catch {
        // Ignore localStorage quota and privacy-mode failures.
    }
};

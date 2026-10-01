export type FormDraftSnapshot = {
    readonly activeTab: string;
    readonly selectedOptions: Record<number, string[]>;
    readonly customMode: Record<number, boolean>;
    readonly customText: Record<number, string>;
};

type FormDraftStorage = {
    readonly getItem: (key: string) => string | null;
    readonly setItem: (key: string, value: string) => void;
    readonly removeItem: (key: string) => void;
};

const DRAFT_PREFIX = 'openchamber:question-card-draft:v1:';
const HANDLED_PREFIX = 'openchamber:question-card-handled:v1:';
const HANDLED_TOOL_PREFIX = 'openchamber:question-card-handled-tool:v1:';

const keyFor = (prefix: string, formId: string): string => `${prefix}${encodeURIComponent(formId)}`;

const toolKeyFor = (tool: { messageID: string; callID: string }): string => (
    `${HANDLED_TOOL_PREFIX}${encodeURIComponent(tool.messageID)}:${encodeURIComponent(tool.callID)}`
);

const getBrowserStorage = (): FormDraftStorage | null => {
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

const hasMeaningfulDraft = (draft: FormDraftSnapshot): boolean => {
    if (draft.activeTab !== '0') return true;
    if (Object.values(draft.selectedOptions).some((answers) => answers.length > 0)) return true;
    if (Object.values(draft.customMode).some(Boolean)) return true;
    return Object.values(draft.customText).some((value) => value.trim().length > 0);
};

export const loadFormDraft = (
    formId: string,
    storage: FormDraftStorage | null = getBrowserStorage(),
): FormDraftSnapshot | null => {
    if (!storage) return null;

    try {
        const raw = storage.getItem(keyFor(DRAFT_PREFIX, formId));
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

export const saveFormDraft = (
    formId: string,
    draft: FormDraftSnapshot,
    storage: FormDraftStorage | null = getBrowserStorage(),
): void => {
    if (!storage) return;

    try {
        const key = keyFor(DRAFT_PREFIX, formId);
        if (!hasMeaningfulDraft(draft)) {
            storage.removeItem(key);
            return;
        }
        storage.setItem(key, JSON.stringify(draft));
    } catch {
        // Ignore localStorage quota and privacy-mode failures.
    }
};

export const clearFormDraft = (
    formId: string,
    storage: FormDraftStorage | null = getBrowserStorage(),
): void => {
    if (!storage) return;

    try {
        storage.removeItem(keyFor(DRAFT_PREFIX, formId));
    } catch {
        // Ignore localStorage privacy-mode failures.
    }
};

export const isFormHandled = (
    formId: string,
    storage: FormDraftStorage | null = getBrowserStorage(),
): boolean => {
    if (!storage) return false;

    try {
        return storage.getItem(keyFor(HANDLED_PREFIX, formId)) === '1';
    } catch {
        return false;
    }
};

export const markFormHandled = (
    formId: string,
    storage: FormDraftStorage | null = getBrowserStorage(),
): void => {
    if (!storage) return;

    try {
        storage.setItem(keyFor(HANDLED_PREFIX, formId), '1');
        storage.removeItem(keyFor(DRAFT_PREFIX, formId));
    } catch {
        // Ignore localStorage quota and privacy-mode failures.
    }
};

export const isFormHandledByTool = (
    tool: { messageID: string; callID: string },
    storage: FormDraftStorage | null = getBrowserStorage(),
): boolean => {
    if (!storage) return false;

    try {
        return storage.getItem(toolKeyFor(tool)) === '1';
    } catch {
        return false;
    }
};

export const markFormHandledByTool = (
    tool: { messageID: string; callID: string },
    storage: FormDraftStorage | null = getBrowserStorage(),
): void => {
    if (!storage) return;

    try {
        storage.setItem(toolKeyFor(tool), '1');
    } catch {
        // Ignore localStorage quota and privacy-mode failures.
    }
};

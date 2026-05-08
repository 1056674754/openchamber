const EXPANDABLE_TOOL_NAMES = new Set<string>([
    'edit', 'multiedit', 'apply_patch', 'applypatch', 'str_replace', 'str_replace_based_edit_tool',
    'bash', 'shell', 'cmd', 'terminal',
    'write', 'create', 'file_write',
    'question', 'task',
]);

const STANDALONE_TOOL_NAMES = new Set<string>(['task']);

const SEARCH_TOOL_NAMES = new Set<string>(['grep', 'rg', 'search', 'find', 'ripgrep', 'glob']);
const READ_TOOL_NAMES = new Set<string>(['read', 'readfile', 'read_file', 'view', 'file_read', 'cat']);
const LIST_TOOL_NAMES = new Set<string>(['list', 'ls', 'dir', 'list_files', 'glob']);
const FETCH_TOOL_NAMES = new Set<string>(['webfetch', 'fetch', 'curl', 'wget']);
const WEB_SEARCH_TOOL_NAMES = new Set<string>([
    'web-search', 'websearch', 'search_web', 'codesearch',
    'google', 'bing', 'duckduckgo', 'perplexity',
]);

export const normalizeToolName = (toolName: unknown): string => {
    if (typeof toolName !== 'string') return '';
    const trimmed = toolName.trim().toLowerCase();
    if (!trimmed) return '';

    const withoutIndex = trimmed.replace(/:\d+$/, '');
    if (withoutIndex.includes('.')) {
        const parts = withoutIndex.split('.').filter(Boolean);
        return parts[parts.length - 1] ?? withoutIndex;
    }
    return withoutIndex;
};

export const isExpandableTool = (toolName: unknown): boolean => {
    return EXPANDABLE_TOOL_NAMES.has(normalizeToolName(toolName));
};

export const isStandaloneTool = (toolName: unknown): boolean => {
    return STANDALONE_TOOL_NAMES.has(normalizeToolName(toolName));
};

export const isStaticTool = (toolName: unknown): boolean => {
    if (typeof toolName !== 'string') return false;
    return !isExpandableTool(toolName) && !isStandaloneTool(toolName);
};

export const getStaticGroupToolName = (toolName: string): string => {
    const normalized = normalizeToolName(toolName);
    if (SEARCH_TOOL_NAMES.has(normalized)) {
        return 'grep';
    }
    if (READ_TOOL_NAMES.has(normalized)) {
        return 'read';
    }
    if (LIST_TOOL_NAMES.has(normalized)) {
        return 'list';
    }
    if (FETCH_TOOL_NAMES.has(normalized)) {
        return 'webfetch';
    }
    if (WEB_SEARCH_TOOL_NAMES.has(normalized)) {
        return 'websearch';
    }
    return normalized;
};

export type ToolCallCategory = 'read' | 'search' | 'list' | 'fetch' | 'websearch' | 'other';

export const getToolCallCategory = (toolName: string): ToolCallCategory => {
    const normalized = normalizeToolName(toolName);
    if (READ_TOOL_NAMES.has(normalized)) return 'read';
    if (SEARCH_TOOL_NAMES.has(normalized)) return 'search';
    if (LIST_TOOL_NAMES.has(normalized)) return 'list';
    if (FETCH_TOOL_NAMES.has(normalized)) return 'fetch';
    if (WEB_SEARCH_TOOL_NAMES.has(normalized)) return 'websearch';
    return 'other';
};

export interface ToolCallCategoryCount {
    category: ToolCallCategory;
    count: number;
}

export const buildToolCallSummary = (toolNames: string[]): ToolCallCategoryCount[] => {
    const order: ToolCallCategory[] = [];
    const counts = new Map<ToolCallCategory, number>();

    for (const name of toolNames) {
        const cat = getToolCallCategory(name);
        const existing = counts.get(cat);
        if (existing !== undefined) {
            counts.set(cat, existing + 1);
        } else {
            order.push(cat);
            counts.set(cat, 1);
        }
    }

    return order.map((category) => ({
        category,
        count: counts.get(category)!,
    }));
};

const CATEGORY_LABELS: Record<ToolCallCategory, { singular: string; plural: string }> = {
    read: { singular: '1 file read', plural: '{n} files read' },
    search: { singular: '1 search', plural: '{n} searches' },
    list: { singular: '1 directory listed', plural: '{n} directories listed' },
    fetch: { singular: '1 URL fetched', plural: '{n} URLs fetched' },
    websearch: { singular: '1 web search', plural: '{n} web searches' },
    other: { singular: '1 tool call', plural: '{n} tool calls' },
};

export const formatToolCallSummary = (counts: ToolCallCategoryCount[]): string => {
    return counts
        .map(({ category, count }) => {
            const label = CATEGORY_LABELS[category];
            const text = count === 1 ? label.singular : label.plural.replace('{n}', String(count));
            return text;
        })
        .join(' · ');
};

export const hasTextAfterPosition = (parts: Array<{ type: string }>, afterIndex: number): boolean => {
    for (let k = afterIndex + 1; k < parts.length; k++) {
        if (parts[k].type === 'text') return true;
    }
    return false;
};

export const hasTextBeforePosition = (parts: Array<{ type: string }>, beforeIndex: number): boolean => {
    for (let k = beforeIndex - 1; k >= 0; k--) {
        if (parts[k].type === 'text') return true;
    }
    return false;
};

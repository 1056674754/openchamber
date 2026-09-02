import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { resolveContextPanelStorageKey, useUIStore } from '@/stores/useUIStore';

/**
 * Storage key of the context-panel state the mounted surface should read and
 * write.
 *
 * Under the default 'directory' scope this is the normalized effective
 * directory (one panel per project). Under the 'session' scope it is the
 * active conversation's id, so each conversation keeps its own tabs, width
 * and open state; it falls back to the directory key while no conversation
 * is active. Always pass this key (or any directory — store actions resolve
 * the same key) to panel-state actions.
 */
export const useContextPanelKey = (): string => {
    const directory = useEffectiveDirectory();
    const sessionId = useSessionUIStore((s) => s.currentSessionId);
    const scope = useUIStore((s) => s.contextPanelScope);
    return resolveContextPanelStorageKey(directory ?? '', scope, sessionId);
};

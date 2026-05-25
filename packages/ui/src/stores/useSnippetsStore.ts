import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { opencodeClient } from '@/lib/opencode/client';
import { resolveBaseUrl } from '@/sync/session-actions';
import { useProjectsStore } from '@/stores/useProjectsStore';
import type { Snippet } from '@/types/snippet';

export type SnippetScope = 'global' | 'project';

export interface SnippetDraft {
  name: string;
  scope: SnippetScope;
  content?: string;
  aliases?: string[];
  description?: string;
}

interface SnippetsStore {
  snippets: Snippet[];
  isLoading: boolean;
  selectedSnippetName: string | null;
  snippetDraft: SnippetDraft | null;

  setSelectedSnippet: (name: string | null) => void;
  setSnippetDraft: (draft: SnippetDraft | null) => void;
  loadSnippets: (options?: { force?: boolean; serverBaseUrl?: string }) => Promise<boolean>;
  createSnippet: (name: string, content: string, options?: { aliases?: string[]; description?: string; scope?: SnippetScope }) => Promise<boolean>;
  updateSnippet: (name: string, updates: { content?: string; aliases?: string[]; description?: string }) => Promise<boolean>;
  deleteSnippet: (name: string) => Promise<boolean>;
  expandText: (text: string, options?: { directory?: string | null; serverBaseUrl?: string }) => Promise<string>;
  getSnippetByName: (name: string) => Snippet | undefined;
}

const SNIPPETS_LOAD_CACHE_TTL_MS = 5000;
const DEFAULT_SNIPPETS_CACHE_KEY = '__default__';
const snippetsLastLoadedAt = new Map<string, number>();
const snippetsLoadInFlight = new Map<string, Promise<boolean>>();

const getRequestDirectory = (): string | null => {
  try {
    const activeProject = useProjectsStore.getState().getActiveProject?.();
    if (activeProject?.path?.trim()) return activeProject.path.trim();
    const clientDir = opencodeClient.getDirectory();
    if (clientDir?.trim()) return clientDir.trim();
  } catch (error) {
    console.warn('[SnippetsStore] Error resolving config directory:', error);
  }
  return null;
};

const getSnippetsCacheKey = (directory: string | null, baseUrl?: string): string => {
  const dir = directory?.trim() || DEFAULT_SNIPPETS_CACHE_KEY;
  if (baseUrl) return `${baseUrl}::${dir}`;
  return dir;
};

const resolveSnippetsBaseUrl = (directory: string | null, explicitBaseUrl?: string): string | undefined => {
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/api\/?$/, '');
  if (!directory) return undefined;
  try {
    const url = resolveBaseUrl(directory);
    return url ? url.replace(/\/api\/?$/, '') : undefined;
  } catch {
    return undefined;
  }
};

const buildSnippetsRequest = (path: string, directory: string | null, baseUrl?: string) => {
  const separator = path.includes('?') ? '&' : '?';
  const directoryQuery = directory ? `${separator}directory=${encodeURIComponent(directory)}` : '';
  return {
    url: resolveApiUrl(`${path}${directoryQuery}`, baseUrl),
    headers: {
      ...(directory ? { 'x-opencode-directory': directory } : {}),
    },
  };
};

export const useSnippetsStore = create<SnippetsStore>()(
  devtools(
    (set, get) => ({
      snippets: [],
      isLoading: false,
      selectedSnippetName: null,
      snippetDraft: null,

      setSelectedSnippet: (name) => set({ selectedSnippetName: name }),
      setSnippetDraft: (draft) => set({ snippetDraft: draft }),

      loadSnippets: async (options) => {
        const directory = getRequestDirectory();
        const baseUrl = resolveSnippetsBaseUrl(directory, options?.serverBaseUrl);
        const cacheKey = getSnippetsCacheKey(directory, baseUrl);
        const now = Date.now();
        const loadedAt = snippetsLastLoadedAt.get(cacheKey) ?? 0;

        if (!options?.force && get().snippets.length > 0 && now - loadedAt < SNIPPETS_LOAD_CACHE_TTL_MS) return true;

        const inFlight = snippetsLoadInFlight.get(cacheKey);
        if (!options?.force && inFlight) return inFlight;

        const request = (async () => {
          set({ isLoading: true });
          try {
            const { url, headers } = buildSnippetsRequest('/api/config/snippets', directory, baseUrl);
            const response = await fetch(url, {
              headers: {
                'Cache-Control': 'no-cache',
                ...headers,
              },
            });
            if (!response.ok) throw new Error('Failed to load snippets');
            const snippets: Snippet[] = await response.json();
            set({ snippets, isLoading: false });
            snippetsLastLoadedAt.set(cacheKey, Date.now());
            return true;
          } catch (error) {
            console.error('[SnippetsStore] Failed to load:', error);
            set({ isLoading: false });
            return false;
          }
        })();

        snippetsLoadInFlight.set(cacheKey, request);
        try {
          return await request;
        } finally {
          snippetsLoadInFlight.delete(cacheKey);
        }
      },

      createSnippet: async (name, content, options = {}) => {
        const directory = getRequestDirectory();
        const baseUrl = resolveSnippetsBaseUrl(directory);
        try {
          const { url, headers } = buildSnippetsRequest(`/api/config/snippets/${encodeURIComponent(name)}`, directory, baseUrl);
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ content, aliases: options.aliases, description: options.description, scope: options.scope }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            if (response.status === 409) {
              return await get().updateSnippet(name, { content, aliases: options.aliases, description: options.description });
            }
            throw new Error(payload?.error || 'Failed to create snippet');
          }
          snippetsLastLoadedAt.delete(getSnippetsCacheKey(directory, baseUrl));
          await get().loadSnippets({ force: true, serverBaseUrl: baseUrl });
          return true;
        } catch (error) {
          console.error('[SnippetsStore] Failed to create:', error);
          return false;
        }
      },

      updateSnippet: async (name, updates) => {
        const directory = getRequestDirectory();
        const baseUrl = resolveSnippetsBaseUrl(directory);
        try {
          const { url, headers } = buildSnippetsRequest(`/api/config/snippets/${encodeURIComponent(name)}`, directory, baseUrl);
          const response = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(updates),
          });
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Failed to update snippet');
          snippetsLastLoadedAt.delete(getSnippetsCacheKey(directory, baseUrl));
          await get().loadSnippets({ force: true, serverBaseUrl: baseUrl });
          return true;
        } catch (error) {
          console.error('[SnippetsStore] Failed to update:', error);
          return false;
        }
      },

      deleteSnippet: async (name) => {
        const directory = getRequestDirectory();
        const baseUrl = resolveSnippetsBaseUrl(directory);
        try {
          const { url, headers } = buildSnippetsRequest(`/api/config/snippets/${encodeURIComponent(name)}`, directory, baseUrl);
          const response = await fetch(url, { method: 'DELETE', headers });
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Failed to delete snippet');
          if (get().selectedSnippetName === name) set({ selectedSnippetName: null });
          snippetsLastLoadedAt.delete(getSnippetsCacheKey(directory, baseUrl));
          await get().loadSnippets({ force: true, serverBaseUrl: baseUrl });
          return true;
        } catch (error) {
          console.error('[SnippetsStore] Failed to delete:', error);
          return false;
        }
      },

      expandText: async (text, options) => {
        if (!/#[a-z0-9_-]+/i.test(text)) return text;
        const directory = options?.directory?.trim() || getRequestDirectory();
        const baseUrl = resolveSnippetsBaseUrl(directory, options?.serverBaseUrl);
        const { url, headers } = buildSnippetsRequest('/api/config/snippets/expand', directory, baseUrl);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Failed to expand snippets');
        return (await response.json()).text ?? text;
      },

      getSnippetByName: (name) => get().snippets.find((snippet) => snippet.name === name || snippet.aliases.includes(name)),
    }),
    { name: 'snippets-store' },
  ),
);

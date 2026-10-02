import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { createDeferredSafeJSONStorage } from './utils/safeStorage';

type RootTabsState = {
  openPaths: string[];
  /** The file a single tree click opened as a preview; the next such click
      replaces it. Double-clicking it, editing it, or opening it any other way
      keeps it (clears this). */
  previewPath: string | null;
  selectedPath: string | null;
  expandedPaths: string[];
  touchedAt: number;
};

type FilesViewTabsState = {
  byRoot: Record<string, RootTabsState>;
};

type FilesViewTabsActions = {
  /** `preview` opens the path as the replaceable preview tab (a files-tree
      click); without it the path is pinned. */
  addOpenPath: (root: string, path: string, options?: { preview?: boolean }) => void;
  /** Turns a preview tab into a regular one. */
  pinOpenPath: (root: string, path: string) => void;
  removeOpenPath: (root: string, path: string) => void;
  removeOpenPathsByPrefix: (root: string, prefixPath: string) => void;
  removeExpandedPathsByPrefix: (root: string, prefixPath: string) => void;
  setSelectedPath: (root: string, path: string | null) => void;
  ensureSelectedPath: (root: string) => void;
  toggleExpandedPath: (root: string, path: string) => void;
  expandPath: (root: string, path: string) => void;
  expandPaths: (root: string, paths: string[]) => void;
};

export type FilesViewTabsStore = FilesViewTabsState & FilesViewTabsActions;

const normalizePath = (value: string): string => {
  if (!value) return '';

  const raw = value.replace(/\\/g, '/');
  const hadUncPrefix = raw.startsWith('//');

  let normalized = raw.replace(/\/+/g, '/');
  if (hadUncPrefix && !normalized.startsWith('//')) {
    normalized = `/${normalized}`;
  }

  const isUnixRoot = normalized === '/';
  const isWindowsDriveRoot = /^[A-Za-z]:\/$/.test(normalized);
  if (!isUnixRoot && !isWindowsDriveRoot) {
    normalized = normalized.replace(/\/+$/, '');
  }

  return normalized;
};

const toComparablePath = (value: string): string => {
  if (/^[A-Za-z]:\//.test(value)) {
    return value.toLowerCase();
  }
  return value;
};

export const isPathWithinRoot = (path: string, root: string): boolean => {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  if (!normalizedRoot || !normalizedPath) return false;

  // Trust caller-supplied (root, path) pairings when both are absolute Unix paths. On remote
  // instances the configured project root is frequently a symlink/bind-mount whose canonical
  // target differs in string form from the absolute paths the remote fs listing returns, so a
  // strict prefix check silently drops the open/select write while the guardless context-panel
  // tab still registers — leaving the editor stuck on "Pick a file from the tree". Callers are
  // file-tree clicks that already tie the path to the root, so the pairing is authoritative.
  if (normalizedRoot.startsWith('/') && normalizedPath.startsWith('/')) {
    return true;
  }

  const comparableRoot = toComparablePath(normalizedRoot);
  const comparablePath = toComparablePath(normalizedPath);
  return comparablePath === comparableRoot || comparablePath.startsWith(`${comparableRoot}/`);
};

const sanitizeByRoot = (input: unknown): Record<string, RootTabsState> => {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const source = input as Record<string, unknown>;
  const next: Record<string, RootTabsState> = {};

  for (const [rawRoot, rawState] of Object.entries(source)) {
    const root = normalizePath(rawRoot);
    if (!root || !rawState || typeof rawState !== 'object') {
      continue;
    }

    const state = rawState as {
      openPaths?: unknown;
      previewPath?: unknown;
      selectedPath?: unknown;
      expandedPaths?: unknown;
      touchedAt?: unknown;
    };

    const openPaths = Array.isArray(state.openPaths)
      ? Array.from(new Set(state.openPaths
        .filter((value): value is string => typeof value === 'string')
        .map((value) => normalizePath(value))
        .filter((value) => isPathWithinRoot(value, root))))
      : [];

    const previewPathCandidate = typeof state.previewPath === 'string'
      ? normalizePath(state.previewPath)
      : null;
    // A preview only exists while its tab does.
    const previewPath = previewPathCandidate && openPaths.some((p) => toComparablePath(p) === toComparablePath(previewPathCandidate))
      ? previewPathCandidate
      : null;

    const selectedPathCandidate = typeof state.selectedPath === 'string'
      ? normalizePath(state.selectedPath)
      : null;

    const selectedPath = selectedPathCandidate && isPathWithinRoot(selectedPathCandidate, root)
      ? selectedPathCandidate
      : (openPaths[0] ?? null);

    const expandedPaths = Array.isArray(state.expandedPaths)
      ? Array.from(new Set(state.expandedPaths
        .filter((value): value is string => typeof value === 'string')
        .map((value) => normalizePath(value))
        .filter((value) => isPathWithinRoot(value, root))))
      : [];

    const touchedAt = typeof state.touchedAt === 'number' && Number.isFinite(state.touchedAt)
      ? state.touchedAt
      : Date.now();

    const existing = next[root];
    if (existing) {
      const mergedOpenPaths = Array.from(new Set([...existing.openPaths, ...openPaths]));
      const mergedExpandedPaths = Array.from(new Set([...existing.expandedPaths, ...expandedPaths]));
      const mergedSelectedPath = existing.selectedPath ?? selectedPath ?? (mergedOpenPaths[0] ?? null);
      const existingPreview = existing.previewPath;
      const mergedPreviewPath = previewPath
        ?? (existingPreview && mergedOpenPaths.some((p) => toComparablePath(p) === toComparablePath(existingPreview))
          ? existingPreview
          : null);
      next[root] = {
        openPaths: mergedOpenPaths,
        previewPath: mergedPreviewPath,
        selectedPath: mergedSelectedPath,
        expandedPaths: mergedExpandedPaths,
        touchedAt: Math.max(existing.touchedAt, touchedAt),
      };
      continue;
    }

    next[root] = {
      openPaths,
      previewPath,
      selectedPath,
      expandedPaths,
      touchedAt,
    };
  }

  return next;
};

const clampRoots = (byRoot: Record<string, RootTabsState>, maxRoots: number): Record<string, RootTabsState> => {
  const entries = Object.entries(byRoot);
  if (entries.length <= maxRoots) {
    return byRoot;
  }

  entries.sort((a, b) => (b[1]?.touchedAt ?? 0) - (a[1]?.touchedAt ?? 0));
  const next: Record<string, RootTabsState> = {};
  for (const [root, state] of entries.slice(0, maxRoots)) {
    next[root] = state;
  }
  return next;
};

const touchRoot = (prev: RootTabsState | undefined): RootTabsState => {
  if (prev) {
    return { ...prev, touchedAt: Date.now() };
  }
  return { openPaths: [], previewPath: null, selectedPath: null, expandedPaths: [], touchedAt: Date.now() };
};

export const useFilesViewTabsStore = create<FilesViewTabsStore>()(
  devtools(
    persist(
      (set, get) => ({
        byRoot: {},

        addOpenPath: (root, path, options) => {
          const normalizedRoot = normalizePath((root || '').trim());
          const normalizedPath = normalizePath((path || '').trim());
          if (!normalizedRoot || !normalizedPath || !isPathWithinRoot(normalizedPath, normalizedRoot)) {
            return;
          }

          set((state) => {
            const prev = state.byRoot[normalizedRoot];
            const current = touchRoot(prev);
            const preview = options?.preview === true;
            const exists = current.openPaths.includes(normalizedPath);
            // A new preview takes the slot of the current preview, if any;
            // opening an already-open file leaves the tabs alone.
            const replacedPreviewPath = preview && !exists && current.previewPath
              && toComparablePath(current.previewPath) !== toComparablePath(normalizedPath)
              ? current.previewPath
              : null;
            const openPathsWithoutReplaced = replacedPreviewPath
              ? current.openPaths.filter((p) => toComparablePath(p) !== toComparablePath(replacedPreviewPath))
              : current.openPaths;
            const nextOpenPaths = exists ? openPathsWithoutReplaced : [...openPathsWithoutReplaced, normalizedPath];
            // Reopening a preview as a preview keeps it one; any other open pins it.
            const nextPreviewPath = preview
              ? (exists ? current.previewPath : normalizedPath)
              : null;
            const nextSelectedPath = current.selectedPath ?? normalizedPath;

            if (prev
              && exists
              && prev.selectedPath === nextSelectedPath
              && prev.previewPath === nextPreviewPath
              && nextOpenPaths === prev.openPaths) {
              return state;
            }
            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...current,
                openPaths: nextOpenPaths,
                previewPath: nextPreviewPath,
                selectedPath: nextSelectedPath,
              },
            };
            return { byRoot: clampRoots(byRoot, 20) };
          });
        },

        pinOpenPath: (root, path) => {
          const normalizedRoot = normalizePath((root || '').trim());
          const normalizedPath = normalizePath((path || '').trim());
          if (!normalizedRoot || !normalizedPath) {
            return;
          }

          set((state) => {
            const prev = state.byRoot[normalizedRoot];
            if (!prev?.previewPath || toComparablePath(prev.previewPath) !== toComparablePath(normalizedPath)) {
              return state;
            }
            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...prev,
                previewPath: null,
                touchedAt: Date.now(),
              },
            };
            return { byRoot: clampRoots(byRoot, 20) };
          });
        },

        removeOpenPath: (root, path) => {
          const normalizedRoot = normalizePath((root || '').trim());
          const normalizedPath = normalizePath((path || '').trim());
          if (!normalizedRoot || !normalizedPath) {
            return;
          }

          set((state) => {
            const current = state.byRoot[normalizedRoot];
            if (!current) {
              return state;
            }

            const comparablePath = toComparablePath(normalizedPath);
            const isMatchingPath = (candidate: string) => toComparablePath(candidate) === comparablePath;
            const selectedPathMatches = current.selectedPath ? isMatchingPath(current.selectedPath) : false;
            const previewMatches = current.previewPath ? isMatchingPath(current.previewPath) : false;
            if (!current.openPaths.some(isMatchingPath) && !selectedPathMatches) {
              return state;
            }

            const openPaths = current.openPaths.filter((p) => !isMatchingPath(p));
            const selectedPath = selectedPathMatches ? (openPaths[0] ?? null) : current.selectedPath;

            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...current,
                openPaths,
                previewPath: previewMatches ? null : current.previewPath,
                selectedPath,
                touchedAt: Date.now(),
              },
            };
            return { byRoot: clampRoots(byRoot, 20) };
          });
        },

        removeOpenPathsByPrefix: (root, prefixPath) => {
          const normalizedRoot = normalizePath((root || '').trim());
          const normalizedPrefix = normalizePath((prefixPath || '').trim());
          if (!normalizedRoot || !normalizedPrefix) {
            return;
          }

          set((state) => {
            const current = state.byRoot[normalizedRoot];
            if (!current) {
              return state;
            }

            const comparablePrefix = toComparablePath(normalizedPrefix);
            const comparablePrefixWithSlash = comparablePrefix.endsWith('/') ? comparablePrefix : `${comparablePrefix}/`;
            const isWithinPrefix = (candidate: string) => {
              const comparablePath = toComparablePath(candidate);
              return comparablePath === comparablePrefix || comparablePath.startsWith(comparablePrefixWithSlash);
            };
            const openPaths = current.openPaths.filter((p) => !isWithinPrefix(p));
            const expandedPaths = current.expandedPaths.filter((p) => !isWithinPrefix(p));
            const previewPath = current.previewPath && isWithinPrefix(current.previewPath) ? null : current.previewPath;
            if (openPaths.length === current.openPaths.length && expandedPaths.length === current.expandedPaths.length && previewPath === current.previewPath) {
              return state;
            }

            const selectedPath = current.selectedPath && isWithinPrefix(current.selectedPath)
              ? (openPaths[0] ?? null)
              : current.selectedPath;

            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...current,
                openPaths,
                previewPath,
                expandedPaths,
                selectedPath,
                touchedAt: Date.now(),
              },
            };

            return { byRoot: clampRoots(byRoot, 20) };
          });
        },

        removeExpandedPathsByPrefix: (root, prefixPath) => {
          const normalizedRoot = normalizePath((root || '').trim());
          const normalizedPrefix = normalizePath((prefixPath || '').trim());
          if (!normalizedRoot || !normalizedPrefix) {
            return;
          }

          set((state) => {
            const current = state.byRoot[normalizedRoot];
            if (!current) {
              return state;
            }

            const comparablePrefix = toComparablePath(normalizedPrefix);
            const comparablePrefixWithSlash = comparablePrefix.endsWith('/') ? comparablePrefix : `${comparablePrefix}/`;
            const expandedPaths = current.expandedPaths.filter((candidate) => {
              const comparablePath = toComparablePath(candidate);
              return comparablePath !== comparablePrefix && !comparablePath.startsWith(comparablePrefixWithSlash);
            });

            if (expandedPaths.length === current.expandedPaths.length) {
              return state;
            }

            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...current,
                expandedPaths,
                touchedAt: Date.now(),
              },
            };

            return { byRoot: clampRoots(byRoot, 20) };
          });
        },

        setSelectedPath: (root, path) => {
          const normalizedRoot = normalizePath((root || '').trim());
          const normalizedPath = path ? normalizePath(path.trim()) : null;
          if (!normalizedRoot || (normalizedPath && !isPathWithinRoot(normalizedPath, normalizedRoot))) {
            return;
          }

          set((state) => {
            const prev = state.byRoot[normalizedRoot];
            const current = touchRoot(prev);
            const openPaths = normalizedPath && !current.openPaths.includes(normalizedPath)
              ? [...current.openPaths, normalizedPath]
              : current.openPaths;

            if (prev && prev.selectedPath === normalizedPath && openPaths === prev.openPaths) {
              return state;
            }

            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...current,
                openPaths,
                selectedPath: normalizedPath,
              },
            };
            return { byRoot: clampRoots(byRoot, 20) };
          });
        },

        ensureSelectedPath: (root) => {
          const normalizedRoot = normalizePath((root || '').trim());
          if (!normalizedRoot) {
            return;
          }

          const current = get().byRoot[normalizedRoot];
          if (!current || current.selectedPath) {
            return;
          }

          const first = current.openPaths[0] ?? null;
          if (!first) {
            return;
          }

          get().setSelectedPath(normalizedRoot, first);
        },

        toggleExpandedPath: (root, path) => {
          const normalizedRoot = normalizePath((root || '').trim());
          const normalizedPath = normalizePath((path || '').trim());
          if (!normalizedRoot || !normalizedPath || !isPathWithinRoot(normalizedPath, normalizedRoot)) {
            return;
          }

          set((state) => {
            const prev = state.byRoot[normalizedRoot];
            const current = touchRoot(prev);
            const isExpanded = current.expandedPaths.includes(normalizedPath);
            const nextExpandedPaths = isExpanded
              ? current.expandedPaths.filter((p) => p !== normalizedPath)
              : [...current.expandedPaths, normalizedPath];

            if (prev && prev.expandedPaths === nextExpandedPaths && prev.selectedPath === current.selectedPath && prev.openPaths === current.openPaths) {
              return state;
            }

            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...current,
                expandedPaths: nextExpandedPaths,
              },
            };
            return { byRoot: clampRoots(byRoot, 20) };
          });
        },

        expandPath: (root, path) => {
          const normalizedRoot = normalizePath((root || '').trim());
          const normalizedPath = normalizePath((path || '').trim());
          if (!normalizedRoot || !normalizedPath || !isPathWithinRoot(normalizedPath, normalizedRoot)) {
            return;
          }

          set((state) => {
            const prev = state.byRoot[normalizedRoot];
            const current = touchRoot(prev);
            const isExpanded = current.expandedPaths.includes(normalizedPath);

            if (isExpanded && prev) {
              return state;
            }

            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...current,
                expandedPaths: [...current.expandedPaths, normalizedPath],
              },
            };
            return { byRoot: clampRoots(byRoot, 20) };
          });
        },

        expandPaths: (root, paths) => {
          const normalizedRoot = normalizePath((root || '').trim());
          if (!normalizedRoot || !paths || paths.length === 0) {
            return;
          }

          const normalizedPaths = paths
            .map((p) => normalizePath((p || '').trim()))
            .filter((p) => p && isPathWithinRoot(p, normalizedRoot));
          if (normalizedPaths.length === 0) {
            return;
          }

          set((state) => {
            const prev = state.byRoot[normalizedRoot];
            const current = touchRoot(prev);
            const existingPaths = new Set(current.expandedPaths);
            const newPaths = normalizedPaths.filter((p) => !existingPaths.has(p));

            if (newPaths.length === 0) {
              return state;
            }

            const byRoot = {
              ...state.byRoot,
              [normalizedRoot]: {
                ...current,
                expandedPaths: [...current.expandedPaths, ...newPaths],
              },
            };
            return { byRoot: clampRoots(byRoot, 20) };
          });
        },
      }),
      {
        name: 'files-view-tabs-store',
        version: 3,
        storage: createDeferredSafeJSONStorage(),
        migrate: (persistedState) => {
          if (!persistedState || typeof persistedState !== 'object') {
            return { byRoot: {} };
          }

          const rawByRoot = (persistedState as { byRoot?: unknown }).byRoot;
          return {
            byRoot: sanitizeByRoot(rawByRoot),
          };
        },
        partialize: (state) => ({ byRoot: state.byRoot }),
      }
    ),
    { name: 'files-view-tabs-store' }
  )
);

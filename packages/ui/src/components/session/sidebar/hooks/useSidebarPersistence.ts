import React from 'react';
import { updateDesktopSettings } from '@/lib/persistence';
import { useProjectsStore } from '@/stores/useProjectsStore';

type SafeStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

type Keys = {
  sessionExpanded: string;
  sessionExpandedLegacy: string;
  projectCollapse: string;
  groupOrder: string;
  projectActiveSession: string;
  groupCollapse: string;
};

const LEGACY_EXPANSION_CONTEXT_PREFIXES = [
  'project:active:',
  'project:archived:',
  'recent:active:',
  'recent:archived:',
  'global-pinned:active:',
  'global-pinned:archived:',
];

type Args = {
  isVSCode: boolean;
  safeStorage: SafeStorageLike;
  keys: Keys;
  groupOrderByProject: Map<string, string[]>;
  activeSessionByProject: Map<string, string>;
  collapsedGroups: Set<string>;
  setExpandedParents: React.Dispatch<React.SetStateAction<Set<string>>>;
  setCollapsedProjects: React.Dispatch<React.SetStateAction<Set<string>>>;
};

export const useSidebarPersistence = (args: Args) => {
  const {
    isVSCode,
    safeStorage,
    keys,
    groupOrderByProject,
    activeSessionByProject,
    collapsedGroups,
    setExpandedParents,
    setCollapsedProjects,
  } = args;

  const persistCollapsedProjectsTimer = React.useRef<number | null>(null);
  const pendingCollapsedProjects = React.useRef<Set<string> | null>(null);
  const hasHydratedProjectCollapseRef = React.useRef(false);
  const projectCollapseUserTouchedRef = React.useRef(false);
  const projectCollapseHydrationSignature = useProjectsStore((state) =>
    state.projects
      .map((project) => `${project.id}:${project.sidebarCollapsed === true ? '1' : project.sidebarCollapsed === false ? '0' : '-'}`)
      .join('|'),
  );

  const markProjectCollapseUserTouched = React.useCallback(() => {
    projectCollapseUserTouchedRef.current = true;
  }, []);

  const flushCollapsedProjectsPersist = React.useCallback(() => {
    if (isVSCode) {
      return;
    }
    const collapsed = pendingCollapsedProjects.current;
    pendingCollapsedProjects.current = null;
    persistCollapsedProjectsTimer.current = null;
    if (!collapsed) {
      return;
    }

    const { projects } = useProjectsStore.getState();
    const updatedProjects = projects.map((project) => ({
      ...project,
      sidebarCollapsed: collapsed.has(project.id),
    }));
    void updateDesktopSettings({ projects: updatedProjects }).catch(() => {});
  }, [isVSCode]);

  const scheduleCollapsedProjectsPersist = React.useCallback((collapsed: Set<string>) => {
    if (typeof window === 'undefined' || isVSCode) {
      return;
    }

    pendingCollapsedProjects.current = collapsed;
    if (persistCollapsedProjectsTimer.current !== null) {
      window.clearTimeout(persistCollapsedProjectsTimer.current);
    }
    persistCollapsedProjectsTimer.current = window.setTimeout(() => {
      flushCollapsedProjectsPersist();
    }, 700);
  }, [isVSCode, flushCollapsedProjectsPersist]);

  React.useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && persistCollapsedProjectsTimer.current !== null) {
        window.clearTimeout(persistCollapsedProjectsTimer.current);
      }
      persistCollapsedProjectsTimer.current = null;
      pendingCollapsedProjects.current = null;
    };
  }, []);

  React.useEffect(() => {
    try {
      const storedParents = safeStorage.getItem(keys.sessionExpanded);
      if (storedParents) {
        const parsed = JSON.parse(storedParents);
        if (Array.isArray(parsed)) {
          setExpandedParents(new Set(parsed.filter((item) => typeof item === 'string')));
        }
      } else {
        const legacyParents = safeStorage.getItem(keys.sessionExpandedLegacy);
        if (legacyParents) {
          try {
            const parsedLegacy = JSON.parse(legacyParents);
            if (Array.isArray(parsedLegacy)) {
              const migrated = new Set<string>();
              parsedLegacy.forEach((item) => {
                if (typeof item !== 'string' || item.length === 0) return;
                LEGACY_EXPANSION_CONTEXT_PREFIXES.forEach((prefix) => migrated.add(`${prefix}${item}`));
              });
              if (migrated.size > 0) {
                setExpandedParents(migrated);
                try {
                  safeStorage.setItem(keys.sessionExpanded, JSON.stringify(Array.from(migrated)));
                } catch {
                  // ignored
                }
              }
            }
          } catch {
            // ignored
          }
          try {
            safeStorage.removeItem?.(keys.sessionExpandedLegacy);
          } catch {
            // ignored
          }
        }
      }
    } catch {
      // ignored
    }
  }, [keys.sessionExpanded, keys.sessionExpandedLegacy, safeStorage, setExpandedParents]);

  React.useEffect(() => {
    if (hasHydratedProjectCollapseRef.current || projectCollapseUserTouchedRef.current) {
      return;
    }

    const { projects } = useProjectsStore.getState();
    if (projects.length === 0) {
      return;
    }

    let storedCollapsed: Set<string> | null = null;
    try {
      const storedProjects = safeStorage.getItem(keys.projectCollapse);
      if (storedProjects) {
        const parsed = JSON.parse(storedProjects);
        if (Array.isArray(parsed)) {
          storedCollapsed = new Set(parsed.filter((item): item is string => typeof item === 'string'));
        }
      }
    } catch {
      // ignored
    }

    const hasProjectCollapseState = projects.some((project) => typeof project.sidebarCollapsed === 'boolean');
    if (!storedCollapsed && !hasProjectCollapseState) {
      hasHydratedProjectCollapseRef.current = true;
      return;
    }

    hasHydratedProjectCollapseRef.current = true;
    setCollapsedProjects((prev) => {
      let changed = false;
      const next = new Set(storedCollapsed ?? prev);

      if (storedCollapsed) {
        if (storedCollapsed.size !== prev.size) {
          changed = true;
        } else {
          for (const id of storedCollapsed) {
            if (!prev.has(id)) {
              changed = true;
              break;
            }
          }
        }
      }

      projects.forEach((project) => {
        if (project.sidebarCollapsed === true) {
          if (!next.has(project.id)) {
            next.add(project.id);
            changed = true;
          }
        } else if (project.sidebarCollapsed === false && next.has(project.id)) {
          next.delete(project.id);
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [keys.projectCollapse, projectCollapseHydrationSignature, safeStorage, setCollapsedProjects]);

  React.useEffect(() => {
    try {
      const serialized = Object.fromEntries(groupOrderByProject.entries());
      safeStorage.setItem(keys.groupOrder, JSON.stringify(serialized));
    } catch {
      // ignored
    }
  }, [groupOrderByProject, keys.groupOrder, safeStorage]);

  React.useEffect(() => {
    try {
      const serialized = Object.fromEntries(activeSessionByProject.entries());
      safeStorage.setItem(keys.projectActiveSession, JSON.stringify(serialized));
    } catch {
      // ignored
    }
  }, [activeSessionByProject, keys.projectActiveSession, safeStorage]);

  React.useEffect(() => {
    try {
      safeStorage.setItem(keys.groupCollapse, JSON.stringify(Array.from(collapsedGroups)));
    } catch {
      // ignored
    }
  }, [collapsedGroups, keys.groupCollapse, safeStorage]);

  return { scheduleCollapsedProjectsPersist, markProjectCollapseUserTouched };
};

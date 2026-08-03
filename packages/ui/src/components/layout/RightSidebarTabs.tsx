import React from 'react';

import { SortableTabsStrip } from '@/components/ui/sortable-tabs-strip';
import { ProjectNotesTodoPanel } from '@/components/session/ProjectNotesTodoPanel';
import { GitView } from '@/components/views/GitView';
import { Icon } from "@/components/icon/Icon";
import { useGitStore } from '@/stores/useGitStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { formatDirectoryName } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SidebarFilesTree } from './SidebarFilesTree';

type RightTab = 'git' | 'files' | 'context';

/**
 * Keeps git status fresh while the right sidebar is open.
 * Replaces the GitPollingProvider removed in commit b2d5ccb4.
 * The previous polling ran globally; now we only refresh when the sidebar is open.
 */
function useRightSidebarGitSync(directory: string | undefined, isSidebarOpen: boolean) {
  const { git } = useRuntimeAPIs();
  const ensureStatus = useGitStore((state) => state.ensureStatus);
  // Hold git in a ref so the effect does not re-subscribe on every render. The runtime API
  // object can get a fresh reference each render; listing it as a dependency retriggers
  // ensureStatus immediately and forms a fetch loop (worst case: a git/check storm on non-git
  // remote directories). The API surface is stable for the app lifetime, so a ref is safe here.
  const gitRef = React.useRef(git);
  gitRef.current = git;

  React.useEffect(() => {
    if (!directory || !gitRef.current || !isSidebarOpen) return;

    void ensureStatus(directory, gitRef.current);

    const POLL_INTERVAL = 10_000;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void ensureStatus(directory, gitRef.current);
    }, POLL_INTERVAL);

    return () => clearInterval(id);
  }, [directory, isSidebarOpen, ensureStatus]);
}

export const ProjectContextPanel: React.FC = () => {
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const projects = useProjectsStore((state) => state.projects);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const gitDirectories = useGitStore((state) => state.directories);

  const activeProject = React.useMemo(() => {
    if (activeProjectId) {
      return projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
    }
    return projects[0] ?? null;
  }, [activeProjectId, projects]);

  const projectRef = React.useMemo(() => {
    if (!activeProject) {
      return null;
    }
    return {
      id: activeProject.id,
      path: activeProject.path,
    };
  }, [activeProject]);

  const projectLabel = React.useMemo(() => {
    if (!activeProject) {
      return null;
    }
    return activeProject.label?.trim()
      || formatDirectoryName(activeProject.path, homeDirectory)
      || activeProject.path;
  }, [activeProject, homeDirectory]);

  const canCreateWorktree = React.useMemo(() => {
    if (!activeProject) {
      return false;
    }
    return gitDirectories.get(activeProject.path)?.isGitRepo === true;
  }, [activeProject, gitDirectories]);

  return (
    <div className="h-full min-h-0 overflow-auto bg-sidebar">
      <ProjectNotesTodoPanel
        projectRef={projectRef}
        projectLabel={projectLabel}
        canCreateWorktree={canCreateWorktree}
      />
    </div>
  );
};

export const RightSidebarTabs: React.FC = () => {
  const { t } = useI18n();
  const rightSidebarTab = useUIStore((state) => state.rightSidebarTab);
  const setRightSidebarTab = useUIStore((state) => state.setRightSidebarTab);
  const isRightSidebarOpen = useUIStore((state) => state.isRightSidebarOpen);
  const directory = useEffectiveDirectory();

  useRightSidebarGitSync(directory, isRightSidebarOpen);

  const tabItems = React.useMemo(() => [
    {
      id: 'git',
      label: t('layout.rightSidebar.git'),
      icon: <Icon name="git-branch" className="h-3.5 w-3.5" />,
    },
    {
      id: 'files',
      label: t('layout.rightSidebar.files'),
      icon: <Icon name="folder-3" className="h-3.5 w-3.5" />,
    },
    {
      id: 'context',
      label: t('layout.rightSidebar.context'),
      icon: <Icon name="file-list-2" className="h-3.5 w-3.5" />,
    },
  ], [t]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
      <div className="h-9 bg-sidebar pt-1 px-2">
        <SortableTabsStrip
          items={tabItems}
          activeId={rightSidebarTab}
          onSelect={(tabID) => setRightSidebarTab(tabID as RightTab)}
          layoutMode="fit"
          variant="active-pill"
          className="h-full"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {rightSidebarTab === 'git' && <GitView />}
        {rightSidebarTab === 'files' && <SidebarFilesTree />}
        {rightSidebarTab === 'context' && <ProjectContextPanel />}
      </div>
    </div>
  );
};

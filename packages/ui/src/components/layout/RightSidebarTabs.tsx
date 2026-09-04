import React from 'react';

import { ProjectNotesTodoPanel } from '@/components/session/project-context/ProjectNotesTodoPanel';
import { useGitStore } from '@/stores/useGitStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { formatDirectoryName } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { resolveProjectForSessionDirectory } from '@/lib/projectResolution';
import { useSessionUIStore } from '@/sync/session-ui-store';
import {
  CHAT_DRAFT_PROJECT_ID,
  getChatsRootForHome,
  getChatsRootFromDirectory,
  isChatDirectoryPath,
} from '@/lib/chatDirectories';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';

export const ProjectContextPanel: React.FC = () => {
  const { t } = useI18n();
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const projects = useProjectsStore((state) => state.projects);
  const availableWorktreesByProject = useSessionUIStore((state) => state.availableWorktreesByProject);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const gitDirectories = useGitStore((state) => state.directories);
  const effectiveDirectory = useEffectiveDirectory();
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const draftOpen = useSessionUIStore((state) => state.newSessionDraft.open);
  const draftTarget = useSessionUIStore((state) => state.newSessionDraft.target);
  const draftChatServerId = useSessionUIStore((state) => state.newSessionDraft.chatServerId);
  const isChatContext = draftOpen
    ? draftTarget === 'chat'
    : isChatDirectoryPath(effectiveDirectory);
  const chatServerId = draftOpen
    ? (draftChatServerId ?? DEFAULT_SERVER_ID)
    : (currentSessionId ? serverRegistry.getServerForSession(currentSessionId) ?? DEFAULT_SERVER_ID : DEFAULT_SERVER_ID);
  const chatsRoot = getChatsRootFromDirectory(effectiveDirectory)
    ?? (chatServerId === DEFAULT_SERVER_ID ? getChatsRootForHome(homeDirectory) : null);

  const activeProject = React.useMemo(() => {
    if (isChatContext) return null;
    if (effectiveDirectory) {
      const owner = resolveProjectForSessionDirectory(
        projects,
        availableWorktreesByProject,
        effectiveDirectory,
      );
      if (owner) return owner;
    }
    if (!effectiveDirectory && activeProjectId) {
      return projects.find((project) => project.id === activeProjectId) ?? null;
    }
    return null;
  }, [activeProjectId, availableWorktreesByProject, effectiveDirectory, isChatContext, projects]);

  const projectRef = React.useMemo(() => {
    if (isChatContext && chatsRoot) {
      return {
        id: CHAT_DRAFT_PROJECT_ID,
        path: chatsRoot,
        serverId: chatServerId,
      };
    }
    if (!activeProject) {
      return null;
    }
    return {
      id: activeProject.id,
      path: activeProject.path,
      serverId: activeProject.serverId,
    };
  }, [activeProject, chatServerId, chatsRoot, isChatContext]);

  const projectLabel = React.useMemo(() => {
    if (isChatContext) return t('sessions.sidebar.activity.chatsTitle');
    if (!activeProject) {
      return null;
    }
    return activeProject.label?.trim()
      || formatDirectoryName(activeProject.path, homeDirectory)
      || activeProject.path;
  }, [activeProject, homeDirectory, isChatContext, t]);

  const canCreateWorktree = React.useMemo(() => {
    if (!activeProject) {
      return false;
    }
    return gitDirectories.get(activeProject.path)?.isGitRepo === true;
  }, [activeProject, gitDirectories]);

  return (
    <div className="h-full min-h-0 overflow-hidden bg-sidebar">
      <ProjectNotesTodoPanel
        projectRef={projectRef}
        projectLabel={projectLabel}
        canCreateWorktree={canCreateWorktree}
      />
    </div>
  );
};

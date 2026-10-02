import type { Session } from '@opencode-ai/sdk/v2';
import type { WorktreeMetadata } from '@/types/worktree';
import type { SpaceMark } from '@/lib/spaces/spaces-store';

export type SessionSummaryMeta = {
  additions?: number | string | null;
  deletions?: number | string | null;
  files?: number | null;
  diffs?: Array<{ additions?: number | string | null; deletions?: number | string | null }>;
};

export type SessionNode = {
  session: Session;
  children: SessionNode[];
  worktree: WorktreeMetadata | null;
};

export type SessionGroupFolderScope = {
  scopeKey: string;
  directory: string | null;
};

export type SessionGroup = {
  id: string;
  label: string;
  branch: string | null;
  description: string | null;
  isMain: boolean;
  isArchivedBucket?: boolean;
  worktree: WorktreeMetadata | null;
  /** The isolated space this group shows, with the state of its last answer (upstream 1290fd121). */
  space?: SpaceMark;
  directory: string | null;
  folderScopeKey?: string | null;
  folderScopes?: SessionGroupFolderScope[];
  /** [fork-port] Upstream v1.24.2: group-specific empty-state copy. */
  emptyMessage?: string;
  draftTarget?: 'chat' | 'project';
  sessions: SessionNode[];
};

export type GroupSearchData = {
  filteredNodes: SessionNode[];
  matchedSessionCount: number;
  folderNameMatchCount: number;
  groupMatches: boolean;
  hasMatch: boolean;
};

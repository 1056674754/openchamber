/**
 * Multi-Run Types
 *
 * Multi-Run starts the same prompt against multiple models in parallel,
 * each in its own git worktree and OpenCode session.
 */

export interface MultiRunModelSelection {
  providerID: string;
  modelID: string;
  displayName?: string;
  variant?: string;
}

export interface MultiRunFileAttachment {
  /** MIME type of the file */
  mime: string;
  /** Original filename */
  filename: string;
  /** Data URL (base64 encoded) */
  url: string;
}

export interface MultiRunGroup {
  /** Prompt sent to this group of sessions */
  prompt: string;
  /** Models to run against for this group */
  models: MultiRunModelSelection[];
  /** Files that belong to this prompt variant only (for example resolved @mentions). */
  files?: MultiRunFileAttachment[];
}

export interface MultiRunAutoFusion {
  providerID: string;
  modelID: string;
  variant?: string;
  agent?: string;
}

export interface CreateMultiRunParams {
  /** Group name used for worktree directory and branch naming */
  name: string;
  /** Human title shown in the sidebar and overview; defaults to `name`. */
  title?: string;
  /** Prompt/model groups to run */
  groups: MultiRunGroup[];
  /** Optional agent to use for all runs */
  agent?: string;
  /** Base branch for new branches (defaults to `HEAD`). */
  worktreeBaseBranch?: string;
  /** Whether Git projects should isolate each run in its own worktree. */
  isolateRuns?: boolean;
  /** Files to attach to all runs */
  files?: MultiRunFileAttachment[];
  /** Setup commands to run in each new worktree after creation */
  setupCommands?: string[];
  /** Fuse the lanes automatically once all of them finish. */
  autoFusion?: MultiRunAutoFusion;
}

export interface CreateMultiRunResult {
  /** Canonical group slug used in session titles */
  groupSlug: string;
  /** Identity key every lane of this run shares. */
  groupKey: string;
  /** Session IDs created successfully (in selection order) */
  sessionIds: string[];
  /** First successfully created session ID, if any */
  firstSessionId: string | null;
  /** Lanes that failed to start; the rest of the run is unaffected. */
  failedCount: number;
}

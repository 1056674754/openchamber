import type { GitDiffResponse } from './api/types';

export interface GetGitRangeDiffOptions {
  base: string;
  head: string;
  path?: string;
  contextLines?: number;
}

export interface GetGitRangeFilesOptions {
  base: string;
  head: string;
}

export interface GitRangeFileEntry {
  path: string;
  status: string;
}

export interface GitBranchBaseResponse {
  base: string | null;
}

declare module './api/types' {
  interface GitAPI {
    getGitRangeDiff?(directory: string, options: GetGitRangeDiffOptions): Promise<GitDiffResponse>;
    getGitRangeFiles?(directory: string, options: GetGitRangeFilesOptions): Promise<GitRangeFileEntry[]>;
    getBranchBase?(directory: string, branch: string): Promise<GitBranchBaseResponse>;
  }
}

export type TurnSnapshotDiff = {
  file?: string;
  status?: string;
  before?: string;
  after?: string;
  patch?: string;
  additions?: number;
  deletions?: number;
};

export type TurnSnapshotDiffData = {
  original: string;
  modified: string;
  isBinary?: boolean;
};

export const isBinaryPatch = (patch: string): boolean => (
  /^Binary files .+ differ$/m.test(patch) || /^GIT binary patch$/m.test(patch)
);

export const listTurnSnapshotDiffs = (value: unknown): TurnSnapshotDiff[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((diff): diff is TurnSnapshotDiff => {
    if (!diff || typeof diff !== 'object') return false;
    return typeof (diff as TurnSnapshotDiff).file === 'string'
      && ((diff as TurnSnapshotDiff).file as string).trim().length > 0;
  });
};

export const statusToGitCode = (status?: string): string => {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  if (status === 'renamed') return 'R';
  return 'M';
};

const joinPatchLines = (lines: Array<{ text: string; newline: boolean }>): string => {
  if (lines.length === 0) return '';
  let result = '';
  for (let index = 0; index < lines.length; index += 1) {
    result += lines[index].text;
    if (lines[index].newline) {
      result += '\n';
    }
  }
  return result;
};

/** Reconstruct before/after text from a single-hunk patch that starts at line 1. */
export const completePatchContents = (patch: string): { before: string; after: string } | undefined => {
  if (!patch.startsWith('diff --git ') && !/^--- [^\n]*\t?\r?\n\+\+\+ [^\n]*\t?(?:\r?\n|$)/m.test(patch)) {
    return undefined;
  }

  const hunkMatches = [...patch.matchAll(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@[^\n]*(?:\r?\n|$)/gm)];
  if (hunkMatches.length !== 1) {
    return undefined;
  }

  const hunk = hunkMatches[0];
  const oldStart = Number.parseInt(hunk[1] ?? '', 10);
  const newStart = Number.parseInt(hunk[2] ?? '', 10);
  if (oldStart > 1 || newStart > 1 || !Number.isFinite(oldStart) || !Number.isFinite(newStart)) {
    return undefined;
  }

  const hunkStart = (hunk.index ?? 0) + hunk[0].length;
  const body = patch.slice(hunkStart);
  const before: Array<{ text: string; newline: boolean }> = [];
  const after: Array<{ text: string; newline: boolean }> = [];
  let previous: '-' | '+' | ' ' | undefined;

  for (const rawLine of body.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ') || rawLine.startsWith('@@ ')) {
      break;
    }

    if (rawLine.startsWith('\\')) {
      if (previous === '-' || previous === ' ') {
        const value = before.at(-1);
        if (value) value.newline = false;
      }
      if (previous === '+' || previous === ' ') {
        const value = after.at(-1);
        if (value) value.newline = false;
      }
      continue;
    }

    if (rawLine.startsWith('-')) {
      before.push({ text: rawLine.slice(1), newline: true });
      previous = '-';
      continue;
    }

    if (rawLine.startsWith('+')) {
      after.push({ text: rawLine.slice(1), newline: true });
      previous = '+';
      continue;
    }

    if (!rawLine.startsWith(' ')) {
      continue;
    }

    before.push({ text: rawLine.slice(1), newline: true });
    after.push({ text: rawLine.slice(1), newline: true });
    previous = ' ';
  }

  return {
    before: joinPatchLines(before),
    after: joinPatchLines(after),
  };
};

/** Fallback: accumulate patch hunk body lines into approximate before/after text. */
export const approximateContentsFromPatch = (patch: string): { before: string; after: string } => {
  const before: string[] = [];
  const after: string[] = [];

  for (const rawLine of patch.split(/\r?\n/)) {
    if (
      rawLine.startsWith('diff --git ')
      || rawLine.startsWith('index ')
      || rawLine.startsWith('--- ')
      || rawLine.startsWith('+++ ')
      || rawLine.startsWith('@@ ')
      || rawLine.startsWith('\\')
    ) {
      continue;
    }

    if (rawLine.startsWith('-')) {
      before.push(rawLine.slice(1));
      continue;
    }
    if (rawLine.startsWith('+')) {
      after.push(rawLine.slice(1));
      continue;
    }
    if (rawLine.startsWith(' ')) {
      const text = rawLine.slice(1);
      before.push(text);
      after.push(text);
    }
  }

  return {
    before: before.join('\n'),
    after: after.join('\n'),
  };
};

export const turnSnapshotDiffToData = (diff: TurnSnapshotDiff): TurnSnapshotDiffData | null => {
  if (typeof diff.file !== 'string' || !diff.file.trim()) {
    return null;
  }

  if (typeof diff.patch === 'string' && isBinaryPatch(diff.patch)) {
    return { original: '', modified: '', isBinary: true };
  }

  if (typeof diff.before === 'string' || typeof diff.after === 'string') {
    return {
      original: diff.before ?? '',
      modified: diff.after ?? '',
    };
  }

  if (typeof diff.patch === 'string' && diff.patch.trim()) {
    const complete = completePatchContents(diff.patch);
    if (complete) {
      return { original: complete.before, modified: complete.after };
    }
    const approximate = approximateContentsFromPatch(diff.patch);
    return { original: approximate.before, modified: approximate.after };
  }

  return { original: '', modified: '' };
};

export const buildTurnSnapshotDiffDataMap = (
  diffs: readonly TurnSnapshotDiff[],
): Map<string, TurnSnapshotDiffData> => {
  const map = new Map<string, TurnSnapshotDiffData>();
  for (const diff of diffs) {
    if (!diff.file) continue;
    const data = turnSnapshotDiffToData(diff);
    if (!data) continue;
    map.set(diff.file, data);
  }
  return map;
};

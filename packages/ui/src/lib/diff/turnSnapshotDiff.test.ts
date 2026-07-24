import { describe, expect, test } from 'bun:test';
import {
  approximateContentsFromPatch,
  buildTurnSnapshotDiffDataMap,
  completePatchContents,
  isBinaryPatch,
  listTurnSnapshotDiffs,
  statusToGitCode,
  turnSnapshotDiffToData,
} from './turnSnapshotDiff';

describe('turnSnapshotDiff', () => {
  test('lists only diffs with non-empty file paths', () => {
    expect(listTurnSnapshotDiffs([
      { file: 'a.ts', additions: 1 },
      { file: '  ', additions: 1 },
      { additions: 1 },
      null,
    ])).toEqual([{ file: 'a.ts', additions: 1 }]);
  });

  test('maps status codes for git UI', () => {
    expect(statusToGitCode('added')).toBe('A');
    expect(statusToGitCode('deleted')).toBe('D');
    expect(statusToGitCode('renamed')).toBe('R');
    expect(statusToGitCode('modified')).toBe('M');
    expect(statusToGitCode(undefined)).toBe('M');
  });

  test('detects binary patches', () => {
    expect(isBinaryPatch('Binary files a and b differ\n')).toBe(true);
    expect(isBinaryPatch('GIT binary patch\n')).toBe(true);
    expect(isBinaryPatch('diff --git a/a.ts b/a.ts\n')).toBe(false);
  });

  test('reconstructs before/after from a single full-file hunk', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      ' same',
      '',
    ].join('\n');

    expect(completePatchContents(patch)).toEqual({
      before: 'old\nsame\n',
      after: 'new\nsame\n',
    });
  });

  test('falls back to approximate patch contents for multi-hunk patches', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '@@ -10,1 +10,1 @@',
      '-c',
      '+d',
      '',
    ].join('\n');

    expect(completePatchContents(patch)).toEqual(undefined);
    expect(approximateContentsFromPatch(patch)).toEqual({
      before: 'a\nc',
      after: 'b\nd',
    });
  });

  test('prefers explicit before/after, then patch reconstruction', () => {
    expect(turnSnapshotDiffToData({
      file: 'a.ts',
      before: 'one',
      after: 'two',
    })).toEqual({ original: 'one', modified: 'two' });

    expect(turnSnapshotDiffToData({
      file: 'b.ts',
      patch: 'Binary files a and b differ\n',
    })).toEqual({ original: '', modified: '', isBinary: true });

    const patch = [
      'diff --git a/c.ts b/c.ts',
      '--- a/c.ts',
      '+++ b/c.ts',
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
      '',
    ].join('\n');
    expect(turnSnapshotDiffToData({ file: 'c.ts', patch })).toEqual({
      original: 'x\n',
      modified: 'y\n',
    });
  });

  test('builds a path-keyed data map', () => {
    const map = buildTurnSnapshotDiffDataMap([
      { file: 'a.ts', before: '', after: 'created' },
      { file: 'b.ts', before: 'gone', after: '' },
      { file: '' },
    ]);
    expect(map.get('a.ts')).toEqual({ original: '', modified: 'created' });
    expect(map.get('b.ts')).toEqual({ original: 'gone', modified: '' });
    expect(map.has('')).toBe(false);
  });
});

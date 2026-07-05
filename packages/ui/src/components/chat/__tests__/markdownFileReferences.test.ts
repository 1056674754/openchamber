import { describe, expect, test } from 'bun:test';
import {
  findFileReferenceTextMatches,
  getResolvedReference,
  isLikelyFilePath,
  isResolvedFileReferenceWithinDirectory,
  parseFileReference,
  resolveMarkdownImageReference,
} from '../markdownFileReferences';

describe('markdown file reference heuristics', () => {
  test('does not treat IP endpoints as file references', () => {
    expect(isLikelyFilePath('43.154.84.58')).toBe(false);
    expect(isLikelyFilePath('43.154.84.58:9993')).toBe(false);
    expect(isLikelyFilePath('81.68.238.43:9993')).toBe(false);
    expect(getResolvedReference('43.154.84.58:9993', '/repo')).toBe(null);
  });

  test('does not treat bare domain-shaped tokens as file references', () => {
    expect(isLikelyFilePath('example.com')).toBe(false);
    expect(isLikelyFilePath('search.s-s.city')).toBe(false);
    expect(isLikelyFilePath('xxx.yyy')).toBe(false);
  });

  test('keeps common bare filenames and line references clickable', () => {
    expect(isLikelyFilePath('package.json')).toBe(true);
    expect(isLikelyFilePath('docker-compose.yml')).toBe(true);
    expect(isLikelyFilePath('MarkdownRendererImpl.tsx:872')).toBe(true);
    expect(parseFileReference('MarkdownRendererImpl.tsx:872')).toEqual({
      path: 'MarkdownRendererImpl.tsx',
      line: 872,
      column: undefined,
    });
  });

  test('keeps explicit paths with custom extensions discoverable', () => {
    expect(isLikelyFilePath('src/example.custom')).toBe(true);
    expect(isLikelyFilePath('./example.custom')).toBe(true);
    expect(isLikelyFilePath('../example.custom')).toBe(true);
  });

  test('keeps absolute references under hidden project folders scoped to their directory', () => {
    const directory = '/Users/song/dev_suisqp_web/suisqp_sis_qiankun';
    const path = `${directory}/.docs/ACADEMIC_REPORT_WORKBENCH_ROLE_DESIGN.md`;

    expect(parseFileReference(path)).toEqual({ path });
    expect(isLikelyFilePath(path)).toBe(true);
    expect(getResolvedReference(path, directory)).toEqual({ path, resolvedPath: path });
    expect(isResolvedFileReferenceWithinDirectory(path, directory)).toBe(true);
  });

  test('normalizes markdown file URLs into clickable local file references', () => {
    const directory = '/Users/song/dev_suisqp_web/_worktrees/suisqp_portal_qiankun_activity_class_p0';
    const path = `${directory}/src/views/activity/docs/P01_offering.md`;
    const fileUrl = `file://${path}`;

    expect(parseFileReference(fileUrl)).toEqual({ path });
    expect(isLikelyFilePath(fileUrl)).toBe(true);
    expect(getResolvedReference(fileUrl, directory)).toEqual({ path, resolvedPath: path });
  });

  test('resolves markdown image links relative to the rendered markdown file directory', () => {
    const directory = '/Users/song/dev_suisqp_web/.omo/evidence/admissions-workflow';
    const rootImage = resolveMarkdownImageReference('task-13-shell.png', directory);
    const nestedImage = resolveMarkdownImageReference('screenshots/task17-activities.png', directory);

    expect(rootImage?.source).toBe('task-13-shell.png');
    expect(rootImage?.resolvedPath).toBe(`${directory}/task-13-shell.png`);
    expect(nestedImage?.source).toBe('screenshots/task17-activities.png');
    expect(nestedImage?.resolvedPath).toBe(`${directory}/screenshots/task17-activities.png`);

    const rootParams = new URLSearchParams(rootImage?.rawUrl.split('?')[1] ?? '');
    const nestedParams = new URLSearchParams(nestedImage?.rawUrl.split('?')[1] ?? '');
    expect(rootParams.get('path')).toBe(`${directory}/task-13-shell.png`);
    expect(rootParams.get('directory')).toBe(directory);
    expect(nestedParams.get('path')).toBe(`${directory}/screenshots/task17-activities.png`);
    expect(nestedParams.get('directory')).toBe(directory);
  });

  test('does not truncate backup filenames with long timestamp suffixes in code blocks', () => {
    const path = '/mnt/user/appdata/frpc-gitlab/frpc.toml.bak.20260624_161718';

    expect(findFileReferenceTextMatches(`backup: ${path}`)).toEqual([{
      start: 8,
      end: 8 + path.length,
      raw: path,
    }]);
  });

  test('keeps whole absolute code-block lines with spaces and tildes', () => {
    const path = '/Users/song/Library/Mobile Documents/com~apple~CloudDocs/ops/docs/it-architecture.md';

    expect(findFileReferenceTextMatches(`  ${path}\n`)).toEqual([{
      start: 2,
      end: 2 + path.length,
      raw: path,
    }]);
  });
});

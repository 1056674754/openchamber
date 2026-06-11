import { describe, expect, mock, test } from 'bun:test';

mock.module('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: ({ baseUrl }: { baseUrl: string }) => ({ baseUrl }),
}));

const { isPathWithinProject, resolveRemoteIndicatorProject } = await import('./utils');

describe('isPathWithinProject', () => {
  test('matches child directories for root projects', () => {
    expect(isPathWithinProject('/workspace/app', '/')).toBe(true);
  });

  test('matches exact project directories', () => {
    expect(isPathWithinProject('/workspace/app', '/workspace/app')).toBe(true);
  });

  test('does not match sibling directory prefixes', () => {
    expect(isPathWithinProject('/workspace/app2', '/workspace/app')).toBe(false);
  });

  test('returns false when directory is null', () => {
    expect(isPathWithinProject(null, '/workspace/app')).toBe(false);
  });

  test('returns false when projectPath is null', () => {
    expect(isPathWithinProject('/workspace/app', null)).toBe(false);
  });

  test('matches deep child directories', () => {
    expect(isPathWithinProject('/workspace/app/sub/dir', '/workspace/app')).toBe(true);
  });
});

describe('resolveRemoteIndicatorProject', () => {
  const projectPath = '/Users/song/dev_ai/openchamber-merge-v1.11.0';
  const projects = [
    { id: 'local-project', path: projectPath },
    { id: 'dev1-project', path: projectPath, serverId: 'Dev1' },
  ];

  test('does not infer a remote indicator from path alone for unindexed sessions', () => {
    expect(resolveRemoteIndicatorProject({
      projects,
      projectId: 'dev1-project',
      directory: projectPath,
      indexedServerId: undefined,
    })).toBeNull();
  });

  test('does not show a remote indicator for default-indexed sessions', () => {
    expect(resolveRemoteIndicatorProject({
      projects,
      directory: projectPath,
      indexedServerId: 'default',
    })).toBeNull();
  });

  test('resolves the remote project when the session is indexed to that server', () => {
    expect(resolveRemoteIndicatorProject({
      projects,
      directory: projectPath,
      indexedServerId: 'Dev1',
    })?.id).toBe('dev1-project');
  });
});

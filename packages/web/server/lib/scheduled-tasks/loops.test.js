import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { discoverLoopFiles, discoverLoops, parseLoopDefinition, setLoopFileEnabled } from './loops.js';

const createProject = async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oc-loops-'));
  const projectPath = path.join(tempRoot, 'repo');
  await mkdir(path.join(projectPath, '.git'), { recursive: true });
  return {
    projectPath,
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
};

const writeLoop = async (root, fileName, fields = '') => {
  const directory = path.join(root, '.agents', 'loops');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, fileName);
  await writeFile(filePath, `---
name: daily-digest
schedule: "0 9 * * *"
model: openai/gpt-5
${fields}---
Summarize repository changes.
`, 'utf8');
  return filePath;
};

describe('markdown loop parsing', () => {
  it('maps frontmatter and body while defaulting enabled to false', async () => {
    const { projectPath, cleanup } = await createProject();
    try {
      const filePath = await writeLoop(projectPath, 'digest.md', 'agent: plan\ntimezone: US/Eastern\n');

      expect(parseLoopDefinition(filePath)).toEqual({
        name: 'daily-digest',
        enabled: false,
        schedule: { kind: 'cron', cron: '0 9 * * *', timezone: 'US/Eastern' },
        execution: {
          prompt: 'Summarize repository changes.',
          providerID: 'openai',
          modelID: 'gpt-5',
          agent: 'plan',
        },
      });
    } finally {
      await cleanup();
    }
  });

  it('rejects overlong names and malformed required fields', async () => {
    const { projectPath, cleanup } = await createProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const filePath = path.join(projectPath, 'invalid.md');
      await writeFile(filePath, `---\nname: ${'x'.repeat(81)}\nschedule: "0 9 * * *"\nmodel: openai/gpt-5\n---\nRun.\n`, 'utf8');

      expect(parseLoopDefinition(filePath)).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await cleanup();
    }
  });

  it('updates enabled without dropping custom frontmatter or prompt body', async () => {
    const { projectPath, cleanup } = await createProject();
    try {
      const filePath = await writeLoop(projectPath, 'digest.md', 'enabled: true\ncustom: keep-me\n');

      expect(setLoopFileEnabled(filePath, false)).toBe(true);
      expect(parseLoopDefinition(filePath)?.enabled).toBe(false);
      const content = await readFile(filePath, 'utf8');
      expect(content).toContain('custom: keep-me');
      expect(content).toContain('Summarize repository changes.');
    } finally {
      await cleanup();
    }
  });
});

describe('markdown loop discovery', () => {
  it('discovers ancestors to the worktree root with nearest project scope winning', async () => {
    const { projectPath, cleanup } = await createProject();
    try {
      await writeLoop(projectPath, 'root.md');
      const nested = path.join(projectPath, 'src', 'nested');
      await mkdir(nested, { recursive: true });
      const nestedFile = await writeLoop(nested, 'nested.md', 'enabled: true\n');

      const loops = discoverLoops(nested);

      expect(loops).toHaveLength(1);
      expect(loops[0].scope).toBe('project');
      expect(loops[0].filePath).toBe(nestedFile);
      expect(loops[0].definition?.enabled).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('keeps malformed files visible so reconciliation does not delete their tasks', async () => {
    const { projectPath, cleanup } = await createProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const validFile = await writeLoop(projectPath, 'valid.md');
      const malformedFile = path.join(projectPath, '.agents', 'loops', 'malformed.md');
      await writeFile(malformedFile, '---\nname: broken\n---\nRun.\n', 'utf8');

      const loops = discoverLoops(projectPath);

      expect(loops.find((loop) => loop.filePath === validFile)?.definition?.name).toBe('daily-digest');
      expect(loops.find((loop) => loop.filePath === malformedFile)?.definition).toBeNull();
    } finally {
      warn.mockRestore();
      await cleanup();
    }
  });

  it('lists only markdown files in loop directories', async () => {
    const { projectPath, cleanup } = await createProject();
    try {
      const filePath = await writeLoop(projectPath, 'digest.md');
      await writeFile(path.join(projectPath, '.agents', 'loops', 'ignored.txt'), 'ignored', 'utf8');

      expect(discoverLoopFiles(projectPath)).toEqual([{ scope: 'project', filePath }]);
    } finally {
      await cleanup();
    }
  });
});

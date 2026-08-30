import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createScheduledTaskService } from './service.js';

const loopTask = {
  id: 'loop:project:daily',
  name: 'daily',
  enabled: true,
  loopFile: '/repo/.agents/loops/daily.md',
  schedule: { kind: 'cron', cron: '0 9 * * *', timezone: 'UTC' },
  execution: { prompt: 'Run.', providerID: 'openai', modelID: 'gpt-5' },
};

const createService = (overrides = {}) => {
  const projectConfigRuntime = {
    listScheduledTasks: vi.fn(async () => []),
    deleteScheduledTask: vi.fn(async () => ({ deleted: true, tasks: [] })),
    ...(overrides.projectConfigRuntime || {}),
  };
  const scheduledTasksRuntime = {
    syncProject: vi.fn(async () => []),
    ...(overrides.scheduledTasksRuntime || {}),
  };
  return {
    projectConfigRuntime,
    scheduledTasksRuntime,
    service: createScheduledTaskService({
      readSettingsFromDiskMigrated: async () => ({ projects: [{ id: 'project-test', path: '/repo' }] }),
      sanitizeProjects: (projects) => projects,
      projectConfigRuntime,
      scheduledTasksRuntime,
    }),
  };
};

describe('scheduled-task loop service', () => {
  it('reconciles loop files before listing tasks', async () => {
    const { service, scheduledTasksRuntime, projectConfigRuntime } = createService({
      scheduledTasksRuntime: { syncProject: vi.fn(async () => [loopTask]) },
    });

    await expect(service.list('project-test')).resolves.toEqual([loopTask]);
    expect(scheduledTasksRuntime.syncProject).toHaveBeenCalledWith('project-test');
    expect(projectConfigRuntime.listScheduledTasks).not.toHaveBeenCalled();
  });

  it('updates enabled in the authoritative markdown file then reconciles', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oc-loop-service-'));
    const filePath = path.join(tempRoot, 'daily.md');
    await writeFile(filePath, `---\nname: daily\nschedule: "0 9 * * *"\nenabled: true\nmodel: openai/gpt-5\ncustom: keep\n---\nRun.\n`, 'utf8');
    const task = { ...loopTask, loopFile: filePath };
    const syncProject = vi.fn().mockResolvedValueOnce([task]).mockResolvedValueOnce([{ ...task, enabled: false }]);
    const { service } = createService({ scheduledTasksRuntime: { syncProject } });
    try {
      await expect(service.setLoopEnabled('project-test', task.id, false)).resolves.toMatchObject({ enabled: false });
      const content = await readFile(filePath, 'utf8');
      expect(content).toContain('enabled: false');
      expect(content).toContain('custom: keep');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('deletes a loop file then reconciles its task away', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oc-loop-service-'));
    const filePath = path.join(tempRoot, 'daily.md');
    await writeFile(filePath, 'loop', 'utf8');
    const task = { ...loopTask, loopFile: filePath };
    const syncProject = vi.fn().mockResolvedValueOnce([task]).mockResolvedValueOnce([]);
    const { service } = createService({ scheduledTasksRuntime: { syncProject } });
    try {
      await expect(service.removeLoopFile('project-test', task.id)).resolves.toEqual([]);
      await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects general deletion while the authoritative loop file exists', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oc-loop-service-'));
    const filePath = path.join(tempRoot, 'daily.md');
    await writeFile(filePath, 'loop', 'utf8');
    const { service, projectConfigRuntime } = createService({
      projectConfigRuntime: { listScheduledTasks: vi.fn(async () => [{ ...loopTask, loopFile: filePath }]) },
    });
    try {
      await expect(service.remove('project-test', loopTask.id)).rejects.toMatchObject({ statusCode: 400 });
      expect(projectConfigRuntime.deleteScheduledTask).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('scheduled-task service run', () => {
  it('forwards persistError when completion state cannot be saved', async () => {
    const { service } = createService({
      scheduledTasksRuntime: {
        runNow: vi.fn(async () => ({
          ok: true,
          sessionID: 'sess-1',
          task: { id: 'task-1', state: { lastStatus: 'success' } },
          persistError: 'timeout acquiring project config lock for project-test',
        })),
      },
    });

    const result = await service.run('project-test', 'task-1');
    expect(result.sessionId).toBe('sess-1');
    expect(result.persistError).toMatch(/timeout acquiring project config lock/);
  });
});

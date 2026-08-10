import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { createProjectConfigRuntime } from './project-config.js';

const createRuntime = async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oc-scheduled-project-config-'));
  const runtime = createProjectConfigRuntime({
    fsPromises: await import('fs/promises'),
    path,
    projectsDirPath: tempRoot,
    createTaskID: () => 'task-fixed-id',
  });
  return {
    runtime,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
};

describe('project-config runtime', () => {
  it('creates and persists a scheduled task', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      const result = await runtime.upsertScheduledTask('project-test', {
        name: 'Nightly digest',
        enabled: true,
        schedule: {
          kind: 'daily',
          time: '09:30',
          timezone: 'UTC',
        },
        execution: {
          prompt: 'Summarize repository changes',
          providerID: 'openai',
          modelID: 'gpt-4.1',
          permissionAutoAccept: true,
          goalEnabled: true,
          goalTokenBudget: 200000,
        },
      });

      expect(result.created).toBe(true);
      expect(result.task.id).toBe('task-fixed-id');
      const reloaded = await runtime.listScheduledTasks('project-test');
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0].name).toBe('Nightly digest');
      expect(reloaded[0].schedule.timezone).toBe('UTC');
      expect(reloaded[0].schedule.times).toEqual(['09:30']);
      expect(reloaded[0].execution.permissionAutoAccept).toBe(true);
      expect(reloaded[0].execution.goalEnabled).toBe(true);
      expect(reloaded[0].execution.goalTokenBudget).toBe(200000);
    } finally {
      await cleanup();
    }
  });

  it('rejects invalid cron expressions', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      await expect(runtime.upsertScheduledTask('project-test', {
        name: 'Invalid cron task',
        enabled: true,
        schedule: {
          kind: 'cron',
          cron: 'invalid cron',
          timezone: 'UTC',
        },
        execution: {
          prompt: 'Run checks',
          providerID: 'openai',
          modelID: 'gpt-4.1',
        },
      })).rejects.toThrow('schedule.cron is invalid');
    } finally {
      await cleanup();
    }
  });

  it('preserves unknown project config keys when writing scheduled tasks', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      const projectID = 'path_preserve';
      const filePath = path.join(runtime.resolveProjectConfigPath(projectID));
      await writeFile(
        filePath,
        JSON.stringify({
          projectNotes: 'hello notes',
          projectTodos: [{ id: 't1', text: 'buy milk', completed: false, createdAt: 1 }],
          projectActions: [{ id: 'a1', name: 'Run', command: 'bun run dev' }],
          projectActionsPrimaryId: 'a1',
          'setup-worktree': ['bun install'],
          projectPlanFiles: [{ id: 'p1', path: '/tmp/plans/p1.md', createdAt: 2 }],
          projectPath: '/tmp/demo',
        }, null, 2),
        'utf8',
      );

      await runtime.upsertScheduledTask(projectID, {
        name: 'nightly',
        enabled: true,
        schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
        execution: { prompt: 'run', providerID: 'openai', modelID: 'gpt-4.1' },
      });

      const raw = JSON.parse(await readFile(filePath, 'utf8'));
      expect(raw.projectNotes).toBe('hello notes');
      expect(raw.projectTodos).toEqual([{ id: 't1', text: 'buy milk', completed: false, createdAt: 1 }]);
      expect(raw.projectActions).toHaveLength(1);
      expect(raw.projectActionsPrimaryId).toBe('a1');
      expect(raw['setup-worktree']).toEqual(['bun install']);
      expect(raw.projectPlanFiles).toEqual([{ id: 'p1', path: '/tmp/plans/p1.md', createdAt: 2 }]);
      expect(raw.projectPath).toBe('/tmp/demo');
      expect(raw.scheduledTasks).toHaveLength(1);
      expect(raw.version).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('preserves scheduled task state timestamps when listing tasks', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      const projectID = 'timestamp_preserve';
      const filePath = path.join(runtime.resolveProjectConfigPath(projectID));
      await writeFile(
        filePath,
        JSON.stringify({
          scheduledTasks: [{
            id: 'task-existing',
            name: 'nightly',
            enabled: true,
            schedule: { kind: 'daily', times: ['09:00'], timezone: 'UTC' },
            execution: { prompt: 'run', providerID: 'openai', modelID: 'gpt-4.1' },
            state: { createdAt: 10, updatedAt: 20, lastStatus: 'idle' },
          }],
        }, null, 2),
        'utf8',
      );

      const first = await runtime.listScheduledTasks(projectID);
      const second = await runtime.listScheduledTasks(projectID);

      expect(first[0].state.createdAt).toBe(10);
      expect(first[0].state.updatedAt).toBe(20);
      expect(second[0].state.updatedAt).toBe(20);
    } finally {
      await cleanup();
    }
  });

  it('accepts one-time schedule with date and time', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      const result = await runtime.upsertScheduledTask('project-test', {
        name: 'One-time review',
        enabled: true,
        schedule: {
          kind: 'once',
          date: '2026-04-20',
          time: '13:45',
          timezone: 'Europe/Kyiv',
        },
        execution: {
          prompt: 'Create a release summary',
          providerID: 'openai',
          modelID: 'gpt-4.1',
        },
      });

      expect(result.task.schedule.kind).toBe('once');
      expect(result.task.schedule.date).toBe('2026-04-20');
      expect(result.task.schedule.time).toBe('13:45');
      expect(result.task.schedule.timezone).toBe('Europe/Kyiv');
    } finally {
      await cleanup();
    }
  });
});

describe('project-config loop reconciliation', () => {
  const loop = (name, filePath = `/repo/.agents/loops/${name}.md`) => ({
    scope: 'project',
    filePath,
    definition: {
      name,
      enabled: true,
      schedule: { kind: 'cron', cron: '0 9 * * *', timezone: 'Europe/Kiev' },
      execution: { prompt: `Run ${name}`, providerID: 'openai', modelID: 'gpt-5' },
    },
  });

  it('adopts by name then by file identity while preserving runtime and UI-only state', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      const created = await runtime.upsertScheduledTask('project-test', {
        name: 'daily-digest',
        enabled: false,
        schedule: { kind: 'daily', time: '08:00', timezone: 'UTC' },
        execution: {
          prompt: 'JSON prompt',
          providerID: 'openai',
          modelID: 'gpt-4.1',
          permissionAutoAccept: true,
        },
      });
      await runtime.updateScheduledTaskState('project-test', created.task.id, {
        lastRunAt: 123,
        lastStatus: 'success',
      });

      await runtime.reconcileLoopTasks('project-test', [loop('daily-digest')]);
      const renamed = await runtime.reconcileLoopTasks('project-test', [loop('renamed', '/repo/.agents/loops/daily-digest.md')]);

      expect(renamed).toHaveLength(1);
      expect(renamed[0].id).toBe(created.task.id);
      expect(renamed[0].name).toBe('renamed');
      expect(renamed[0].schedule.timezone).toBe('Europe/Kyiv');
      expect(renamed[0].execution.permissionAutoAccept).toBe(true);
      expect(renamed[0].state.lastRunAt).toBe(123);
    } finally {
      await cleanup();
    }
  });

  it('serializes reconciliation with other writes for the same project', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      await Promise.all([
        runtime.reconcileLoopTasks('project-test', [loop('loop-task')]),
        runtime.upsertScheduledTask('project-test', {
          id: 'json-task',
          name: 'json-task',
          enabled: true,
          schedule: { kind: 'daily', time: '08:00', timezone: 'UTC' },
          execution: { prompt: 'JSON prompt', providerID: 'openai', modelID: 'gpt-4.1' },
        }),
      ]);

      expect((await runtime.listScheduledTasks('project-test')).map((task) => task.name).sort())
        .toEqual(['json-task', 'loop-task']);
    } finally {
      await cleanup();
    }
  });

  it('keeps malformed loop files but removes tasks whose file disappeared', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      const filePath = '/repo/.agents/loops/daily.md';
      const first = await runtime.reconcileLoopTasks('project-test', [loop('daily', filePath)]);
      expect(first).toHaveLength(1);

      const malformed = await runtime.reconcileLoopTasks('project-test', [{ scope: 'project', filePath, definition: null }]);
      expect(malformed).toHaveLength(1);

      expect(await runtime.reconcileLoopTasks('project-test', [])).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});

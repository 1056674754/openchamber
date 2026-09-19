import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  computeNextRunAt,
  createScheduledTasksRuntime,
  expandCommandGoalObjective,
  formatScheduledSessionTitle,
  parseScheduledCommandPrompt,
} from './runtime.js';
import { createProjectConfigRuntime } from '../projects/project-config.js';

describe('scheduled-tasks runtime helpers', () => {
  it.each([
    ['*/15 * * * *', 'UTC', '2026-09-18T08:07:00Z', '2026-09-18T08:15:00Z'],
    ['30 */5 * * * *', 'UTC', '2026-09-18T08:07:00Z', '2026-09-18T08:10:30Z'],
    ['0 9 * * MON-FRI', 'Europe/Kyiv', '2026-09-18T07:00:00Z', '2026-09-21T06:00:00Z'],
    ['0 9 * * *', 'Europe/Kyiv', '2026-03-28T08:00:00Z', '2026-03-29T06:00:00Z'],
    ['0 9 * * *', 'Europe/Kyiv', '2026-10-24T08:00:00Z', '2026-10-25T07:00:00Z'],
    ['0 0 L * *', 'UTC', '2026-02-01T00:00:00Z', '2026-02-28T00:00:00Z'],
  ])('computes cron %s in %s from %s', (cron, timezone, now, expected) => {
    expect(computeNextRunAt({
      enabled: true,
      schedule: { kind: 'cron', cron, timezone },
    }, Date.parse(now))).toBe(Date.parse(expected));
  });

  it('computes next daily run in timezone', () => {
    const nowUtc = Date.UTC(2025, 0, 1, 8, 0, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'daily',
        times: ['09:30'],
        timezone: 'UTC',
      },
    }, nowUtc);

    expect(next).toBe(Date.UTC(2025, 0, 1, 9, 30, 0));
  });

  it('computes weekly next run using weekdays', () => {
    // Monday 2025-01-06 10:00:00 UTC
    const nowUtc = Date.UTC(2025, 0, 6, 10, 0, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'weekly',
        times: ['09:00'],
        weekdays: [1, 3],
        timezone: 'UTC',
      },
    }, nowUtc);

    // Wednesday 2025-01-08 09:00:00 UTC
    expect(next).toBe(Date.UTC(2025, 0, 8, 9, 0, 0));
  });

  it('picks nearest time from multiple daily times', () => {
    const nowUtc = Date.UTC(2025, 0, 1, 9, 20, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'daily',
        times: ['09:15', '09:45', '18:00'],
        timezone: 'UTC',
      },
    }, nowUtc);

    expect(next).toBe(Date.UTC(2025, 0, 1, 9, 45, 0));
  });

  it('computes one-time next run for future date', () => {
    const nowUtc = Date.UTC(2026, 3, 15, 10, 0, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'once',
        date: '2026-04-16',
        time: '13:30',
        timezone: 'UTC',
      },
    }, nowUtc);

    expect(next).toBe(Date.UTC(2026, 3, 16, 13, 30, 0));
  });

  it('returns null for past one-time schedule', () => {
    const nowUtc = Date.UTC(2026, 3, 16, 14, 0, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'once',
        date: '2026-04-16',
        time: '13:30',
        timezone: 'UTC',
      },
    }, nowUtc);

    expect(next).toBeNull();
  });

  it('formats session title with timestamp suffix', () => {
    const title = formatScheduledSessionTitle({
      name: 'Morning Sync',
      schedule: { timezone: 'UTC' },
    }, Date.UTC(2025, 2, 10, 7, 5, 0));

    expect(title).toBe('Morning Sync 2025-03-10 07:05');
  });

  it('parses slash command prompt for scheduled command mode', () => {
    expect(parseScheduledCommandPrompt('/review src/components')).toEqual({
      command: 'review',
      arguments: 'src/components',
    });
  });

  it('returns null when prompt is not a slash command', () => {
    expect(parseScheduledCommandPrompt('Summarize open issues')).toBeNull();
    expect(parseScheduledCommandPrompt('/')).toBeNull();
  });

  it('expands command arguments into the goal objective', () => {
    expect(expandCommandGoalObjective(
      'Run the issue pipeline for $ARGUMENTS. Verify $ARGUMENTS is represented by the PR.',
      'LIN-123 --draft',
    )).toBe('Run the issue pipeline for LIN-123 --draft. Verify LIN-123 --draft is represented by the PR.');
    expect(expandCommandGoalObjective(undefined, 'LIN-123')).toBeNull();
    expect(expandCommandGoalObjective('Move $1 to $2', '"src old" dist extra')).toBe('Move src old to dist extra');
    expect(expandCommandGoalObjective('Review the requested scope.', 'auth module'))
      .toBe('Review the requested scope.\n\nauth module');
  });
});

describe('scheduled-tasks markdown loop wiring', () => {
  const createFixture = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oc-runtime-loop-'));
    const projectPath = path.join(tempRoot, 'repo');
    await mkdir(path.join(projectPath, '.agents', 'loops'), { recursive: true });
    await writeFile(path.join(projectPath, '.agents', 'loops', 'daily.md'), `---
name: daily
schedule: "0 9 * * *"
enabled: true
model: openai/gpt-5
---
Run daily.
`, 'utf8');
    const projectConfigRuntime = createProjectConfigRuntime({
      fsPromises: await import('node:fs/promises'),
      path,
      projectsDirPath: path.join(tempRoot, 'config'),
    });
    return {
      projectPath,
      projectConfigRuntime,
      cleanup: () => rm(tempRoot, { recursive: true, force: true }),
    };
  };

  it('discovers and reconciles loop files on project sync', async () => {
    const fixture = await createFixture();
    try {
      const runtime = createScheduledTasksRuntime({
        projectConfigRuntime: fixture.projectConfigRuntime,
        listProjects: async () => [{ id: 'project-test', path: fixture.projectPath }],
        buildOpenCodeUrl: () => 'http://127.0.0.1:1',
        getOpenCodeAuthHeaders: () => ({}),
      });

      await runtime.syncProject('project-test');

      const tasks = await fixture.projectConfigRuntime.listScheduledTasks('project-test');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('loop:project:daily');
      expect(tasks[0].state.nextRunAt).toBeGreaterThan(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('waits for pending worktree bootstrap before a loop creates a session', async () => {
    const fixture = await createFixture();
    const waitForWorktreeBootstrap = vi.fn(async () => {
      throw new Error('bootstrap failed');
    });
    const waitForOpenCodeReady = vi.fn(async () => undefined);
    try {
      const runtime = createScheduledTasksRuntime({
        projectConfigRuntime: fixture.projectConfigRuntime,
        listProjects: async () => [{ id: 'project-test', path: fixture.projectPath }],
        buildOpenCodeUrl: () => 'http://127.0.0.1:1',
        getOpenCodeAuthHeaders: () => ({}),
        waitForWorktreeBootstrap,
        waitForOpenCodeReady,
        logger: { info: vi.fn(), warn: vi.fn() },
      });
      await runtime.syncProject('project-test');
      const [task] = await fixture.projectConfigRuntime.listScheduledTasks('project-test');

      const result = await runtime.runNow('project-test', task.id);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('bootstrap failed');
      expect(waitForWorktreeBootstrap).toHaveBeenCalledWith(fixture.projectPath);
      expect(waitForOpenCodeReady).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });
});

import { describe, expect, mock, test } from 'bun:test';

import { createControlCommands } from './control-commands.js';

describe('OpenChamber control CLI policy', () => {
  test('rejects incompatible message selection flags before resolving an instance', async () => {
    // Given
    const resolveTargetInstance = mock(async () => ({ port: 5190 }));
    const requestJson = mock(async () => ({
      response: { ok: true },
      body: { messages: [] },
    }));
    const commands = createControlCommands({ resolveTargetInstance, requestJson });

    // When
    const operation = commands.session({
      serverId: 'default',
      directory: '/workspace/current',
      sessionId: 'ses_existing',
      all: true,
      last: true,
    }, 'messages');

    // Then
    expect(operation).rejects.toThrow('--all cannot be combined');
    expect(resolveTargetInstance).not.toHaveBeenCalled();
    expect(requestJson).not.toHaveBeenCalled();
  });

  test('rejects scheduled tasks with multiple schedule selectors before HTTP', async () => {
    // Given
    const resolveTargetInstance = mock(async () => ({ port: 5190 }));
    const requestJson = mock(async () => ({
      response: { ok: true },
      body: {},
    }));
    const commands = createControlCommands({ resolveTargetInstance, requestJson });

    // When
    const operation = commands.schedule({
      serverId: 'default',
      directory: '/workspace/current',
      name: 'Conflicting schedule',
      prompt: 'Run checks',
      model: 'provider/model',
      daily: '09:00',
      cron: '0 9 * * *',
    }, 'create');

    // Then
    expect(operation).rejects.toThrow('Provide exactly one');
    expect(resolveTargetInstance).not.toHaveBeenCalled();
    expect(requestJson).not.toHaveBeenCalled();
  });

  test('allows a worktree to be provisioned without waiting for the session', async () => {
    const resolveTargetInstance = mock(async () => ({ port: 5190 }));
    const requestJson = mock(async () => ({
      response: { ok: true },
      body: { sessionId: 'ses_new' },
    }));
    const commands = createControlCommands({ resolveTargetInstance, requestJson });

    await commands.session({
      serverId: 'default',
      directory: '/workspace/current',
      name: 'Feature',
      worktree: 'feature',
    }, 'create');

    const call = requestJson.mock.calls[0];
    expect(call[2].timeoutMs).toBe(120_000);
  });

  test('ignores a blank worktree name for timeout purposes', async () => {
    const resolveTargetInstance = mock(async () => ({ port: 5190 }));
    const requestJson = mock(async () => ({
      response: { ok: true },
      body: { sessionId: 'ses_new' },
    }));
    const commands = createControlCommands({ resolveTargetInstance, requestJson });

    await commands.session({
      serverId: 'default',
      directory: '/workspace/current',
      name: 'Feature',
      worktree: '   ',
    }, 'create');

    const call = requestJson.mock.calls[0];
    expect(call[2].timeoutMs).toBeUndefined();
  });

  test('covers provisioning and waiting in sequence when both are requested', async () => {
    const resolveTargetInstance = mock(async () => ({ port: 5190 }));
    const requestJson = mock(async () => ({
      response: { ok: true },
      body: { sessionId: 'ses_new' },
    }));
    const commands = createControlCommands({ resolveTargetInstance, requestJson });

    await commands.session({
      serverId: 'default',
      directory: '/workspace/current',
      name: 'Feature',
      worktree: 'feature',
      wait: true,
      timeout: 30,
    }, 'create');

    const call = requestJson.mock.calls[0];
    expect(call[2].timeoutMs).toBe(180_000);
  });
});

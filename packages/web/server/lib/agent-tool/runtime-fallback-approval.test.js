import { describe, expect, it, vi } from 'vitest';

import { createRuntimeFallbackApprovalService } from './runtime-fallback-approval.js';

const request = {
  sessionID: 'ses_test',
  directory: '/workspace',
  currentModel: 'openai/gpt-5.6-sol',
  candidateModel: 'zhipuai-coding-plan/glm-5.2',
  source: 'message.updated',
  timeoutMs: 30_000,
};

const flushMicrotasks = async () => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
};

describe('runtime fallback approval service', () => {
  it('does not offer a candidate whose tracked quota is exhausted', async () => {
    const broadcastEvent = vi.fn();
    const service = createRuntimeFallbackApprovalService({
      crypto: { randomUUID: () => 'approval-1' },
      broadcastEvent,
      getQuotaProviders: async () => ({
        fetchQuotaForProvider: async () => ({
          ok: true,
          configured: true,
          usage: {
            windows: {
              fiveHour: { usedPercent: 100, remainingPercent: 0 },
            },
          },
        }),
      }),
    });

    const result = await service.request(request);

    expect(result).toMatchObject({
      decision: 'unavailable',
      preflight: {
        status: 'exhausted',
        providerId: 'zhipuai-coding-plan',
      },
    });
    expect(broadcastEvent).not.toHaveBeenCalled();
  });

  it('resolves immediately when the UI approves the fallback', async () => {
    const broadcastEvent = vi.fn();
    const service = createRuntimeFallbackApprovalService({
      crypto: { randomUUID: () => 'approval-2' },
      broadcastEvent,
      getQuotaProviders: async () => ({
        fetchQuotaForProvider: async () => ({
          ok: true,
          configured: true,
          usage: {
            windows: {
              fiveHour: { usedPercent: 42, remainingPercent: 58 },
            },
          },
        }),
      }),
    });

    const pending = service.request(request);
    await flushMicrotasks();
    expect(service.list()).toHaveLength(1);
    expect(service.reply('approval-2', 'approve')).toBe(true);

    await expect(pending).resolves.toMatchObject({
      decision: 'approved',
      requestID: 'approval-2',
      preflight: { status: 'available' },
    });
    expect(service.list()).toEqual([]);
    expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'openchamber:runtime-fallback-approval',
      properties: expect.objectContaining({ id: 'approval-2', status: 'pending' }),
    }));
  });

  it('automatically approves after the 30 second response window', async () => {
    let timeoutCallback = null;
    const service = createRuntimeFallbackApprovalService({
      crypto: { randomUUID: () => 'approval-3' },
      broadcastEvent: vi.fn(),
      getQuotaProviders: async () => ({
        fetchQuotaForProvider: async () => ({
          ok: false,
          configured: false,
          usage: null,
        }),
      }),
      setTimeoutFn: (callback) => {
        timeoutCallback = callback;
        return 1;
      },
      clearTimeoutFn: () => {},
    });

    const pending = service.request(request);
    await flushMicrotasks();
    timeoutCallback();

    await expect(pending).resolves.toMatchObject({
      decision: 'timeout',
      requestID: 'approval-3',
      preflight: { status: 'unknown' },
    });
  });

  it('cancels without displaying a prompt when progress already resumed', async () => {
    const broadcastEvent = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const service = createRuntimeFallbackApprovalService({
      crypto: { randomUUID: () => 'approval-4' },
      broadcastEvent,
      getQuotaProviders: async () => ({
        fetchQuotaForProvider: async () => ({
          ok: true,
          configured: true,
          usage: {
            windows: {
              fiveHour: { usedPercent: 42, remainingPercent: 58 },
            },
          },
        }),
      }),
    });

    await expect(service.request(request, { signal: controller.signal })).resolves.toMatchObject({
      decision: 'cancelled',
      requestID: 'approval-4',
    });
    expect(service.list()).toEqual([]);
    expect(broadcastEvent).toHaveBeenCalledTimes(1);
    expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
      properties: expect.objectContaining({ id: 'approval-4', status: 'resolved' }),
    }));
  });
});

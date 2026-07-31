import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentToolRuntime } from './runtime.js';

const temporaryDirectories = [];

const createRuntime = async (overrides = {}) => {
  const dataDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'openchamber-agent-tool-'));
  temporaryDirectories.push(dataDir);
  const executeAction = vi.fn(async () => ({ sessions: [] }));
  const runtimeFallbackApprovalService = {
    request: vi.fn(async () => ({ decision: 'approved' })),
    list: vi.fn(() => []),
    reply: vi.fn(() => true),
  };
  const runtime = createAgentToolRuntime({
    crypto,
    fsPromises,
    path,
    dataDir,
    getActivePort: () => 5190,
    executeAction,
    runtimeFallbackApprovalService,
    env: {},
    ...overrides,
  });
  return { dataDir, executeAction, runtimeFallbackApprovalService, runtime };
};

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.OPENCHAMBER_AGENT_TOOL_URL;
  delete process.env.OPENCHAMBER_AGENT_TOOL_TOKEN;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fsPromises.rm(directory, { recursive: true, force: true })
  )));
});

describe('agent tool runtime', () => {
  it('writes an OpenCode plugin that returns structured tool output', async () => {
    // Given
    const { dataDir, runtime } = await createRuntime();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      ok: true,
      action: 'projects.list',
      data: { projects: [] },
    }))));

    // When
    const injected = await runtime.prepareManagedOpenCodeEnv();
    process.env.OPENCHAMBER_AGENT_TOOL_URL = injected.OPENCHAMBER_AGENT_TOOL_URL;
    process.env.OPENCHAMBER_AGENT_TOOL_TOKEN = injected.OPENCHAMBER_AGENT_TOOL_TOKEN;
    const pluginPath = path.join(dataDir, 'agent-tool', 'openchamber-plugin.js');
    const pluginModule = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`);
    const plugin = await pluginModule.OpenChamberPlugin();
    const metadata = vi.fn();
    const result = await plugin.tool.openchamber.execute(
      { action: 'projects.list', parameters: {} },
      { directory: '/workspace/current', abort: new AbortController().signal, metadata },
    );

    // Then
    expect(injected.OPENCHAMBER_AGENT_TOOL_URL).toBe('http://127.0.0.1:5190/api/openchamber/agent-tool');
    expect(injected.OPENCHAMBER_RUNTIME_FALLBACK_URL).toBe('http://127.0.0.1:5190/api/openchamber/runtime-fallback');
    expect(result).toMatchObject({
      title: 'List configured projects',
      metadata: {
        openchamber: {
          schemaVersion: 1,
          action: 'projects.list',
          ok: true,
        },
      },
    });
    expect(JSON.parse(result.output)).toMatchObject({
      schemaVersion: 1,
      ok: true,
      action: 'projects.list',
    });
    expect(metadata).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: {
        openchamber: expect.objectContaining({ ok: true }),
      },
    }));
  });

  it('passes a runtime fallback request to the approval service with the current directory', async () => {
    const { runtime, runtimeFallbackApprovalService } = await createRuntime();

    const result = await runtime.requestFallbackApproval({
      sessionID: 'ses_test',
      currentModel: 'openai/gpt-5.6-sol',
      candidateModel: 'zhipuai-coding-plan/glm-5.2',
    }, {
      contextDirectory: '/workspace/current',
    });

    expect(result).toEqual({ decision: 'approved' });
    expect(runtimeFallbackApprovalService.request).toHaveBeenCalledWith({
      sessionID: 'ses_test',
      currentModel: 'openai/gpt-5.6-sol',
      candidateModel: 'zhipuai-coding-plan/glm-5.2',
      directory: '/workspace/current',
    }, {
      signal: undefined,
    });
  });

  it('scopes an agent action to managed local and the current Session directory', async () => {
    // Given
    const { executeAction, runtime } = await createRuntime();

    // When
    const result = await runtime.execute({
      input: { action: 'session.list', limit: 5 },
      contextDirectory: '/workspace/current',
    });

    // Then
    expect(result.ok).toBe(true);
    expect(executeAction).toHaveBeenCalledWith(
      'session.list',
      {
        action: 'session.list',
        serverId: 'default',
        directory: '/workspace/current',
        limit: 5,
      },
      undefined,
      {},
    );
  });
});

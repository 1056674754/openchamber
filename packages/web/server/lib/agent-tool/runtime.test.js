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
    expect(plugin.tool.openchamber_web).toBeDefined();
    expect(plugin.tool.openchamber_memory).toBeUndefined();
  });

  it('keeps the action schema to one validator keyword', async () => {
    // A node carrying both `enum` and `oneOf` is valid JSON Schema, but some
    // OpenAI-compatible gateways reject it and answer with an empty completion
    // instead of an error. `oneOf` is the keyword that stayed. Its branches
    // carry the per-action descriptions the model reads.
    const { dataDir, runtime } = await createRuntime();
    await runtime.prepareManagedOpenCodeEnv({ includeMemory: true });
    const pluginPath = path.join(dataDir, 'agent-tool', 'openchamber-plugin.js');
    const pluginModule = await import(`${pathToFileURL(pluginPath).href}?validator=${Date.now()}`);
    const plugin = await pluginModule.OpenChamberPlugin();

    for (const entry of Object.values(plugin.tool)) {
      expect(entry.args.action.oneOf).toBeInstanceOf(Array);
      expect(entry.args.action).not.toHaveProperty('enum');
    }
  });

  it('injects the memory tool only when explicitly enabled', async () => {
    const { dataDir, runtime } = await createRuntime();

    await runtime.prepareManagedOpenCodeEnv({
      includeControl: false,
      includeWeb: false,
      includeMemory: true,
    });
    const pluginPath = path.join(dataDir, 'agent-tool', 'openchamber-plugin.js');
    const pluginModule = await import(`${pathToFileURL(pluginPath).href}?memory=${Date.now()}`);
    const plugin = await pluginModule.OpenChamberPlugin();

    expect(plugin.tool.openchamber).toBeUndefined();
    expect(plugin.tool.openchamber_web).toBeUndefined();
    expect(plugin.tool.openchamber_memory).toBeDefined();
    expect(Object.keys(plugin.tool.openchamber_memory.args.parameters.properties).sort()).toEqual([
      'body',
      'memoryId',
      'scope',
      'title',
      'type',
    ]);
  });

  it('scopes bare memory actions to the memory tool and rejects browser actions', async () => {
    const { dataDir, executeAction, runtime } = await createRuntime();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      return new Response(JSON.stringify(await runtime.execute(payload)));
    }));
    const injected = await runtime.prepareManagedOpenCodeEnv({ includeMemory: true });
    process.env.OPENCHAMBER_AGENT_TOOL_URL = injected.OPENCHAMBER_AGENT_TOOL_URL;
    process.env.OPENCHAMBER_AGENT_TOOL_TOKEN = injected.OPENCHAMBER_AGENT_TOOL_TOKEN;
    const pluginPath = path.join(dataDir, 'agent-tool', 'openchamber-plugin.js');
    const pluginModule = await import(`${pathToFileURL(pluginPath).href}?memory-actions=${Date.now()}`);
    const plugin = await pluginModule.OpenChamberPlugin();

    const readResult = await plugin.tool.openchamber_memory.execute(
      { action: 'read', parameters: { title: 'User preference' } },
      { directory: '/workspace/current', abort: new AbortController().signal, metadata: vi.fn() },
    );
    const browserResult = await plugin.tool.openchamber_memory.execute(
      { action: 'browser.open', parameters: {} },
      { directory: '/workspace/current', abort: new AbortController().signal, metadata: vi.fn() },
    );

    expect(executeAction).toHaveBeenCalledWith(
      'memory.read',
      {
        action: 'memory.read',
        serverId: 'default',
        directory: '/workspace/current',
        title: 'User preference',
      },
      '/workspace/current',
      {},
    );
    expect(JSON.parse(readResult.output)).toMatchObject({ ok: true, action: 'memory.read' });
    expect(JSON.parse(browserResult.output)).toMatchObject({
      ok: false,
      error: { kind: 'usage' },
    });
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
      '/workspace/current',
      {},
    );
  });
});

import { parse as parseJsonc } from 'jsonc-parser';
import { pathToFileURL } from 'node:url';
import express from 'express';
import {
  OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS,
  OPENCHAMBER_AGENT_TOOL_ACTIONS,
  OPENCHAMBER_MEMORY_ACTION_DEFINITIONS,
  OPENCHAMBER_MEMORY_ACTIONS,
  resolveAgentToolAction,
  OPENCHAMBER_WEB_ACTION_DEFINITIONS,
  OPENCHAMBER_WEB_ACTIONS,
} from '../openchamber-control/actions.js';

const TOOL_SCHEMA_VERSION = 1;
const ACTIONS = new Set([...OPENCHAMBER_AGENT_TOOL_ACTIONS, ...OPENCHAMBER_WEB_ACTIONS, ...OPENCHAMBER_MEMORY_ACTIONS]);
const AGENT_TOOL_ACTION_TITLES = Object.fromEntries(
  [...OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS, ...OPENCHAMBER_WEB_ACTION_DEFINITIONS, ...OPENCHAMBER_MEMORY_ACTION_DEFINITIONS]
    .map(({ action, title }) => [action, title]),
);

const PLUGIN_PARAMETER_PROPERTIES = {
  projectId: { type: 'string', description: 'Configured project ID; do not combine with directory' },
  directory: { type: 'string', description: 'Absolute checkout or session directory; defaults to the current session directory' },
  sessionId: { type: 'string' },
  messageId: { type: 'string', description: 'Optional fork boundary message ID' },
  taskId: { type: 'string' },
  title: { type: 'string' },
  prompt: { type: 'string' },
  model: { type: 'string', description: 'Model in provider/model format. For an existing session, omit it to reuse the previous model unless the user explicitly requests a change' },
  agent: { type: 'string', description: 'OpenCode agent name; set only when the user explicitly requests a different agent' },
  variant: { type: 'string', description: 'Model variant; use only when the user explicitly requests it' },
  worktree: { type: 'string', description: 'New worktree name for session.create; use only when the user explicitly asks for an isolated worktree' },
  branch: { type: 'string', description: 'Branch name for the new worktree' },
  startRef: { type: 'string', description: 'Git ref used to create the new worktree' },
  setUpstream: { type: 'boolean', description: 'Make the new worktree branch track its upstream' },
  goal: { type: 'boolean', description: 'Run the dispatched prompt in Goal Mode; use only when explicitly requested' },
  goalTokenBudget: { type: 'integer', minimum: 1000, maximum: 100_000_000, description: 'Goal token budget; requires goal' },
  wait: { type: 'boolean', description: 'Wait for current session activity to become idle; omit by default' },
  timeout: { type: 'integer', minimum: 1, maximum: 86_400, description: 'Wait timeout in seconds (default 600); requires wait' },
  lastAssistant: { type: 'boolean', description: 'Return the last assistant text; create/send/fork require wait' },
  limit: { type: 'integer', minimum: 1, description: 'Maximum sessions or messages to return (default 10)' },
  all: { type: 'boolean', description: 'Include archived sessions or all messages, depending on the action' },
  last: { type: 'boolean', description: 'Return only the last matching session message' },
  withStatus: { type: 'boolean', description: 'Include authoritative status in session.list' },
  role: { type: 'string', enum: ['all', 'user', 'assistant'], description: 'Message role filter' },
  name: { type: 'string' },
  daily: { type: 'string', description: 'Daily run time in HH:mm format' },
  weekly: { type: 'string', description: 'Comma-separated weekdays; 0=Sunday and 6=Saturday' },
  once: { type: 'string', description: 'One-time run date in YYYY-MM-DD format' },
  time: { type: 'string', description: 'Weekly or one-time run time in HH:mm format' },
  cron: { type: 'string', description: 'Cron expression' },
  timezone: { type: 'string', description: 'IANA timezone' },
  disabled: { type: 'boolean', description: 'true disables and false enables; required for schedule.toggle' },
};

const WEB_PLUGIN_PARAMETER_PROPERTIES = {
  url: { type: 'string', description: 'Absolute http(s) URL for browser.open' },
  selector: { type: 'string', description: 'CSS selector returned by browser.snapshot' },
  text: { type: 'string', description: 'Visible link or button text for browser.click' },
  value: { type: 'string', description: 'Text for browser.type' },
  submit: { type: 'boolean', description: 'Press Enter after typing' },
  direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
  viewport: { type: 'string', enum: ['mobile', 'tablet', 'desktop', 'fill'] },
  label: { type: 'string', description: 'Short screenshot label' },
  directory: { type: 'string', description: 'Project directory for browser.capture; defaults to current session directory' },
};

const MEMORY_PLUGIN_PARAMETER_PROPERTIES = {
  title: { type: 'string', description: "Memory title exactly as listed in the session index" },
  body: { type: 'string', description: 'Durable full text that still makes sense outside this conversation' },
  scope: { type: 'string', enum: ['global', 'project', 'both'], description: 'global is about the user; project is about this codebase; both is list-only' },
  memoryId: { type: 'string', description: 'Memory ID returned by list or read' },
  type: { type: 'string', enum: ['fact', 'preference', 'reference'] },
};

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const createResult = ({ ok, action, data, error, exitCode }) => ({
  schemaVersion: TOOL_SCHEMA_VERSION,
  ok,
  action: action || 'unknown',
  ...(data !== undefined ? { data } : {}),
  ...(error ? { error } : {}),
  ...(Number.isInteger(exitCode) ? { exitCode } : {}),
});

const isLoopbackAddress = (value) => {
  const address = typeof value === 'string' ? value.toLowerCase() : '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
};

const createWebToolEntry = () => String.raw`
    openchamber_web: {
      description: "Look at and interact with a live page in OpenChamber's browser panel. Open a page, snapshot it, then click, type, scroll, inspect, resize, or capture using one action per call. The page may contain the user's real login session.",
      args: {
        action: { type: "string", oneOf: ${JSON.stringify(OPENCHAMBER_WEB_ACTION_DEFINITIONS.map(({ action, description }) => ({ const: action, description })))}, description: "Browser action" },
        parameters: { type: "object", properties: ${JSON.stringify(WEB_PLUGIN_PARAMETER_PROPERTIES)}, additionalProperties: false, description: "Inputs for the action" },
      },
      async execute(input, context) {
        const { action, parameters, ...flattened } = input ?? {}
        const args = { ...flattened, ...(parameters ?? {}), action }
        const title = ${JSON.stringify(AGENT_TOOL_ACTION_TITLES)}[args.action] ?? args.action
        context.metadata({ title, metadata: { openchamber_web: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title } } })
        const endpoint = process.env.OPENCHAMBER_AGENT_TOOL_URL
        const token = process.env.OPENCHAMBER_AGENT_TOOL_TOKEN
        const failure = (payload) => ({ title, output: JSON.stringify(payload), metadata: { openchamber_web: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title, ok: false } } })
        if (!endpoint || !token) return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: "OpenChamber managed tool connection is unavailable" } })
        try {
          const response = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ input: args, contextDirectory: context.directory }), signal: context.abort })
          const output = await response.text()
          let result = null
          try { result = JSON.parse(output) } catch {}
          const valid = result?.schemaVersion === ${TOOL_SCHEMA_VERSION} && typeof result?.ok === "boolean" && typeof result?.action === "string"
          context.metadata({ title, metadata: { openchamber_web: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title, ok: valid && result.ok === true } } })
          if (valid) return { title, output, metadata: { openchamber_web: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title, ok: result.ok === true } } }
          return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: "OpenChamber returned an invalid response", kind: "runtime", status: response.status } })
        } catch (error) {
          if (context.abort.aborted) throw error
          return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: error instanceof Error ? error.message : String(error), kind: "runtime" } })
        }
      },
    },
`;

const createMemoryToolEntry = () => String.raw`
    openchamber_memory: {
      description: "Keep durable facts, preferences, decisions, and hard-won references across sessions. Read a listed memory before acting on its abbreviated title; once read, an entry stays in your context, so do not read it again in the same conversation. Never store secrets, one-off task state, facts already obvious from the code, or anything the user asked you not to keep. Choose global only for facts about the user; project is for this codebase.",
      args: {
        action: { type: "string", oneOf: ${JSON.stringify(OPENCHAMBER_MEMORY_ACTION_DEFINITIONS.map(({ action, description }) => ({ const: action, description })))}, description: "Memory action" },
        parameters: { type: "object", properties: ${JSON.stringify(MEMORY_PLUGIN_PARAMETER_PROPERTIES)}, additionalProperties: false, description: "Inputs for the memory action" },
      },
      async execute(input, context) {
        const { action, parameters, ...flattened } = input ?? {}
        const args = { ...flattened, ...(parameters ?? {}), action }
        const title = ${JSON.stringify(AGENT_TOOL_ACTION_TITLES)}[args.action] ?? args.action
        context.metadata({ title, metadata: { openchamber_memory: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title } } })
        const endpoint = process.env.OPENCHAMBER_AGENT_TOOL_URL
        const token = process.env.OPENCHAMBER_AGENT_TOOL_TOKEN
        const failure = (payload) => ({ title, output: JSON.stringify(payload), metadata: { openchamber_memory: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title, ok: false } } })
        if (!endpoint || !token) return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: "OpenChamber managed tool connection is unavailable" } })
        try {
          const response = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ input: args, contextDirectory: context.directory, tool: "openchamber_memory" }), signal: context.abort })
          const output = await response.text()
          let result = null
          try { result = JSON.parse(output) } catch {}
          const valid = result?.schemaVersion === ${TOOL_SCHEMA_VERSION} && typeof result?.ok === "boolean" && typeof result?.action === "string"
          context.metadata({ title, metadata: { openchamber_memory: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title, ok: valid && result.ok === true } } })
          if (valid) return { title, output, metadata: { openchamber_memory: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title, ok: result.ok === true } } }
          return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: "OpenChamber returned an invalid response", kind: "runtime", status: response.status } })
        } catch (error) {
          if (context.abort.aborted) throw error
          return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: error instanceof Error ? error.message : String(error), kind: "runtime" } })
        }
      },
    },
`;

const createPluginSource = ({ includeControl = true, includeWeb = true, includeMemory = false } = {}) => String.raw`
export const OpenChamberPlugin = async () => ({
  tool: {
${includeControl ? String.raw`
    openchamber: {
      description: "Control OpenChamber projects, sessions, and scheduled tasks on the user's behalf. Sessions and scheduled tasks you create are for the user to follow and interact with. Do not decide on your own to hand parts of your current task to another session; when the user asks you to create a session, send a prompt to one, or schedule a task, do it, including when the work relates to your current task. Use one action per call. Scope with projectId or directory; omit both to use the current session directory. Session dispatches return immediately by default. To inspect a completed result later, use session.messages; session.send always sends a new prompt. Session and worktree deletion are unavailable.",
      args: {
        action: { type: "string", oneOf: ${JSON.stringify(OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS.map(({ action, description }) => ({ const: action, description })))}, description: "OpenChamber action to perform" },
        parameters: { type: "object", properties: ${JSON.stringify(PLUGIN_PARAMETER_PROPERTIES)}, additionalProperties: false, description: "Inputs for the action; use an empty object when none are needed" },
      },
      async execute(input, context) {
        const args = { ...(input.parameters ?? {}), action: input.action }
        const actionTitles = ${JSON.stringify(AGENT_TOOL_ACTION_TITLES)}
        const title = Object.hasOwn(actionTitles, args.action) ? actionTitles[args.action] : args.action
        context.metadata({
          title,
          metadata: {
            openchamber: {
              schemaVersion: ${TOOL_SCHEMA_VERSION},
              action: args.action,
              description: title,
            },
          },
        })
        const endpoint = process.env.OPENCHAMBER_AGENT_TOOL_URL
        const token = process.env.OPENCHAMBER_AGENT_TOOL_TOKEN
        const failure = (payload) => ({
          title,
          output: JSON.stringify(payload),
          metadata: { openchamber: { schemaVersion: ${TOOL_SCHEMA_VERSION}, action: args.action, description: title, ok: false } },
        })
        if (!endpoint || !token) {
          return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: "OpenChamber managed tool connection is unavailable" } })
        }

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              authorization: "Bearer " + token,
              "content-type": "application/json",
            },
            body: JSON.stringify({ input: args, contextDirectory: context.directory }),
            signal: context.abort,
          })
          const output = await response.text()
          let result = null
          try { result = JSON.parse(output) } catch {}
          const valid = result?.schemaVersion === ${TOOL_SCHEMA_VERSION}
            && typeof result?.ok === "boolean"
            && typeof result?.action === "string"
          context.metadata({
            title,
            metadata: {
              openchamber: {
                schemaVersion: ${TOOL_SCHEMA_VERSION},
                action: args.action,
                description: title,
                ok: valid && result.ok === true,
              },
            },
          })
          if (valid) {
            return {
              title,
              output,
              metadata: {
                openchamber: {
                  schemaVersion: ${TOOL_SCHEMA_VERSION},
                  action: args.action,
                  description: title,
                  ok: result.ok === true,
                },
              },
            }
          }
          return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: "OpenChamber returned an invalid response", kind: "runtime", status: response.status } })
        } catch (error) {
          if (context.abort.aborted) throw error
          return failure({ schemaVersion: ${TOOL_SCHEMA_VERSION}, ok: false, action: args.action, error: { message: error instanceof Error ? error.message : String(error), kind: "runtime" } })
        }
      },
    },
` : ''}
${includeWeb ? createWebToolEntry() : ''}
${includeMemory ? createMemoryToolEntry() : ''}
  },
})
`;

const mergePluginConfig = (rawConfig, pluginUrl) => {
  const errors = [];
  const parsed = asNonEmptyString(rawConfig)
    ? parseJsonc(rawConfig, errors, { allowTrailingComma: true })
    : {};
  if (errors.length > 0 || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OPENCODE_CONFIG_CONTENT must contain a valid JSON object');
  }
  if (parsed.plugin !== undefined && !Array.isArray(parsed.plugin)) {
    throw new Error('OPENCODE_CONFIG_CONTENT plugin must be an array');
  }
  const configured = Array.isArray(parsed.plugin) ? parsed.plugin : [];
  parsed.plugin = [
    ...configured.filter((value) => value !== pluginUrl && (!Array.isArray(value) || value[0] !== pluginUrl)),
    pluginUrl,
  ];
  return JSON.stringify(parsed);
};

export const createAgentToolRuntime = (dependencies) => {
  const {
    crypto,
    fsPromises,
    path,
    dataDir,
    getActivePort,
    executeAction,
    runtimeFallbackApprovalService,
    env = process.env,
    localServerId = 'default',
  } = dependencies;
  const pluginDirectory = path.join(dataDir, 'agent-tool');
  const pluginPath = path.join(pluginDirectory, 'openchamber-plugin.js');
  let activeToken = null;

  const prepareManagedOpenCodeEnv = async ({ includeControl = true, includeWeb = true, includeMemory = false } = {}) => {
    const port = getActivePort();
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('OpenChamber listener port is unavailable for managed tool injection');
    }
    await fsPromises.mkdir(pluginDirectory, { recursive: true });
    await fsPromises.writeFile(pluginPath, createPluginSource({ includeControl, includeWeb, includeMemory }), { mode: 0o600 });
    activeToken = crypto.randomBytes(32).toString('base64url');
    const pluginUrl = pathToFileURL(pluginPath).href;
    return {
      OPENCODE_CONFIG_CONTENT: mergePluginConfig(env.OPENCODE_CONFIG_CONTENT, pluginUrl),
      OPENCHAMBER_AGENT_TOOL_URL: `http://127.0.0.1:${port}/api/openchamber/agent-tool`,
      OPENCHAMBER_RUNTIME_FALLBACK_URL: `http://127.0.0.1:${port}/api/openchamber/runtime-fallback`,
      OPENCHAMBER_AGENT_TOOL_TOKEN: activeToken,
    };
  };

  const authorize = (req) => {
    if (!activeToken || !isLoopbackAddress(req.socket?.remoteAddress)) return false;
    const header = asNonEmptyString(req.headers?.authorization);
    if (!header?.startsWith('Bearer ')) return false;
    const provided = Buffer.from(header.slice(7));
    const expected = Buffer.from(activeToken);
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  };

  const execute = async (payload = {}, options = {}) => {
    const requested = asNonEmptyString(payload.input?.action);
    const resolution = resolveAgentToolAction(requested, asNonEmptyString(payload.tool));
    if (resolution.error) {
      return createResult({
        ok: false,
        action: requested,
        error: { message: resolution.error, kind: 'usage' },
      });
    }
    const action = resolution.action;
    if (!ACTIONS.has(action)) {
      return createResult({ ok: false, action, error: { message: `Unsupported OpenChamber action: ${action}`, kind: 'usage' } });
    }
    if (typeof executeAction !== 'function') {
      return createResult({
        ok: false,
        action,
        error: { message: 'OpenChamber control service is unavailable', kind: 'runtime' },
      });
    }
    const contextDirectory = asNonEmptyString(payload.contextDirectory);
    const explicitDirectory = asNonEmptyString(payload.input?.directory);
    const explicitProject = asNonEmptyString(payload.input?.projectId);
    const input = {
      ...payload.input,
      action,
      serverId: localServerId,
      ...(!explicitDirectory && !explicitProject && contextDirectory ? { directory: contextDirectory } : {}),
    };
    try {
      return createResult({
        ok: true,
        action,
        data: await executeAction(action, input, contextDirectory, options),
      });
    } catch (error) {
      return createResult({
        ok: false,
        action,
        ...(error?.partial === true ? {
          data: {
            partial: true,
            partialAction: error.partialAction,
            sessionId: error.sessionId,
            directory: error.directory,
          },
        } : {}),
        error: {
          message: error instanceof Error ? error.message : String(error),
          kind: Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500 ? 'usage' : 'runtime',
        },
      });
    }
  };

  const requestFallbackApproval = async (payload = {}, options = {}) => {
    if (!runtimeFallbackApprovalService) {
      return {
        decision: 'unavailable',
        error: 'OpenChamber runtime fallback approval service is unavailable',
      };
    }
    const explicitDirectory = asNonEmptyString(payload.directory);
    const contextDirectory = asNonEmptyString(options.contextDirectory);
    return runtimeFallbackApprovalService.request({
      ...payload,
      ...(!explicitDirectory && contextDirectory ? { directory: contextDirectory } : {}),
    }, {
      signal: options.signal,
    });
  };

  const registerRoutes = (app) => {
    app.post('/api/openchamber/agent-tool', express.json({ limit: '1mb' }), async (req, res) => {
      if (!authorize(req)) return res.status(401).json({ error: 'Unauthorized' });
      const controller = new AbortController();
      const abortOnDisconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
      req.once('aborted', abortOnDisconnect);
      res.once('close', abortOnDisconnect);
      try {
        return res.json(await execute(req.body, { signal: controller.signal }));
      } catch (error) {
        return res.json(createResult({
          ok: false,
          action: req.body?.input?.action,
          error: {
            message: error instanceof Error ? error.message : String(error),
            kind: 'runtime',
          },
        }));
      } finally {
        req.off('aborted', abortOnDisconnect);
        res.off('close', abortOnDisconnect);
      }
    });

    app.post('/api/openchamber/runtime-fallback', express.json({ limit: '32kb' }), async (req, res) => {
      if (!authorize(req)) return res.status(401).json({ error: 'Unauthorized' });
      const controller = new AbortController();
      const abortOnDisconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
      req.once('aborted', abortOnDisconnect);
      res.once('close', abortOnDisconnect);
      try {
        return res.json(await requestFallbackApproval(req.body, {
          contextDirectory: req.body?.contextDirectory,
          signal: controller.signal,
        }));
      } finally {
        req.off('aborted', abortOnDisconnect);
        res.off('close', abortOnDisconnect);
      }
    });

    app.get('/api/runtime-fallback/approvals', (_req, res) => {
      res.json({
        approvals: runtimeFallbackApprovalService?.list() || [],
      });
    });

    app.post('/api/runtime-fallback/approvals/:id', express.json({ limit: '8kb' }), (req, res) => {
      const accepted = runtimeFallbackApprovalService?.reply(req.params.id, req.body?.decision) || false;
      if (!accepted) return res.status(404).json({ error: 'Fallback approval request not found' });
      return res.json({ ok: true });
    });
  };

  return { prepareManagedOpenCodeEnv, registerRoutes, execute, requestFallbackApproval };
};

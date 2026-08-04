/**
 * Shared RPC request classification for the OpenChamber WebSocket RPC transport.
 *
 * Single source of truth for both runtimes:
 *  - server (`packages/web/server/lib/remote-instances/*.js`) — lane selection + timeout budget
 *  - client (`packages/ui/src/lib/remote-instances/rpcFetch.ts`) — frame.class declaration
 *
 * The transport proxies every same-origin `/api/*` request over the WebSocket RPC
 * bridge (except SSE/WS streams). These classes replace the former path-guessing
 * timeout table: a request is classified by semantic category, and each category
 * carries its own scheduling lane (concurrency) and timeout budget (safety net,
 * not a proxy for scheduling).
 */

/** @typedef {'critical'|'fast'|'normal'|'io'|'ai'|'stream'} RpcClass */

/** @type {const} */
export const RPC_CLASS = {
  CRITICAL: 'critical',
  FAST: 'fast',
  NORMAL: 'normal',
  IO: 'io',
  AI: 'ai',
  STREAM: 'stream',
};

/**
 * Default timeout budget per class (ms). `null` means "no hard timeout" (streams).
 * These are safety nets against hung requests, not concurrency controls — the
 * lane limits in the server's request-pressure state handle scheduling.
 * @type {Record<RpcClass, number | null>}
 */
export const RPC_CLASS_DEFAULT_TIMEOUT_MS = {
  critical: 3_000,
  fast: 15_000,
  normal: 30_000,
  io: 120_000,
  ai: 120_000,
  stream: null,
};

/**
 * Order used by classifyRpcPath: earlier entries win. `exact` paths match
 * `pathname` exactly; `prefix` matches `pathname.startsWith(prefix)`;
 * `regex` matches `new RegExp(re).test(pathname)`.
 * @type {Array<{ class: RpcClass, exact?: string[], prefix?: string[], regex?: string[] }>}
 */
const RPC_CLASS_RULES = [
  {
    class: RPC_CLASS.STREAM,
    exact: ['/api/global/event', '/api/event', '/api/global/event/ws', '/api/event/ws', '/api/remote-rpc/ws'],
  },
  {
    class: RPC_CLASS.CRITICAL,
    exact: [
      '/api/global/health',
      '/api/session/status',
      '/api/sessions/status',
      '/api/system/info',
      '/api/system/free-port',
      '/api/opencode/health',
      '/api/opencode/version',
    ],
  },
  {
    class: RPC_CLASS.FAST,
    exact: [
      '/api/fs/list',
      '/api/fs/stat',
      '/api/fs/home',
      '/api/session',
      '/api/project',
      '/api/session-folders',
      '/api/pending-messages',
      '/api/session-activity',
      '/api/sessions/snapshot',
      '/api/sessions/attention',
      '/api/openchamber/plugin-status',
      '/api/openchamber/sessions/unread',
    ],
    // Local config/read paths only — skills/plugins (network installs) are IO.
    prefix: [
      '/api/config/settings',
      '/api/config/full',
      '/api/config/section/',
      '/api/config/permissions',
      '/api/config/themes',
      '/api/config/agents/',
      '/api/config/mcp/',
      '/api/config/commands/',
      '/api/config/snippets/',
      '/api/quota/',
      '/api/push/',
      '/api/session-folders/',
      '/api/goals/',
    ],
  },
  {
    class: RPC_CLASS.IO,
    exact: [
      '/api/fs/clone',
      '/api/fs/exec',
      '/api/opencode/upgrade',
      '/api/opencode/upgrade-status',
      '/api/openchamber/update-check',
      '/api/openchamber/update-install',
      '/api/openchamber/tunnel/start',
      '/api/openchamber/tunnel/stop',
      '/api/openchamber/tunnel/check',
      '/api/openchamber/tunnel/doctor',
      '/api/openchamber/tunnel/providers',
      '/api/openchamber/tunnel/status',
      '/api/compact-focus',
    ],
    prefix: [
      '/api/git/',
      '/api/github/',
      '/api/fs/',
      '/api/remote-instances/',
      '/api/config/skills/',
      '/api/config/plugins/',
      '/api/openchamber/agent-tool',
      '/api/openchamber/control',
      '/api/openchamber/runtime-fallback',
    ],
    regex: [
      // Long-lived session operations (shell, compaction) — minutes, not seconds.
      '^/api/session/[^/]+/(shell|summarize|compact)$',
    ],
  },
  {
    class: RPC_CLASS.AI,
    exact: ['/api/tts/status', '/api/tts/say/status'],
    prefix: [
      '/api/text/',
      '/api/small-model/',
      '/api/tts/',
      '/api/voice/',
      '/api/stt/',
    ],
  },
  // everything else: NORMAL
];

/**
 * Classify an RPC API path into a semantic category.
 * Falls back to `normal` for unknown paths — never throws.
 * @param {string} pathname - API pathname (may include query string).
 * @param {string} [method='GET'] - HTTP method; currently unused but kept for
 *   future method-sensitive classification.
 * @returns {RpcClass}
 */
export function classifyRpcPath(pathname, method = 'GET') {
  let path = typeof pathname === 'string' ? pathname : '';
  try {
    path = new URL(path, 'http://localhost').pathname;
  } catch {
    path = String(pathname || '').split('?')[0] ?? '';
  }

  for (const rule of RPC_CLASS_RULES) {
    if (rule.exact && rule.exact.includes(path)) {
      return rule.class;
    }
    if (rule.prefix && rule.prefix.some((prefix) => path.startsWith(prefix))) {
      return rule.class;
    }
    if (rule.regex && rule.regex.some((pattern) => new RegExp(pattern).test(path))) {
      return rule.class;
    }
  }
  return RPC_CLASS.NORMAL;
}

/**
 * Resolve the default timeout for a classified path.
 * Returns `null` for stream class (no hard timeout).
 * @param {string} pathname
 * @param {string} [method='GET']
 * @returns {number | null}
 */
export function getRpcClassTimeoutMs(pathname, method = 'GET') {
  const rpcClass = classifyRpcPath(pathname, method);
  return RPC_CLASS_DEFAULT_TIMEOUT_MS[rpcClass] ?? null;
}

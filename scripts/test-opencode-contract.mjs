#!/usr/bin/env node
/**
 * OpenCode contract test (ADR: docs/AI_SUBSCRIPTION_EGRESS_RELAY_ADR.md, D6).
 *
 * Hermetically spawns the resolved OpenCode binary with an OPENCODE_CONFIG
 * overlay + stub relay, then asserts the four contract surfaces the
 * Subscriptions feature depends on:
 *
 *   1. auth API        — PUT/DELETE /auth/:providerID accepted
 *   2. config API      — GET + PATCH /config respond
 *   3. provider list   — overlay-projected provider appears with baseURL
 *   4. baseURL redirect — a prompt lands on the stub relay (native + custom)
 *
 * Usage:
 *   node scripts/test-opencode-contract.mjs [--binary /path/to/opencode]
 *
 * Exit code 0 = all green, 1 = at least one red. No state is left behind:
 * isolated XDG dirs, temp workspace, child processes killed on exit.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const binaryFlag = args[args.indexOf('--binary') + 1] || null;

const BINARY_CANDIDATES = [
  binaryFlag,
  process.env.OPENCODE_BINARY,
  path.join(os.homedir(), 'dev_ai/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode'),
  path.join(os.homedir(), '.openchamber/bin/opencode'),
].filter(Boolean);

const binary = BINARY_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!binary) {
  console.error('FAIL  no opencode binary found (use --binary or OPENCODE_BINARY)');
  process.exit(1);
}

const PORT = 48000 + Math.floor(Math.random() * 1000);
const RELAY_PORT = PORT + 1000;
const PASSWORD = 'contract-pass';
const AUTH = `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString('base64')}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-contract-'));
const relayLog = [];
const results = [];
const children = [];

const report = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'green' : 'RED  '}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const cleanup = () => {
  for (const child of children) {
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

// ---- stub relay ------------------------------------------------------------
const relay = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    relayLog.push({ method: req.method, url: req.url, body });
    const sse = req.url?.includes('/messages')
      ? 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_c","type":"message","role":"assistant","content":[],"model":"stub","stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"CONTRACT_OK"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
      : 'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"echo-1","choices":[{"index":0,"delta":{"role":"assistant","content":"CONTRACT_OK"},"finish_reason":null}]}\n\ndata: {"id":"c","object":"chat.completion.chunk","created":1,"model":"echo-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(sse);
  });
});
await new Promise((resolve) => relay.listen(RELAY_PORT, '127.0.0.1', resolve));
children.push({ kill: () => relay.close() });

// ---- overlay ----------------------------------------------------------------
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'work'), { recursive: true });
const overlayPath = path.join(tmp, 'overlay.json');
fs.writeFileSync(overlayPath, JSON.stringify({
  provider: {
    relaytest: {
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: `http://127.0.0.1:${RELAY_PORT}/v1`, apiKey: 'dummy-relay' },
      models: { 'echo-1': { name: 'Echo', limit: { context: 128000, output: 4096 } } },
    },
    anthropic: {
      npm: '@ai-sdk/anthropic',
      options: { baseURL: `http://127.0.0.1:${RELAY_PORT}`, apiKey: 'dummy-anthropic' },
      models: { 'claude-stub': { id: 'claude-sonnet-4-5', name: 'Stub', limit: { context: 200000, output: 8192 } } },
    },
  },
}, null, 2));

// ---- spawn opencode -----------------------------------------------------------
const server = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(PORT)], {
  cwd: path.join(tmp, 'work'),
  env: {
    ...process.env,
    XDG_DATA_HOME: path.join(tmp, 'data'),
    XDG_CONFIG_HOME: path.join(tmp, 'config'),
    OPENCODE_CONFIG: overlayPath,
    OPENCODE_SERVER_PASSWORD: PASSWORD,
  },
  stdio: 'ignore',
});
children.push(server);

const api = async (method, endpoint, body) => {
  const response = await fetch(`http://127.0.0.1:${PORT}${endpoint}`, {
    method,
    headers: { authorization: AUTH, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, json, text };
};

const deadline = Date.now() + 90_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const probe = await api('GET', '/provider');
    if (probe.status === 200) { ready = true; break; }
  } catch { /* not up yet */ }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
if (!ready) {
  report('server readiness', false, 'no 200 from /provider within 90s');
  process.exit(1);
}

// ---- 1. provider list / projection -------------------------------------------
const providers = await api('GET', '/provider');
const all = providers.json?.all ?? [];
const relaytest = all.find((p) => p.id === 'relaytest');
const anthropic = all.find((p) => p.id === 'anthropic');
report('projection: custom provider listed', relaytest?.source === 'config' && relaytest?.options?.baseURL?.includes(String(RELAY_PORT)));
report('projection: native override applied', anthropic?.options?.baseURL === `http://127.0.0.1:${RELAY_PORT}`);
report('projection: catalog metadata preserved', Array.isArray(Object.keys(anthropic?.models ?? {})) && Object.keys(anthropic.models).length > 1);

// ---- 2. auth API ---------------------------------------------------------------
const putAuth = await api('PUT', '/auth/contract-test', { type: 'api', key: 'contract-key' });
report('auth API: PUT /auth/:providerID', putAuth.status === 200 || putAuth.status === 201, `status=${putAuth.status}`);
const delAuth = await api('DELETE', '/auth/contract-test');
report('auth API: DELETE /auth/:providerID', delAuth.status === 200 || delAuth.status === 204, `status=${delAuth.status}`);

// ---- 3. config API -------------------------------------------------------------
const getConfig = await api('GET', '/config');
report('config API: GET /config', getConfig.status === 200 && typeof getConfig.text === 'string', `status=${getConfig.status}`);
const patchConfig = await api('PATCH', '/config', {});
report('config API: PATCH /config accepted', patchConfig.status < 500, `status=${patchConfig.status}`);

// ---- 4. baseURL redirect ---------------------------------------------------------
const session = await api('POST', '/session', {});
const sessionId = session.json?.id;
report('session create', Boolean(sessionId), `status=${session.status}`);
if (sessionId) {
  relayLog.length = 0;
  await api('POST', `/session/${sessionId}/message`, {
    model: { providerID: 'relaytest', modelID: 'echo-1' },
    parts: [{ type: 'text', text: 'ping' }],
  });
  const openaiHit = relayLog.find((entry) => entry.url?.includes('/chat/completions'));
  report('redirect: custom provider request reached relay', Boolean(openaiHit), openaiHit?.url);

  relayLog.length = 0;
  await api('POST', `/session/${sessionId}/message`, {
    model: { providerID: 'anthropic', modelID: 'claude-stub' },
    parts: [{ type: 'text', text: 'ping' }],
  });
  const anthropicHit = relayLog.find((entry) => entry.url?.includes('/messages'));
  report('redirect: native anthropic request reached relay', Boolean(anthropicHit), anthropicHit?.url);
}

const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? `\n${results.length}/${results.length} green` : `\n${failed.length} RED of ${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);

import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';

/**
 * Server-side v2 prompt dispatch (OC2 prompt-sender adaptation).
 *
 * OpenCode 2 does not serve the v1 `POST /session/:id/prompt_async` shape.
 * Verified against the 2.0.x protocol (`packages/protocol/src/groups/session.ts`):
 *
 * - the send endpoint is `POST /api/session/:id/prompt` with a FLAT payload
 *   `{text, files?, agents?, skills?, metadata?, delivery?, resume?}` — no
 *   model/agent/variant/parts fields;
 * - model and agent selection moved to per-session switches
 *   (`POST /api/session/:id/model` with `{model: {providerID, id, variant?}}`,
 *   `POST /api/session/:id/agent` with `{agent}`); the choice persists on the
 *   session record, so a dispatch whose queued selection differs switches
 *   first and then prompts;
 * - v2 has no prompt-level variant: `Model.Ref` carries it on the model
 *   switch instead;
 * - synthetic pre-text is admitted through
 *   `POST /api/session/:id/synthetic` (`{text, metadata?, delivery?, resume?}`);
 *   `resume: false` parks it without waking the session so only the closing
 *   prompt starts the turn;
 * - `delivery` is `'steer' | 'queue'`; the v1 `prompt_async` queue semantics
 *   map to `'queue'`.
 *
 * The senders keep building their v1 body exactly as before — it stays the
 * wire contract the Auto-routing hook (`resolvePromptBody`) mutates — and map
 * the (hook-rewritten) body onto this plan only when the owning instance's
 * protocol mode is v2. The v1 track never imports a runtime symbol from here
 * on a behavior path.
 */

/** v2 location-scoping query key (v2 ignores v1's `?directory=`). */
export const V2_DIRECTORY_PARAM = 'location[directory]';

/** The v2 request paths a dispatch issues, without the `/api` prefix. */
export const V2_PROMPT_PATHS = Object.freeze({
  switchModel: (sessionID) => `/session/${encodeURIComponent(sessionID)}/model`,
  switchAgent: (sessionID) => `/session/${encodeURIComponent(sessionID)}/agent`,
  synthetic: (sessionID) => `/session/${encodeURIComponent(sessionID)}/synthetic`,
  prompt: (sessionID) => `/session/${encodeURIComponent(sessionID)}/prompt`,
});

/**
 * Protocol mode of the instance a sender dispatches against. Server-side
 * senders all target the managed (default) instance except where a serverId
 * is threaded through (remote fan-out).
 */
export const isV2PromptTrack = (serverId = DEFAULT_PROTOCOL_MODE_SERVER_ID, env = process.env) => (
  resolveProtocolMode(serverId, env) === 'v2'
);

const textOf = (value) => (typeof value === 'string' ? value : '');
const recordOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

/**
 * Maps a v1 prompt body (`{model, agent?, variant?, parts:[...]}`) onto the
 * v2 dispatch plan. User text parts join with a blank line (the v2 prompt
 * carries one text); `synthetic` parts become ordered synthetic admissions
 * (part-level `metadata` rides along); file parts map onto FileAttachment
 * (`url` → `uri` — both `data:` URLs and `file:` URIs are accepted by the v2
 * attachment materializer); agent parts map onto `agents` (`{name}`).
 */
export const planV2PromptDispatch = (body) => {
  const parts = Array.isArray(body?.parts) ? body.parts : [];
  const userTexts = [];
  const syntheticInputs = [];
  const files = [];
  const agents = [];
  for (const part of parts) {
    const record = recordOf(part);
    if (!record) continue;
    if (record.type === 'text' && textOf(record.text).trim()) {
      const metadata = recordOf(record.metadata);
      if (record.synthetic) {
        syntheticInputs.push({ text: record.text, ...(metadata ? { metadata } : {}) });
      } else {
        userTexts.push(record.text);
      }
      continue;
    }
    if (record.type === 'file' && textOf(record.url)) {
      files.push({ uri: textOf(record.url), ...(textOf(record.filename) ? { name: textOf(record.filename) } : {}) });
      continue;
    }
    if (record.type === 'agent' && textOf(record.name).trim()) {
      agents.push({ name: textOf(record.name) });
    }
  }
  const model = recordOf(body?.model);
  const providerID = textOf(model?.providerID);
  const modelID = textOf(model?.modelID);
  const variant = textOf(body?.variant);
  return {
    // The switch payload spells the model id `id` (Model.Ref), not v1's `modelID`.
    ...(providerID && modelID
      ? { model: { providerID, id: modelID, ...(variant ? { variant } : {}) } }
      : {}),
    ...(textOf(body?.agent) ? { agent: textOf(body.agent) } : {}),
    syntheticInputs,
    prompt: {
      text: userTexts.join('\n\n'),
      ...(files.length > 0 ? { files } : {}),
      ...(agents.length > 0 ? { agents } : {}),
    },
  };
};

/** True when the planned prompt body has content worth a `session.prompt`. */
export const hasV2PromptBody = (prompt) => Boolean(
  textOf(prompt?.text).trim()
  || (Array.isArray(prompt?.files) && prompt.files.length > 0)
  || (Array.isArray(prompt?.agents) && prompt.agents.length > 0),
);

/**
 * Runs one dispatch: selection switches, then the synthetic admissions with
 * `resume: false` (only the closing prompt may wake the session), then the
 * prompt. `post(path, body)` receives the v2-named path WITHOUT the `/api`
 * prefix — URL boundaries that already translate v1 paths (buildOpenCodeUrl)
 * pass it through, raw-fetch callers add the prefix themselves. A planned
 * prompt without content fails loudly instead of admitting silent synthetics
 * that would never be executed.
 */
export const postV2PromptDispatch = async ({ sessionId, body, post, delivery = null }) => {
  const plan = planV2PromptDispatch(body);
  if (plan.model) await post(V2_PROMPT_PATHS.switchModel(sessionId), { model: plan.model });
  if (plan.agent) await post(V2_PROMPT_PATHS.switchAgent(sessionId), { agent: plan.agent });
  for (const input of plan.syntheticInputs) {
    await post(V2_PROMPT_PATHS.synthetic(sessionId), {
      text: input.text,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(delivery ? { delivery } : {}),
      resume: false,
    });
  }
  if (!hasV2PromptBody(plan.prompt)) {
    if (plan.syntheticInputs.length > 0) return plan;
    throw new Error('v2 prompt dispatch produced no prompt content');
  }
  await post(V2_PROMPT_PATHS.prompt(sessionId), {
    ...plan.prompt,
    ...(delivery ? { delivery } : {}),
  });
  return plan;
};

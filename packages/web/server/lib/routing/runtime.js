/**
 * Owns Jev routing at runtime: which classification provider answers, whether
 * Auto is ready, rewriting a prompt body that names the `openchamber/auto`
 * model, and the safety net consulted in a `safety` permission session.
 * Failure paths fall back to the user's own behaviour for routing (the
 * fallback model) and to the user's own decision for the safety net: a request
 * Jev could not check waits for the user, and the UI is told why.
 */
import { z } from 'zod';
import { isRoutingFeatureAvailable } from './feature-flag.js';
import { BUILTIN_CATEGORIES, ZEN_JEV_PROMOTION_ACTIVE, isAutoModel } from './defaults.js';
import { createRoutingStore, parseEffectiveConfig } from './store.js';
import { buildPermissionRequest, buildRoutingRequest, createJevClient, decidePermission, decideRouting } from './jev.js';
import {
  CLASSIFIER_SOURCES,
  classifierEndpoint,
  legacyClassifier,
  normalizeCustomEndpointUrl,
  readPinnedCustomEndpoint,
  resolveClassifier,
} from './classifier.js';
import { ENTERPRISE_MODE_ERROR, isEnterpriseMode } from '../enterprise-mode.js';
import { loadRoutingHistory } from './history.js';
import { readAuthFile } from '../opencode/auth.js';

const HISTORY_TIMEOUT_MS = 2500;
/** One bounded window, trimmed locally by collectRecentTurns (fork session-assist). */
const HISTORY_MESSAGE_LIMIT = 40;
/** A held permission is remembered so reconnect reconciliation does not re-ask Jev. */
const PERMISSION_DECISION_TTL_MS = 15 * 60 * 1000;

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

const customEndpointInputSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  model: z.string().trim().min(1).max(200),
  key: z.string().trim().max(4000).nullable().optional(),
});

const textPartSchema = z.object({ type: z.literal('text'), text: z.string(), synthetic: z.boolean().optional() });
const commandBodySchema = z.object({ command: z.string(), arguments: z.string().optional() });
const promptBodySchema = z.object({ parts: z.array(z.unknown()).optional() });

/** The user's words for this send: text parts the composer authored, or the slash command. */
export const requestTextOf = (body) => {
  const command = commandBodySchema.safeParse(body);
  if (command.success) {
    const args = command.data.arguments?.trim();
    return `/${command.data.command}${args ? ` ${args}` : ''}`;
  }
  const prompt = promptBodySchema.safeParse(body);
  const parts = prompt.success ? prompt.data.parts ?? [] : [];
  return parts
    .map((part) => textPartSchema.safeParse(part))
    .filter((part) => part.success && !part.data.synthetic)
    .map((part) => part.data.text)
    .join('\n\n')
    .trim();
};

/**
 * The API key the user saved in OpenCode for Zen. An OpenCode account sign-in
 * is an OAuth credential, which Zen rejects as a key, so only `api` entries
 * count. (Upstream also reads OpenRouter/Vercel keys here — segb 0b936476e,
 * batch B4.)
 */
const apiKeySchema = z.object({ type: z.literal('api'), key: z.string().min(1) });

export const readOpenCodeKeys = ({ readAuth = readAuthFile } = {}) => {
  try {
    const auth = readAuth();
    return { zenKey: apiKeySchema.safeParse(auth?.opencode).data?.key ?? null };
  } catch {
    // An unreadable credential store still leaves the OpenChamber key.
    return { zenKey: null };
  }
};

export function createRoutingRuntime({
  dataDir,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  broadcastGlobalUiEvent,
  fetchImpl = fetch,
  store = createRoutingStore({ dataDir }),
  jev = createJevClient({ fetchImpl }),
  readProviderKeys = () => readOpenCodeKeys(),
  zenPromotionActive = ZEN_JEV_PROMOTION_ACTIVE,
  enterpriseMode = isEnterpriseMode,
  readPinnedEndpoint = readPinnedCustomEndpoint,
  now = Date.now,
}) {
  const permissionDecisions = new Map();

  const broadcast = (type, properties) => {
    try {
      broadcastGlobalUiEvent?.({ type, properties });
    } catch (error) {
      console.warn(`[routing] failed to broadcast ${type}:`, errorMessage(error));
    }
  };

  const enabledCategories = (config) => config.categories.filter((category) => category.enabled);

  /** Which classification provider answers now, and where its requests go (null endpoint: no Jev). */
  const resolveAccess = async () => {
    const [typesafeKey, stored, savedEndpoint] = await Promise.all([
      store.readToken(),
      store.readClassifierSource(),
      store.readCustomEndpoint(),
    ]);
    // An endpoint the administrator pinned replaces the one saved in Settings.
    const pinned = readPinnedEndpoint();
    const customEndpoint = pinned ?? savedEndpoint;
    const keys = { typesafeKey, customEndpoint, ...readProviderKeys() };
    // Enterprise mode overrides whatever was picked; the pick itself is kept.
    // The pinned endpoint is the administrator's own, so there it is the
    // default and Off the only other choice.
    const selected = !enterpriseMode() ? stored : pinned && stored !== 'off' ? 'custom' : 'off';
    const classifier = resolveClassifier({ selected, ...keys, zenPromotionActive });
    const endpoint = classifier.effective ? classifierEndpoint(classifier.effective, keys) : null;
    return { classifier, endpoint, tokenPresent: Boolean(typesafeKey), customEndpoint, pinned: pinned !== null };
  };

  // What Settings shows of the custom endpoint: never the key itself.
  const describeCustomEndpoint = (endpoint, pinned) => (endpoint
    ? { url: endpoint.url, model: endpoint.model, keyPresent: Boolean(endpoint.key), pinned }
    : null);

  const pinnedEndpointError = () => Object.assign(
    new Error('The custom endpoint is set by your administrator and cannot be changed here'),
    { status: 409 },
  );

  /**
   * What the client needs to decide whether to offer Auto and the safety net,
   * and what Settings shows. `jevSource` is the two-value field clients from
   * before the classifier pick parse, `classifier` what slightly newer clients
   * parse, and `classification` the full picture.
   */
  const describe = async () => {
    const available = isRoutingFeatureAvailable();
    if (!available) {
      return {
        available: false, autoReady: false, jevAvailable: false, tokenPresent: false,
        config: null, builtins: [], jevSource: 'zen-free', classifier: null, classification: null,
      };
    }
    const [config, access] = await Promise.all([store.readConfig(), resolveAccess()]);
    const jevAvailable = access.endpoint !== null;
    const autoReady = jevAvailable && config.enabled && Boolean(config.fallback) && enabledCategories(config).length >= 2;
    // Built-in text travels with the config so "Reset" in Settings restores the shipped wording.
    return {
      available,
      autoReady,
      jevAvailable,
      tokenPresent: access.tokenPresent,
      config,
      builtins: BUILTIN_CATEGORIES,
      jevSource: access.classifier.effective === 'typesafe' ? 'typesafe' : 'zen-free',
      classifier: legacyClassifier(access.classifier),
      classification: access.classifier,
      customEndpoint: describeCustomEndpoint(access.customEndpoint, access.pinned),
      enterpriseMode: enterpriseMode(),
    };
  };

  const publishUpdated = async () => {
    const state = await describe();
    broadcast('openchamber:routing.updated', {
      available: state.available,
      autoReady: state.autoReady,
      jevAvailable: state.jevAvailable,
      tokenPresent: state.tokenPresent,
      jevSource: state.jevSource,
    });
    return state;
  };

  // Fork adaptation: one bounded message fetch through the shared plain-fetch
  // path (the same shape session assist reads), not the SDK client's paging.
  const readHistory = async ({ sessionId, directory }) => {
    const params = new URLSearchParams({ directory, limit: String(HISTORY_MESSAGE_LIMIT) });
    const response = await fetch(`${buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}/message`, '')}?${params}`, {
      headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
      signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenCode messages failed with ${response.status}`);
    }
    return loadRoutingHistory({ records: await response.json().catch(() => null) });
  };

  // A category without a model of its own means "the fallback pair"; a variant
  // only travels with the model it was chosen for.
  const applyChoice = (body, config, choice) => {
    const own = Boolean(choice?.model);
    const model = own ? choice.model : config.fallback.model;
    const variant = own ? choice.variant : config.fallback.variant;
    // Keep the wire shape the route uses: a string on /command, an object on the prompt routes.
    body.model = z.string().safeParse(body.model).success
      ? `${model.providerID}/${model.modelID}`
      : { providerID: model.providerID, modelID: model.modelID };
    if (variant) body.variant = variant;
    else delete body.variant;
    if (choice?.agent) body.agent = choice.agent;
    return { providerID: model.providerID, modelID: model.modelID, variant: variant ?? null, agent: choice?.agent ?? null };
  };

  /**
   * Rewrites `body.model` in place when it is the Auto sentinel. Returns the
   * decision that was applied, or null when the body named a real model.
   * Throws only when Auto cannot be honoured at all (no fallback configured):
   * the sentinel must never reach OpenCode.
   */
  const resolvePromptBody = async (body, { sessionId, directory }) => {
    if (!isAutoModel(body?.model)) return null;
    const state = await describe();
    const config = state.config;
    if (!config?.fallback) {
      throw Object.assign(new Error('Auto routing is selected but no fallback model is configured'), { status: 400 });
    }
    const decision = { sessionId, at: now(), category: null, confidence: 0, reason: 'not-ready', ms: 0 };
    if (state.autoReady) {
      const request = requestTextOf(body);
      let history = [];
      try {
        history = await readHistory({ sessionId, directory });
      } catch (error) {
        console.warn('[routing] history unavailable, routing on the request alone:', errorMessage(error));
      }
      try {
        const { endpoint } = await resolveAccess();
        if (!endpoint) throw new Error('No classification provider is available');
        const { answers, ms } = await jev.ask(buildRoutingRequest({ categories: enabledCategories(config), history, request }), endpoint);
        const result = decideRouting(answers.category, { categories: enabledCategories(config), minConfidence: config.minConfidence });
        decision.category = result.category?.id ?? null;
        decision.confidence = result.confidence;
        decision.reason = result.reason;
        decision.ms = ms;
        Object.assign(decision, applyChoice(body, config, result.category));
      } catch (error) {
        decision.reason = 'error';
        decision.error = errorMessage(error);
        Object.assign(decision, applyChoice(body, config, null));
      }
    } else {
      Object.assign(decision, applyChoice(body, config, null));
    }
    broadcast('openchamber:routing.decision', decision);
    return decision;
  };

  /**
   * Consulted by permission auto-accept in a `safety` session before it
   * replies. `accept` replies; `hold` leaves the request for the user. Only a
   * verdict from Jev accepts: with no classification provider the request
   * waits quietly, the way an `ask` session's would; when Jev fails it waits
   * too, and the UI is told why (`skipped`).
   */
  const evaluatePermission = async (permission, directory) => {
    if (!permission?.id) return { action: 'hold' };
    if (!isRoutingFeatureAvailable()) return { action: 'hold', unavailable: true };
    const cached = permissionDecisions.get(permission.id);
    if (cached && now() - cached.at < PERMISSION_DECISION_TTL_MS) return cached.result;
    const [config, access] = await Promise.all([store.readConfig(), resolveAccess()]);
    if (!access.endpoint) return { action: 'hold', unavailable: true };
    let result;
    try {
      const { answers } = await jev.ask(buildPermissionRequest(permission), access.endpoint);
      const verdict = decidePermission(answers, { threshold: config.safetyNet.threshold });
      result = verdict.hold
        ? { action: 'hold', score: verdict.score, kind: verdict.kind }
        : { action: 'accept', score: verdict.score, kind: verdict.kind };
    } catch (error) {
      // Not remembered: reconnect reconciliation asks Jev again, and may accept.
      const skipped = errorMessage(error);
      broadcast('openchamber:routing.safety-skipped', {
        permissionId: permission.id, sessionId: permission.sessionID, directory: directory ?? null, error: skipped,
      });
      return { action: 'hold', skipped };
    }
    if (result.action === 'hold') {
      broadcast('openchamber:routing.permission-held', {
        permissionId: permission.id, sessionId: permission.sessionID, directory: directory ?? null, score: result.score, kind: result.kind,
      });
    }
    permissionDecisions.set(permission.id, { at: now(), result });
    return result;
  };

  /**
   * Whether the old global safety-net switch was on. Asked once, when the
   * permission policy converts its pre-modes `true` entries: those sessions
   * were auto-accepting behind the safety net, so they become `safety`.
   */
  const legacySafetyNetEnabled = async () => {
    try {
      return (await store.readConfig()).safetyNet.enabled === true;
    } catch {
      return false;
    }
  };

  const forgetPermission = (permissionId) => {
    permissionDecisions.delete(permissionId);
  };

  const updateConfig = async (input) => {
    const config = parseEffectiveConfig(input);
    await store.writeConfig(config);
    return publishUpdated();
  };

  const setToken = async (token) => {
    const parsed = z.string().trim().min(1).max(4000).safeParse(token);
    if (!parsed.success) throw Object.assign(new Error('A Jev API key is required'), { status: 400 });
    if (enterpriseMode()) throw Object.assign(new Error(ENTERPRISE_MODE_ERROR), { status: 403 });
    await store.writeToken(parsed.data);
    // Pasting a key is choosing it.
    await store.writeClassifierSource('typesafe');
    return publishUpdated();
  };

  const clearToken = async () => {
    await store.clearToken();
    return publishUpdated();
  };

  const setClassifierSource = async (source) => {
    const parsed = z.enum(CLASSIFIER_SOURCES).safeParse(source);
    if (!parsed.success) throw Object.assign(new Error(`Unknown classification provider: ${String(source)}`), { status: 400 });
    const allowedInEnterprise = parsed.data === 'off' || (parsed.data === 'custom' && readPinnedEndpoint() !== null);
    if (enterpriseMode() && !allowedInEnterprise) throw Object.assign(new Error(ENTERPRISE_MODE_ERROR), { status: 403 });
    await store.writeClassifierSource(parsed.data);
    return publishUpdated();
  };

  /**
   * Saves the custom System One endpoint and picks it, the way saving a
   * TypeSafe key does. `key`: a string replaces the saved one, null removes
   * it, absent keeps it, so the URL or model can change without retyping it.
   */
  const setCustomEndpoint = async (input) => {
    if (readPinnedEndpoint()) throw pinnedEndpointError();
    if (enterpriseMode()) throw Object.assign(new Error(ENTERPRISE_MODE_ERROR), { status: 403 });
    const parsed = customEndpointInputSchema.safeParse(input);
    if (!parsed.success) throw Object.assign(new Error('A URL and a model are required'), { status: 400 });
    const { model, key } = parsed.data;
    const url = normalizeCustomEndpointUrl(parsed.data.url);
    // An empty key field is the same as leaving it out.
    const keepKey = key === undefined || key === '';
    const savedKey = keepKey ? (await store.readCustomEndpoint())?.key : key;
    const endpoint = { url, model };
    if (savedKey) endpoint.key = savedKey;
    await store.writeCustomEndpoint(endpoint);
    // Saving is choosing it; removing only the key is not a choice of anything.
    if (key !== null) await store.writeClassifierSource('custom');
    return publishUpdated();
  };

  const clearCustomEndpoint = async () => {
    if (readPinnedEndpoint()) throw pinnedEndpointError();
    await store.clearCustomEndpoint();
    return publishUpdated();
  };

  /** Where a Jev request goes right now, or null when no classification provider is usable. */
  const currentClassifierEndpoint = async () => (await resolveAccess()).endpoint;

  /** Held permissions the UI can read back after a reload. */
  const heldPermissions = () => {
    const held = [];
    for (const [permissionId, entry] of permissionDecisions) {
      if (entry.result.action === 'hold') held.push({ permissionId, score: entry.result.score, kind: entry.result.kind });
    }
    return held;
  };

  return {
    describe,
    resolvePromptBody,
    evaluatePermission,
    forgetPermission,
    legacySafetyNetEnabled,
    setClassifierSource,
    setCustomEndpoint,
    clearCustomEndpoint,
    classifierEndpoint: currentClassifierEndpoint,
    heldPermissions,
    updateConfig,
    setToken,
    clearToken,
  };
}

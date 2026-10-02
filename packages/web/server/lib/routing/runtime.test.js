import { describe, expect, it, vi } from 'vitest';
import { createRoutingRuntime, requestTextOf } from './runtime.js';
import { resolveEffectiveConfig } from './store.js';
import { excerptHead, excerptHeadTail, turnsToHistory } from './history.js';
import { decidePermission, decideRouting } from './jev.js';

const AUTO = { providerID: 'openchamber', modelID: 'auto' };
const FALLBACK = { model: { providerID: 'anthropic', modelID: 'claude-sonnet-5' }, variant: 'medium' };

const readyConfig = () => {
  const config = resolveEffectiveConfig(null);
  config.enabled = true;
  config.fallback = FALLBACK;
  config.safetyNet = { enabled: true, threshold: 0.6 };
  config.categories = config.categories.map((c) => (c.id === 'hard'
    ? { ...c, model: { providerID: 'openai', modelID: 'gpt-6-astra' }, variant: 'high', agent: 'plan' }
    : c));
  return config;
};

const makeRuntime = ({ config = readyConfig(), token = 'key', answers, askError, flag = '1', classifierSource = null, customEndpoint = null, providerKeys = { zenKey: null }, enterprise = false, pinned = null } = {}) => {
  process.env.OPENCHAMBER_ROUTING_ENABLE = flag;
  const events = [];
  const store = {
    readConfig: vi.fn(async () => config),
    writeConfig: vi.fn(async (next) => next),
    readToken: vi.fn(async () => token),
    writeToken: vi.fn(async () => undefined),
    clearToken: vi.fn(async () => undefined),
    readClassifierSource: vi.fn(async () => classifierSource),
    writeClassifierSource: vi.fn(async (source) => source),
    readCustomEndpoint: vi.fn(async () => customEndpoint),
    writeCustomEndpoint: vi.fn(async () => undefined),
    clearCustomEndpoint: vi.fn(async () => undefined),
  };
  const jev = { ask: vi.fn(async () => { if (askError) throw askError; return { answers, ms: 12 }; }) };
  const runtime = createRoutingRuntime({
    dataDir: '/unused',
    buildOpenCodeUrl: () => 'http://127.0.0.1:1/',
    getOpenCodeAuthHeaders: () => ({}),
    broadcastGlobalUiEvent: (event) => events.push(event),
    store,
    jev,
    readProviderKeys: () => providerKeys,
    enterpriseMode: () => enterprise,
    readPinnedEndpoint: () => pinned,
  });
  return { runtime, store, jev, events };
};

describe('requestTextOf', () => {
  it('joins authored text parts and ignores synthetic ones and files', () => {
    expect(requestTextOf({ parts: [
      { type: 'text', text: 'fix the typo' },
      { type: 'text', text: 'injected', synthetic: true },
      { type: 'file', url: 'data:...' },
      { type: 'text', text: 'in README' },
    ] })).toBe('fix the typo\n\nin README');
  });
  it('renders a slash command with its arguments', () => {
    expect(requestTextOf({ command: 'review', arguments: ' 3650 ' })).toBe('/review 3650');
  });
});

describe('history excerpts', () => {
  it('keeps the head of a user message and head plus tail of an answer', () => {
    const long = 'a'.repeat(1000);
    expect(excerptHead(long, 600)).toBe(`${'a'.repeat(600)} […]`);
    expect(excerptHeadTail(`${'h'.repeat(400)}${'m'.repeat(400)}${'t'.repeat(400)}`, 300, 300)).toBe(`${'h'.repeat(300)} […] ${'t'.repeat(300)}`);
    expect(excerptHead('short', 600)).toBe('short');
  });
  it('flattens the last three turns oldest first', () => {
    const turns = [1, 2, 3, 4].map((n) => ({ user: { text: `u${n}` }, assistant: { text: `a${n}` } }));
    expect(turnsToHistory(turns)).toEqual([
      { role: 'user', text: 'u2' }, { role: 'assistant', text: 'a2' },
      { role: 'user', text: 'u3' }, { role: 'assistant', text: 'a3' },
      { role: 'user', text: 'u4' }, { role: 'assistant', text: 'a4' },
    ]);
  });
});

describe('decisions', () => {
  const categories = readyConfig().categories;
  it('routes a confident known category and falls back otherwise', () => {
    expect(decideRouting({ choice: 'hard', confidence: 0.9 }, { categories, minConfidence: 0.6 }).reason).toBe('routed');
    expect(decideRouting({ choice: 'hard', confidence: 0.4 }, { categories, minConfidence: 0.6 })).toMatchObject({ category: null, reason: 'low-confidence' });
    expect(decideRouting({ choice: 'nope', confidence: 0.99 }, { categories, minConfidence: 0.6 })).toMatchObject({ category: null, reason: 'unknown-category' });
  });
  it('holds a permission at or above the threshold', () => {
    expect(decidePermission({ ask: { noul: 0.61 }, kind: { choice: 'git_history' } }, { threshold: 0.6 })).toEqual({ hold: true, score: 0.61, kind: 'git_history' });
    expect(decidePermission({ ask: { noul: 0.2 }, kind: { choice: 'read_only' } }, { threshold: 0.6 }).hold).toBe(false);
    expect(() => decidePermission({}, { threshold: 0.6 })).toThrow(/ask score/);
  });
});

describe('resolvePromptBody', () => {
  it('leaves a real model untouched and does not consult Jev', async () => {
    const { runtime, jev } = makeRuntime({ answers: {} });
    const body = { model: { providerID: 'anthropic', modelID: 'claude-opus-5' }, parts: [] };
    expect(await runtime.resolvePromptBody(body, { sessionId: 's1' })).toBeNull();
    expect(body.model.modelID).toBe('claude-opus-5');
    expect(jev.ask).not.toHaveBeenCalled();
  });

  it('rewrites the sentinel with the routed category model, variant and agent', async () => {
    const { runtime, events } = makeRuntime({ answers: { category: { choice: 'hard', confidence: 0.97 } } });
    const body = { model: AUTO, variant: 'low', agent: 'build', parts: [{ type: 'text', text: 'find the root cause' }] };
    const decision = await runtime.resolvePromptBody(body, { sessionId: 's1' });
    expect(body).toMatchObject({ model: { providerID: 'openai', modelID: 'gpt-6-astra' }, variant: 'high', agent: 'plan' });
    expect(decision).toMatchObject({ category: 'hard', reason: 'routed', confidence: 0.97 });
    expect(events.at(-1)).toMatchObject({ type: 'openchamber:routing.decision', properties: { sessionId: 's1', category: 'hard' } });
  });

  it('rewrites the string sentinel the command route sends, keeping the string shape', async () => {
    const { runtime } = makeRuntime({ answers: { category: { choice: 'hard', confidence: 0.97 } } });
    const body = { model: 'openchamber/auto', command: 'review', arguments: '3650' };
    await runtime.resolvePromptBody(body, { sessionId: 's1' });
    expect(body.model).toBe('openai/gpt-6-astra');
    expect(body.agent).toBe('plan');
  });

  it('uses the fallback and keeps the composer agent when the category has no model', async () => {
    const { runtime } = makeRuntime({ answers: { category: { choice: 'trivial', confidence: 0.99 } } });
    const body = { model: AUTO, variant: 'high', agent: 'build', parts: [{ type: 'text', text: 'fix typo' }] };
    await runtime.resolvePromptBody(body, { sessionId: 's1' });
    expect(body).toMatchObject({ model: FALLBACK.model, variant: 'medium', agent: 'build' });
  });

  it('falls back on low confidence and on a Jev failure, and records why', async () => {
    const low = makeRuntime({ answers: { category: { choice: 'hard', confidence: 0.3 } } });
    const body = { model: AUTO, parts: [] };
    expect((await low.runtime.resolvePromptBody(body, { sessionId: 's1' })).reason).toBe('low-confidence');
    expect(body.model).toEqual(FALLBACK.model);

    const failing = makeRuntime({ askError: Object.assign(new Error('Jev responded 401'), { status: 401 }) });
    const body2 = { model: AUTO, parts: [] };
    const decision = await failing.runtime.resolvePromptBody(body2, { sessionId: 's1' });
    expect(decision).toMatchObject({ reason: 'error', error: 'Jev responded 401' });
    expect(body2.model).toEqual(FALLBACK.model);
  });

  it('falls back without asking Jev while Auto is not ready, and refuses without a fallback', async () => {
    const config = readyConfig();
    config.enabled = false;
    const notReady = makeRuntime({ config, answers: {} });
    const body = { model: AUTO, parts: [] };
    expect((await notReady.runtime.resolvePromptBody(body, { sessionId: 's1' })).reason).toBe('not-ready');
    expect(body.model).toEqual(FALLBACK.model);
    expect(notReady.jev.ask).not.toHaveBeenCalled();

    const noFallback = makeRuntime({ config: { ...readyConfig(), fallback: null }, answers: {} });
    await expect(noFallback.runtime.resolvePromptBody({ model: AUTO, parts: [] }, { sessionId: 's1' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('evaluatePermission', () => {
  const permission = { id: 'p1', sessionID: 's1', permission: 'bash', patterns: ['git push --force'], metadata: { command: 'git push --force origin main' } };

  it('holds a risky permission and remembers the decision', async () => {
    const { runtime, jev, events } = makeRuntime({ answers: { ask: { noul: 0.9 }, kind: { choice: 'git_history' } } });
    expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'hold', score: 0.9, kind: 'git_history' });
    expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'hold', score: 0.9, kind: 'git_history' });
    expect(jev.ask).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'openchamber:routing.permission-held')).toHaveLength(1);
    expect(runtime.heldPermissions()).toEqual([{ permissionId: 'p1', score: 0.9, kind: 'git_history' }]);
    runtime.forgetPermission('p1');
    expect(runtime.heldPermissions()).toEqual([]);
  });

  it('holds when Jev is unreachable and tells the UI it skipped, without caching the skip', async () => {
    const { runtime, jev, events } = makeRuntime({ askError: Object.assign(new Error('Jev timed out after 4000ms'), { code: 'timeout' }) });
    expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'hold', skipped: 'Jev timed out after 4000ms' });
    expect(events.at(-1)).toMatchObject({ type: 'openchamber:routing.safety-skipped', properties: { permissionId: 'p1', error: 'Jev timed out after 4000ms' } });
    // A skipped check is not remembered: the reconnect reconciliation may accept.
    expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'hold', skipped: 'Jev timed out after 4000ms' });
    expect(jev.ask).toHaveBeenCalledTimes(2);
    expect(runtime.heldPermissions()).toEqual([]);
  });

  it('holds without asking when no classification provider is usable or the flag is unset', async () => {
    for (const setup of [{ token: null }, { flag: '' }]) {
      const { runtime, jev } = makeRuntime({ ...setup, answers: {} });
      expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'hold', unavailable: true });
      expect(jev.ask).not.toHaveBeenCalled();
    }
  });

  it('asks through the picked classification provider', async () => {
    const zen = makeRuntime({ token: null, classifierSource: 'zen-promo', answers: { ask: { noul: 0.1 } } });
    expect(await zen.runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'accept', score: 0.1, kind: null });
    expect(zen.jev.ask).toHaveBeenCalledTimes(1);
    expect(zen.jev.ask.mock.calls[0][1]).toMatchObject({ url: 'https://opencode.ai/zen/v1/systemone', model: 'jev-1.13-free' });

    const zenKey = makeRuntime({ token: null, classifierSource: 'zen-key', providerKeys: { zenKey: 'zk' }, answers: { ask: { noul: 0.1 } } });
    expect(await zenKey.runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'accept', score: 0.1, kind: null });
    expect(zenKey.jev.ask.mock.calls[0][1]).toMatchObject({ model: 'jev-1.13', headers: { authorization: 'Bearer zk' } });
  });

  it('falls back to a usable key when the pick lost its credential, and Off sends nothing', async () => {
    const fallback = makeRuntime({ classifierSource: 'zen-key', answers: { ask: { noul: 0.1 } } });
    expect(await fallback.runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'accept', score: 0.1, kind: null });
    expect(fallback.jev.ask.mock.calls[0][1]).toMatchObject({ model: 'jev-latest' });

    const off = makeRuntime({ classifierSource: 'off', answers: {} });
    expect(await off.runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'hold', unavailable: true });
    expect(off.jev.ask).not.toHaveBeenCalled();
  });

  it('persists an explicit classifier pick and reports the routing state', async () => {
    let picked = 'typesafe';
    const { runtime, store } = makeRuntime({ answers: {} });
    store.readClassifierSource.mockImplementation(async () => picked);
    store.writeClassifierSource.mockImplementation(async (source) => { picked = source; });
    await runtime.setClassifierSource('zen-promo');
    expect(store.writeClassifierSource).toHaveBeenCalledWith('zen-promo');
    const state = await runtime.describe();
    expect(state.classification).toMatchObject({ selected: 'zen-promo', effective: 'zen-promo' });
    expect(state.jevAvailable).toBe(true);
    // `classifier` is the pre-Off client shape; zen-promo survives it.
    expect(state.classifier).toMatchObject({ selected: 'zen-promo' });
    await expect(runtime.classifierEndpoint()).resolves.toMatchObject({ model: 'jev-1.13-free' });

    await expect(runtime.setClassifierSource('nope')).rejects.toMatchObject({ status: 400 });
  });
});

describe('describe', () => {
  it('reports Auto ready only with the flag, a usable classifier, enabled config, fallback and two categories', async () => {
    expect((await makeRuntime({ answers: {} }).runtime.describe()).autoReady).toBe(true);
    expect((await makeRuntime({ token: null, answers: {} }).runtime.describe())).toMatchObject({ autoReady: false, tokenPresent: false, jevAvailable: false });
    // The free promotion makes Jev available without any key.
    const promo = await makeRuntime({ token: null, classifierSource: 'zen-promo', answers: {} }).runtime.describe();
    expect(promo).toMatchObject({ jevAvailable: true, autoReady: true, tokenPresent: false, jevSource: 'zen-free' });
    const one = readyConfig();
    one.categories = one.categories.map((c, i) => ({ ...c, enabled: i === 0 }));
    expect((await makeRuntime({ config: one, answers: {} }).runtime.describe()).autoReady).toBe(false);
    expect(await makeRuntime({ flag: '', answers: {} }).runtime.describe()).toEqual({
      available: false, autoReady: false, jevAvailable: false, tokenPresent: false,
      config: null, builtins: [], jevSource: 'zen-free', classifier: null, classification: null,
    });
  });

  it('hides the classifier pick from clients that predate the Off source', async () => {
    const state = await makeRuntime({ classifierSource: 'off', answers: {} }).runtime.describe();
    expect(state.classifier).toBeNull();
    expect(state.classification).toMatchObject({ selected: 'off', effective: null });
  });

  it('answers the legacy safety-net question from the stored config', async () => {
    await expect(makeRuntime({ answers: {} }).runtime.legacySafetyNetEnabled()).resolves.toBe(true);
    const off = readyConfig();
    off.safetyNet.enabled = false;
    await expect(makeRuntime({ config: off, answers: {} }).runtime.legacySafetyNetEnabled()).resolves.toBe(false);
  });
});

describe('custom classification endpoint', () => {
  const endpointUrl = 'https://jev.example.com/v1/systemone';

  it('normalizes the full System One URL, an OpenAI-style /v1 base, or an API root', async () => {
    const { normalizeCustomEndpointUrl } = await import('./classifier.js');
    expect(normalizeCustomEndpointUrl(' https://jev.example.com/v1/systemone/ ')).toBe(endpointUrl);
    expect(normalizeCustomEndpointUrl('https://jev.example.com/api/v1')).toBe('https://jev.example.com/api/v1/systemone');
    expect(normalizeCustomEndpointUrl('https://api.typesafe.ai')).toBe('https://api.typesafe.ai/v1/systemone');
    expect(normalizeCustomEndpointUrl('http://127.0.0.1:8080/jev/')).toBe('http://127.0.0.1:8080/jev/v1/systemone');
    expect(() => normalizeCustomEndpointUrl('ftp://example.com')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => normalizeCustomEndpointUrl('file:///etc/passwd')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => normalizeCustomEndpointUrl('https://user:secret@example.com/v1')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => normalizeCustomEndpointUrl('example.com/v1')).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('sends a custom endpoint its own URL and model, with the key as a bearer only when one is saved', async () => {
    const { classifierEndpoint } = await import('./classifier.js');
    const keyed = classifierEndpoint('custom', { customEndpoint: { url: endpointUrl, model: 'jev-1.13', key: 'own-secret' } });
    expect(keyed.url).toBe(endpointUrl);
    expect(keyed.model).toBe('jev-1.13');
    expect(keyed.headers.authorization).toBe('Bearer own-secret');
    expect(keyed.headers['x-opencode-client']).toBeUndefined();
    const keyless = classifierEndpoint('custom', { customEndpoint: { url: endpointUrl, model: 'jev-latest' } });
    expect(keyless.headers.authorization).toBeUndefined();
  });

  it('falls back to a usable custom endpoint after TypeSafe and before OpenCode keys', async () => {
    const { resolveClassifier } = await import('./classifier.js');
    const customEndpoint = { url: endpointUrl, model: 'jev-latest' };
    expect(resolveClassifier({ selected: 'custom', customEndpoint, zenPromotionActive: true }).effective).toBe('custom');
    expect(resolveClassifier({ selected: 'custom', customEndpoint: null, zenPromotionActive: true }).effective).toBeNull();
    expect(resolveClassifier({ selected: 'zen-key', typesafeKey: 'k', customEndpoint, zenPromotionActive: true }).effective).toBe('typesafe');
    expect(resolveClassifier({ selected: 'off', customEndpoint, zenPromotionActive: true }).effective).toBeNull();
  });

  it('saves, picks and removes a custom endpoint without ever returning its key', async () => {
    let saved = null;
    const { runtime, store } = makeRuntime({ answers: {} });
    store.readCustomEndpoint.mockImplementation(async () => saved);
    store.writeCustomEndpoint.mockImplementation(async (endpoint) => { saved = endpoint; });
    store.clearCustomEndpoint.mockImplementation(async () => { saved = null; });

    await runtime.setCustomEndpoint({ url: 'https://jev.example.com', model: 'jev-1.13', key: 'own-secret' });
    expect(saved).toEqual({ url: endpointUrl, model: 'jev-1.13', key: 'own-secret' });
    expect(store.writeClassifierSource).toHaveBeenCalledWith('custom');
    const state = await runtime.describe();
    expect(state.customEndpoint).toEqual({ url: endpointUrl, model: 'jev-1.13', keyPresent: true, pinned: false });
    expect(JSON.stringify(state)).not.toContain('own-secret');

    // An empty key field keeps the saved one (and saving still picks it);
    // removing only the key (null) keeps the URL and model without a key.
    await runtime.setCustomEndpoint({ url: endpointUrl, model: 'jev-1.13', key: '' });
    expect(saved.key).toBe('own-secret');
    store.writeClassifierSource.mockClear();
    await runtime.setCustomEndpoint({ url: endpointUrl, model: 'jev-1.13', key: null });
    expect(saved).toEqual({ url: endpointUrl, model: 'jev-1.13' });
    expect(store.writeClassifierSource).not.toHaveBeenCalled();

    await runtime.clearCustomEndpoint();
    expect(saved).toBeNull();
    await expect(runtime.setCustomEndpoint({ url: 'https://jev.example.com', model: '' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('enterprise mode routing', () => {
  it('keeps Jev off in enterprise mode, whatever is picked or saved', async () => {
    const { runtime, store, jev } = makeRuntime({ enterprise: true, classifierSource: 'typesafe', answers: { ask: { noul: 0.1 } } });
    expect(await runtime.describe()).toMatchObject({ enterpriseMode: true, jevAvailable: false, autoReady: false, classification: { selected: 'off', effective: null } });
    expect(await runtime.classifierEndpoint()).toBeNull();
    await expect(runtime.setClassifierSource('zen-promo')).rejects.toMatchObject({ status: 403 });
    await expect(runtime.setToken('secret')).rejects.toMatchObject({ status: 403 });
    await runtime.setClassifierSource('off');
    expect(store.writeClassifierSource).toHaveBeenCalledTimes(1);
    expect(store.writeToken).not.toHaveBeenCalled();
    expect(jev.ask).not.toHaveBeenCalled();
  });

  describe('an endpoint pinned by the administrator', () => {
    const pinned = { url: 'https://jev.company.test/v1/systemone', model: 'jev-latest', key: 'org-secret' };
    const saved = { url: 'https://mine.example.com/v1/systemone', model: 'jev-latest' };

    it('replaces the saved one, cannot be edited, and never shows its key', async () => {
      const { runtime, store } = makeRuntime({ pinned, customEndpoint: saved, classifierSource: 'custom', answers: {} });
      const state = await runtime.describe();
      expect(state.customEndpoint).toEqual({ url: pinned.url, model: 'jev-latest', keyPresent: true, pinned: true });
      expect(JSON.stringify(state)).not.toContain('org-secret');
      expect(await runtime.classifierEndpoint()).toMatchObject({ url: pinned.url, headers: { authorization: 'Bearer org-secret' } });
      await expect(runtime.setCustomEndpoint({ url: saved.url, model: 'x' })).rejects.toMatchObject({ status: 409 });
      await expect(runtime.clearCustomEndpoint()).rejects.toMatchObject({ status: 409 });
      expect(store.writeCustomEndpoint).not.toHaveBeenCalled();
    });

    it('is the enterprise default, with Off as the only other choice', async () => {
      const { runtime, store } = makeRuntime({ enterprise: true, pinned, classifierSource: 'typesafe', answers: {} });
      expect(await runtime.describe()).toMatchObject({ jevAvailable: true, classification: { selected: 'custom', effective: 'custom' } });
      await runtime.setClassifierSource('custom');
      await runtime.setClassifierSource('off');
      await expect(runtime.setClassifierSource('typesafe')).rejects.toMatchObject({ status: 403 });
      expect(store.writeClassifierSource.mock.calls.map(([source]) => source)).toEqual(['custom', 'off']);
    });
  });
});

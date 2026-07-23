import { listProviderAuths as listLegacyProviderAuths } from '../opencode/auth.js';

const AUTH_SOURCES = new Set(['api', 'env', 'config', 'custom']);

const hasCredentialKey = (provider) => {
  if (!Object.prototype.hasOwnProperty.call(provider, 'key')) return false;
  if (typeof provider.key === 'string') return provider.key.trim().length > 0;
  return provider.key !== null && provider.key !== undefined;
};

const normalizeProvider = (provider) => ({
  id: typeof provider?.id === 'string' ? provider.id : '',
  name: typeof provider?.name === 'string' ? provider.name : '',
  source: AUTH_SOURCES.has(provider?.source) ? provider.source : null,
  env: Array.isArray(provider?.env)
    ? provider.env.filter((name) => typeof name === 'string' && name.length > 0)
    : [],
});

const mapProviderAuthState = (provider) => {
  const configured = hasCredentialKey(provider);
  const source = configured && AUTH_SOURCES.has(provider?.source) ? provider.source : 'none';
  return {
    configured,
    source,
    envVars: Array.isArray(provider?.env)
      ? provider.env.filter((name) => typeof name === 'string' && name.length > 0)
      : [],
    type: source === 'api' ? 'api' : 'unknown',
  };
};

const fetchProviderSnapshot = async ({
  fetchProvidersSnapshot,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  fetchImpl,
}) => {
  if (typeof fetchProvidersSnapshot === 'function') {
    return fetchProvidersSnapshot();
  }
  if (typeof buildOpenCodeUrl !== 'function' || typeof getOpenCodeAuthHeaders !== 'function') {
    throw new Error('OpenCode provider snapshot dependencies are unavailable');
  }

  const response = await fetchImpl(buildOpenCodeUrl('/provider'), {
    method: 'GET',
    headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch providers snapshot (status ${response.status})`);
  }
  const payload = await response.json().catch(() => null);
  const providers = Array.isArray(payload) ? payload : payload?.all;
  if (!Array.isArray(providers)) {
    throw new Error('Invalid providers snapshot payload from OpenCode');
  }
  return providers;
};

/**
 * Read provider authentication state from OpenCode, falling back to the legacy auth file.
 * @param {object} [dependencies]
 * @param {() => Promise<object[]>} [dependencies.fetchProvidersSnapshot]
 * @param {(path: string) => string} [dependencies.buildOpenCodeUrl]
 * @param {() => Record<string, string>} [dependencies.getOpenCodeAuthHeaders]
 * @param {typeof fetch} [dependencies.fetchImpl]
 * @param {() => string[]} [dependencies.listProviderAuths]
 * @returns {Promise<{providers: Array<{id: string, name: string, source: string|null, env: string[]}>, states: Record<string, {configured: boolean, source: string, envVars: string[], type: string}>, degraded: boolean}>}
 */
export const getProviderAuthStates = async ({
  fetchProvidersSnapshot,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  fetchImpl = globalThis.fetch,
  listProviderAuths = listLegacyProviderAuths,
} = {}) => {
  try {
    const snapshot = await fetchProviderSnapshot({
      fetchProvidersSnapshot,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      fetchImpl,
    });
    const providers = snapshot
      .filter((provider) => provider && typeof provider.id === 'string' && provider.id.length > 0)
      .map(normalizeProvider);
    const states = Object.fromEntries(snapshot
      .filter((provider) => provider && typeof provider.id === 'string' && provider.id.length > 0)
      .map((provider) => [provider.id, mapProviderAuthState(provider)]));
    return { providers, states, degraded: false };
  } catch (error) {
    console.warn('[subscriptions] OpenCode provider auth lookup failed; using legacy auth file:', error?.message || error);
    let providerIds = [];
    try {
      providerIds = listProviderAuths();
    } catch (legacyError) {
      console.warn('[subscriptions] Legacy provider auth lookup also failed:', legacyError?.message || legacyError);
    }
    const providers = providerIds.map((id) => ({ id, name: id, source: 'api', env: [] }));
    const states = Object.fromEntries(providerIds.map((id) => [id, {
      configured: true,
      source: 'api',
      envVars: [],
      type: 'unknown',
    }]));
    return { providers, states, degraded: true };
  }
};

/**
 * Remove provider auth through OpenCode HTTP, falling back only when OpenCode is unreachable.
 * @param {string} providerId
 * @param {object} dependencies
 * @param {(path: string) => string} dependencies.buildOpenCodeUrl
 * @param {() => Record<string, string>} dependencies.getOpenCodeAuthHeaders
 * @param {typeof fetch} [dependencies.fetchImpl]
 * @param {(providerId: string) => boolean} dependencies.removeLegacyProviderAuth
 * @returns {Promise<{removed: boolean, path: 'http'|'legacy'}>}
 */
export const removeProviderAuth = async (providerId, {
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  fetchImpl = globalThis.fetch,
  removeLegacyProviderAuth,
}) => {
  let response;
  try {
    response = await fetchImpl(buildOpenCodeUrl(`/auth/${encodeURIComponent(providerId)}`), {
      method: 'DELETE',
      headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
    });
  } catch (error) {
    console.warn(`[subscriptions] OpenCode auth DELETE unreachable for ${providerId}; using legacy auth file:`, error?.message || error);
    return { removed: removeLegacyProviderAuth(providerId), path: 'legacy' };
  }

  if (!response.ok) {
    throw new Error(`OpenCode auth DELETE failed (status ${response.status})`);
  }
  const payload = await response.json().catch(() => true);
  return { removed: payload !== false, path: 'http' };
};

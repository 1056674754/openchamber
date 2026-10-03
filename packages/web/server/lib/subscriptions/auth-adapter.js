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
 * Read provider authentication state from OpenCode. When OpenCode cannot be
 * asked the answer is an empty, explicitly degraded result: OpenCode owns the
 * credential store, so there is no local fallback that could answer for it.
 * @param {object} [dependencies]
 * @param {() => Promise<object[]>} [dependencies.fetchProvidersSnapshot]
 * @param {(path: string) => string} [dependencies.buildOpenCodeUrl]
 * @param {() => Record<string, string>} [dependencies.getOpenCodeAuthHeaders]
 * @param {typeof fetch} [dependencies.fetchImpl]
 * @returns {Promise<{providers: Array<{id: string, name: string, source: string|null, env: string[]}>, states: Record<string, {configured: boolean, source: string, envVars: string[], type: string}>, degraded: boolean}>}
 */
export const getProviderAuthStates = async ({
  fetchProvidersSnapshot,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  fetchImpl = globalThis.fetch,
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
    console.warn('[subscriptions] OpenCode provider auth lookup failed; reporting degraded with no providers:', error?.message || error);
    return { providers: [], states: {}, degraded: true };
  }
};

/**
 * Remove provider auth through OpenCode HTTP. OpenCode owns the credential
 * store; when it cannot be asked the failure is surfaced instead of edited
 * into a local file OpenCode will never read again.
 * @param {string} providerId
 * @param {object} dependencies
 * @param {(path: string) => string} dependencies.buildOpenCodeUrl
 * @param {() => Record<string, string>} dependencies.getOpenCodeAuthHeaders
 * @param {typeof fetch} [dependencies.fetchImpl]
 * @returns {Promise<{removed: boolean}>}
 */
export const removeProviderAuth = async (providerId, {
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  fetchImpl = globalThis.fetch,
}) => {
  let response;
  try {
    response = await fetchImpl(buildOpenCodeUrl(`/auth/${encodeURIComponent(providerId)}`), {
      method: 'DELETE',
      headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
    });
  } catch (error) {
    throw new Error(`OpenCode auth DELETE unreachable for ${providerId}: ${error?.message || error}`);
  }

  if (!response.ok) {
    throw new Error(`OpenCode auth DELETE failed (status ${response.status})`);
  }
  const payload = await response.json().catch(() => true);
  return { removed: payload !== false };
};

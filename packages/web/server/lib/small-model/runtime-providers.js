const SNAPSHOT_TTL_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;
export const ZEN_ANONYMOUS_API_KEY = 'public';

let connection = null;
let snapshot = null;
let snapshotAt = 0;
let inFlight = null;

export function configureOpenCodeRuntimeProviders(next) {
  connection = next ?? null;
  resetOpenCodeRuntimeProviders();
}

export function resetOpenCodeRuntimeProviders() {
  snapshot = null;
  snapshotAt = 0;
  inFlight = null;
}

const parseProviderListing = (payload) => {
  const providers = new Map();
  const connected = new Set();
  if (!payload || typeof payload !== 'object') return { providers, connected };
  const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
  const record = (value) => value && typeof value === 'object' ? value : {};
  const endpoint = (value) => text(value)?.replace(/\/+$/, '') ?? null;

  for (const raw of Array.isArray(payload.all) ? payload.all : []) {
    const provider = record(raw);
    const id = text(provider.id);
    if (!id) continue;
    const options = record(provider.options);
    const firstModel = record(Object.values(record(provider.models))[0]);
    const declaredKey = text(options.apiKey);
    providers.set(id, {
      id,
      source: text(provider.source),
      apiKey: declaredKey === ZEN_ANONYMOUS_API_KEY ? null : declaredKey ?? text(provider.key),
      baseURL: endpoint(options.baseURL) ?? endpoint(record(firstModel.api).url),
      anonymousZen: declaredKey === ZEN_ANONYMOUS_API_KEY,
    });
  }
  for (const raw of Array.isArray(payload.connected) ? payload.connected : []) {
    const id = text(raw);
    if (id) connected.add(id);
  }
  return { providers, connected };
};

const fetchSnapshot = async () => {
  const response = await fetch(connection.buildOpenCodeUrl('/provider', ''), {
    headers: { Accept: 'application/json', ...connection.getOpenCodeAuthHeaders() },
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenCode provider listing failed with ${response.status}`);
  return parseProviderListing(await response.json());
};

export async function getRuntimeProviderSnapshot() {
  if (!connection) return null;
  if (snapshot && Date.now() - snapshotAt < SNAPSHOT_TTL_MS) return snapshot;
  if (!inFlight) inFlight = fetchSnapshot().finally(() => { inFlight = null; });
  try {
    snapshot = await inFlight;
    snapshotAt = Date.now();
    return snapshot;
  } catch {
    return snapshot;
  }
}

export async function getRuntimeProvider(providerID) {
  const current = await getRuntimeProviderSnapshot();
  return current?.providers.get(providerID) ?? null;
}

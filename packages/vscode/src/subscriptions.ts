type AuthSource = 'api' | 'env' | 'config' | 'custom' | 'none';
type AuthType = 'api' | 'oauth' | 'unknown';

type ProviderAuth = {
  readonly configured: boolean;
  readonly source: AuthSource;
  readonly envVars: readonly string[];
  readonly type: AuthType;
};

type ProviderSnapshot = {
  readonly id: string;
  readonly name: string;
  readonly env: readonly string[];
  readonly auth: ProviderAuth;
};

type ConfigSource = { readonly exists?: boolean };
type ProviderSources = {
  readonly user?: ConfigSource;
  readonly project?: ConfigSource;
  readonly custom?: ConfigSource;
};

export type SubscriptionProvider = {
  readonly id: string;
  readonly name: string;
  readonly auth: ProviderAuth;
  readonly quota: { readonly providerId: string | null; readonly configured: boolean };
  readonly config: { readonly user: boolean; readonly project: boolean; readonly custom: boolean };
  readonly egress: { readonly mode: 'direct' };
  readonly conflicts: readonly { readonly type: 'env-override'; readonly message: string }[];
};

export type SubscriptionsPayload = {
  readonly providers: readonly SubscriptionProvider[];
  readonly degraded: boolean;
  readonly fetchedAt: number;
};

type AggregateSubscriptionsOptions = {
  readonly workingDirectory?: string;
  readonly processEnv?: Readonly<Record<string, string | undefined>>;
  readonly fetchProvidersSnapshot: () => Promise<readonly unknown[]>;
  readonly listProviderAuths: () => readonly string[];
  readonly getProviderSources: (providerId: string, workingDirectory?: string) => ProviderSources;
  readonly listConfiguredQuotaProviders: () => readonly string[];
  readonly now?: () => number;
};

type FetchProviderSnapshotOptions = {
  readonly apiUrl: string | null;
  readonly authHeaders: Readonly<Record<string, string>>;
  readonly fetchImpl?: typeof fetch;
};

const QUOTA_PROVIDER_BY_ALIAS: Readonly<Record<string, string>> = {
  anthropic: 'claude',
  claude: 'claude',
  openai: 'codex',
  codex: 'codex',
  chatgpt: 'codex',
  cursor: 'cursor',
  google: 'google',
  'zai-coding-plan': 'zai-coding-plan',
  zai: 'zai-coding-plan',
  'z.ai': 'zai-coding-plan',
  'zhipuai-coding-plan': 'zhipuai-coding-plan',
  zhipuai: 'zhipuai-coding-plan',
  zhipu: 'zhipuai-coding-plan',
  'kimi-for-coding': 'kimi-for-coding',
  kimi: 'kimi-for-coding',
  openrouter: 'openrouter',
  'nano-gpt': 'nano-gpt',
  nanogpt: 'nano-gpt',
  nano_gpt: 'nano-gpt',
  'github-copilot-addon': 'github-copilot-addon',
  'github-copilot': 'github-copilot',
  copilot: 'github-copilot',
  'minimax-coding-plan': 'minimax-coding-plan',
  'minimax-cn-coding-plan': 'minimax-cn-coding-plan',
  'ollama-cloud': 'ollama-cloud',
  ollamacloud: 'ollama-cloud',
  wafer: 'wafer',
  'wafer-ai': 'wafer',
  wafer_ai: 'wafer',
  'wafer.ai': 'wafer',
  'opencode-go': 'opencode-go',
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const normalizeSource = (value: unknown): Exclude<AuthSource, 'none'> | null => {
  if (value === 'api' || value === 'env' || value === 'config' || value === 'custom') {
    return value;
  }
  return null;
};

const normalizeEnvVars = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string' && name.length > 0)
    : []
);

const hasCredentialKey = (provider: Record<string, unknown>): boolean => {
  if (!Object.prototype.hasOwnProperty.call(provider, 'key')) return false;
  const key = provider.key;
  return typeof key === 'string' ? key.trim().length > 0 : key !== null && key !== undefined;
};

const normalizeProvider = (value: unknown): ProviderSnapshot | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) return null;
  const configured = hasCredentialKey(value);
  const configuredSource = normalizeSource(value.source);
  const source = configured && configuredSource ? configuredSource : 'none';
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    env: normalizeEnvVars(value.env),
    auth: {
      configured,
      source,
      envVars: normalizeEnvVars(value.env),
      type: source === 'api' ? 'api' : 'unknown',
    },
  };
};

const legacyProvider = (id: string): ProviderSnapshot => ({
  id,
  name: id,
  env: [],
  auth: { configured: true, source: 'api', envVars: [], type: 'unknown' },
});

export async function fetchOpenCodeProviderSnapshot({
  apiUrl,
  authHeaders,
  fetchImpl = globalThis.fetch,
}: FetchProviderSnapshotOptions): Promise<readonly unknown[]> {
  if (!apiUrl) throw new Error('OpenCode manager unavailable');
  const base = `${apiUrl.replace(/\/+$/, '')}/`;
  const response = await fetchImpl(new URL('provider', base), {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeaders },
  });
  if (!response.ok) throw new Error(`Failed to fetch providers snapshot (status ${response.status})`);
  const payload: unknown = await response.json();
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.all)) return payload.all;
  throw new Error('Invalid providers snapshot payload from OpenCode');
}

export async function aggregateSubscriptions({
  workingDirectory,
  processEnv = process.env,
  fetchProvidersSnapshot,
  listProviderAuths,
  getProviderSources,
  listConfiguredQuotaProviders,
  now = Date.now,
}: AggregateSubscriptionsOptions): Promise<SubscriptionsPayload> {
  let degraded = false;
  let providerSnapshots: readonly ProviderSnapshot[];
  try {
    const snapshot = await fetchProvidersSnapshot();
    providerSnapshots = snapshot.map(normalizeProvider).filter((provider): provider is ProviderSnapshot => provider !== null);
  } catch {
    degraded = true;
    let legacyProviderIds: readonly string[] = [];
    try {
      legacyProviderIds = listProviderAuths();
    } catch {
      legacyProviderIds = [];
    }
    providerSnapshots = legacyProviderIds.map(legacyProvider);
  }

  const configuredQuotaProviders = new Set(listConfiguredQuotaProviders());
  const providers = providerSnapshots.map((provider): SubscriptionProvider => {
    const quotaProviderId = QUOTA_PROVIDER_BY_ALIAS[provider.id] ?? null;
    const sources = getProviderSources(provider.id, workingDirectory);
    const conflicts = provider.auth.configured && provider.auth.source !== 'env' && provider.auth.source !== 'none'
      ? provider.env
        .filter((name) => processEnv[name] !== undefined)
        .map((name) => ({
          type: 'env-override' as const,
          message: `${name} is set and may take precedence over stored credentials`,
        }))
      : [];

    return {
      id: provider.id,
      name: provider.name || provider.id,
      auth: provider.auth,
      quota: {
        providerId: quotaProviderId,
        configured: quotaProviderId ? configuredQuotaProviders.has(quotaProviderId) : false,
      },
      config: {
        user: sources.user?.exists === true,
        project: sources.project?.exists === true,
        custom: sources.custom?.exists === true,
      },
      egress: { mode: 'direct' },
      conflicts,
    };
  });

  return { providers, degraded, fetchedAt: now() };
}

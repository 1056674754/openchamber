import { getProviderSources as readProviderSources } from '../opencode/providers.js';
import { listConfiguredQuotaProviders as readConfiguredQuotaProviders } from '../quota/providers/index.js';
import * as claudeQuota from '../quota/providers/claude.js';
import * as codexQuota from '../quota/providers/codex.js';
import * as copilotQuota from '../quota/providers/copilot.js';
import * as cursorQuota from '../quota/providers/cursor.js';
import * as kimiQuota from '../quota/providers/kimi.js';
import * as minimaxCnQuota from '../quota/providers/minimax-cn-coding-plan.js';
import * as minimaxQuota from '../quota/providers/minimax-coding-plan.js';
import * as nanogptQuota from '../quota/providers/nanogpt.js';
import * as ollamaCloudQuota from '../quota/providers/ollama-cloud.js';
import * as openCodeGoQuota from '../quota/providers/opencode-go.js';
import * as openrouterQuota from '../quota/providers/openrouter.js';
import * as waferQuota from '../quota/providers/wafer.js';
import * as zaiQuota from '../quota/providers/zai.js';
import * as zhipuQuota from '../quota/providers/zhipuai-coding-plan.js';
import { getProviderAuthStates } from './auth-adapter.js';
import { detectConflicts } from './conflicts.js';

const QUOTA_PROVIDERS = [
  claudeQuota,
  codexQuota,
  cursorQuota,
  { providerId: 'google', aliases: ['google'] },
  zaiQuota,
  zhipuQuota,
  kimiQuota,
  openrouterQuota,
  nanogptQuota,
  { providerId: copilotQuota.providerIdAddon, aliases: [] },
  copilotQuota,
  minimaxQuota,
  minimaxCnQuota,
  ollamaCloudQuota,
  waferQuota,
  openCodeGoQuota,
];

const resolveQuotaProviderId = (providerId) => {
  const exact = QUOTA_PROVIDERS.find((provider) => provider.providerId === providerId);
  if (exact) return exact.providerId;
  const match = QUOTA_PROVIDERS.find((provider) => provider.aliases?.includes(providerId));
  return match?.providerId ?? null;
};

/**
 * Build the read-only subscriptions payload from OpenCode, quota, and config sources.
 * @param {object} dependencies
 * @param {string|null} [dependencies.workingDirectory]
 * @param {Record<string, string|undefined>} [dependencies.processEnv]
 * @param {() => Promise<object[]>} [dependencies.fetchProvidersSnapshot]
 * @param {(providerId: string, workingDirectory?: string|null) => object} [dependencies.getProviderSources]
 * @param {() => Promise<string[]>} [dependencies.listConfiguredQuotaProviders]
 * @param {() => number} [dependencies.now]
 * @returns {Promise<{providers: object[], degraded: boolean, fetchedAt: number}>}
 */
export const aggregateSubscriptions = async ({
  workingDirectory = null,
  processEnv = process.env,
  fetchProvidersSnapshot,
  getProviderSources = readProviderSources,
  listConfiguredQuotaProviders = readConfiguredQuotaProviders,
  now = Date.now,
}) => {
  const authResult = await getProviderAuthStates({ fetchProvidersSnapshot });
  // Reading OpenCode's stored credentials fails while OpenCode is down; the
  // quota flags then answer "not configured" and the degraded flag carries
  // the failure instead of a stale credential list masquerading as state.
  let configuredProviderIds = [];
  try {
    configuredProviderIds = await listConfiguredQuotaProviders();
  } catch {
    // Degraded: the degraded flag below carries the failure.
  }
  const configuredQuotaProviders = new Set(configuredProviderIds);

  const providers = authResult.providers.map((provider) => {
    const auth = authResult.states[provider.id] ?? {
      configured: false,
      source: 'none',
      envVars: provider.env,
      type: 'unknown',
    };
    const quotaProviderId = resolveQuotaProviderId(provider.id);
    const sourceResult = getProviderSources(provider.id, workingDirectory);
    const configSources = sourceResult?.sources ?? {};
    return {
      id: provider.id,
      name: provider.name || provider.id,
      auth,
      quota: {
        providerId: quotaProviderId,
        configured: quotaProviderId ? configuredQuotaProviders.has(quotaProviderId) : false,
      },
      config: {
        user: configSources.user?.exists === true,
        project: configSources.project?.exists === true,
        custom: configSources.custom?.exists === true,
      },
      egress: { mode: 'direct' },
      conflicts: detectConflicts({ ...provider, auth }, processEnv),
    };
  });

  return {
    providers,
    degraded: authResult.degraded,
    fetchedAt: now(),
  };
};

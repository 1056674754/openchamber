import type { DesktopSettings } from '@/lib/desktop';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { updateDesktopSettings } from '@/lib/persistence';

const INVISIBLE_FORMAT_CHARS = /[\u200B-\u200D\uFEFF]/g;

type AgentNameLike = {
  readonly name?: string;
};

export type OpenChamberSettingsPatch = Pick<
  DesktopSettings,
  'defaultModel' | 'defaultVariant' | 'defaultAgent' | 'zenModel' | 'gitProviderId' | 'gitModelId'
>;

export type ConfiguredAgentNameResolution = {
  readonly name?: string;
  readonly correctedName?: string;
  readonly invalid: boolean;
};

export const normalizeConfigString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(INVISIBLE_FORMAT_CHARS, '').trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeAgentNameForMatch = (value: string): string =>
  value.replace(INVISIBLE_FORMAT_CHARS, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export const resolveConfiguredAgentName = (
  configuredAgent: string | undefined,
  agents: readonly AgentNameLike[],
): ConfiguredAgentNameResolution => {
  const normalizedConfiguredAgent = normalizeConfigString(configuredAgent);
  if (!normalizedConfiguredAgent) {
    return { invalid: false };
  }

  const exactMatch = agents.find((agent) => agent.name === normalizedConfiguredAgent);
  if (exactMatch?.name) {
    return {
      name: exactMatch.name,
      correctedName: exactMatch.name === configuredAgent ? undefined : exactMatch.name,
      invalid: false,
    };
  }

  const comparableConfiguredAgent = normalizeAgentNameForMatch(normalizedConfiguredAgent);
  const normalizedMatch = agents.find((agent) => (
    typeof agent.name === 'string' && normalizeAgentNameForMatch(agent.name) === comparableConfiguredAgent
  ));
  if (normalizedMatch?.name) {
    return {
      name: normalizedMatch.name,
      correctedName: normalizedMatch.name,
      invalid: false,
    };
  }

  return { invalid: true };
};

export const persistOpenChamberSettingsPatch = async (
  changes: OpenChamberSettingsPatch,
  serverBaseUrl?: string,
): Promise<void> => {
  if (!serverBaseUrl) {
    await updateDesktopSettings(changes);
    return;
  }

  const response = await fetch(resolveApiUrl('/api/config/settings', serverBaseUrl), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(changes),
  });

  if (!response.ok) {
    throw new Error(`Failed to update remote settings (${response.status})`);
  }
};

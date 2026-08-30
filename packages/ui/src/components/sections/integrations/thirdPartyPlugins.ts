import type { PluginEntry, RegistryResult } from '@/stores/usePluginsStore';

export type ThirdPartyPluginDefinition = {
  id: 'opencode-claude' | 'opencode-cursor-oauth';
  packageName: string;
  providerId: string;
  logoProviderId: string;
  nameKey:
    | 'settings.integrations.thirdParty.opencodeClaude.name'
    | 'settings.integrations.thirdParty.opencodeCursorOauth.name';
  descriptionKey:
    | 'settings.integrations.thirdParty.opencodeClaude.description'
    | 'settings.integrations.thirdParty.opencodeCursorOauth.description';
  homepage: string;
};

/** Final v1.20 catalog. Command Code was retired as an installable plugin. */
export const THIRD_PARTY_PLUGINS: readonly ThirdPartyPluginDefinition[] = [
  {
    id: 'opencode-claude',
    packageName: '@openchamber/opencode-claude',
    providerId: 'claude-code',
    logoProviderId: 'claude',
    nameKey: 'settings.integrations.thirdParty.opencodeClaude.name',
    descriptionKey: 'settings.integrations.thirdParty.opencodeClaude.description',
    homepage: 'https://github.com/openchamber/opencode-claude',
  },
  {
    id: 'opencode-cursor-oauth',
    packageName: '@openchamber/opencode-cursor',
    providerId: 'cursor',
    logoProviderId: 'cursor',
    nameKey: 'settings.integrations.thirdParty.opencodeCursorOauth.name',
    descriptionKey: 'settings.integrations.thirdParty.opencodeCursorOauth.description',
    homepage: 'https://github.com/openchamber/opencode-cursor',
  },
] as const;

export type CatalogPluginState = {
  userEntry: PluginEntry | null;
  userEntryIsAmbiguous: boolean;
  projectEntries: PluginEntry[];
  registry: RegistryResult | null;
};

export type CatalogPluginPrimaryAction = 'install' | 'update' | 'setup' | 'manage';

export type CatalogPluginPresentationStatus =
  | 'not-installed'
  | 'installed'
  | 'installed-version'
  | 'update-available'
  | 'unpinned'
  | 'ambiguous'
  | 'restart-required'
  | 'registry-unavailable'
  | 'provider-unavailable';

type CatalogPluginPresentationOptions = {
  registryUnavailable?: boolean;
  restartRequired?: boolean;
  providerUnavailable?: boolean;
};

export type CatalogPluginPresentation = {
  status: CatalogPluginPresentationStatus;
  latestVersion: string | null;
};

export const specMatchesPackage = (spec: string, packageName: string): boolean =>
  spec === packageName || spec.startsWith(`${packageName}@`);

export const getCatalogPluginState = (
  entries: readonly PluginEntry[],
  packageName: string,
  registryInfo: Readonly<Record<string, RegistryResult>>,
): CatalogPluginState => {
  const matchingEntries = entries.filter((entry) => specMatchesPackage(entry.spec, packageName));
  const userEntries = matchingEntries.filter((entry) => entry.scope === 'user');
  const projectEntries = matchingEntries.filter((entry) => entry.scope === 'project');
  const userEntry = userEntries.length === 1 ? userEntries[0] : null;
  const registry = registryInfo[userEntry?.spec ?? packageName] ?? registryInfo[packageName] ?? null;

  return {
    userEntry,
    userEntryIsAmbiguous: userEntries.length > 1,
    projectEntries,
    registry,
  };
};

export const getLatestNpmSpec = (
  packageName: string,
  registry: RegistryResult | null | undefined,
): string | null => {
  if (registry?.kind !== 'npm-ok' || registry.name !== packageName || !registry.latestVersion) {
    return null;
  }
  return `${packageName}@${registry.latestVersion}`;
};

export const getCatalogPluginPrimaryAction = (
  state: CatalogPluginState,
  packageName: string,
): CatalogPluginPrimaryAction => {
  if (state.userEntryIsAmbiguous) return 'manage';
  if (!state.userEntry) return 'install';

  const latestSpec = getLatestNpmSpec(packageName, state.registry);
  return latestSpec && latestSpec !== state.userEntry.spec ? 'update' : 'setup';
};

export const getCatalogPluginPresentation = (
  state: CatalogPluginState,
  options: CatalogPluginPresentationOptions = {},
): CatalogPluginPresentation => {
  const latestVersion = state.registry?.kind === 'npm-ok'
    ? state.registry.latestVersion
    : null;

  if (state.userEntryIsAmbiguous) return { status: 'ambiguous', latestVersion };
  if (options.restartRequired) return { status: 'restart-required', latestVersion };
  if (options.providerUnavailable) return { status: 'provider-unavailable', latestVersion };
  if (options.registryUnavailable) return { status: 'registry-unavailable', latestVersion };
  if (!state.userEntry) return { status: 'not-installed', latestVersion };
  if (state.registry?.kind === 'npm-ok' && state.registry.currentVersion === state.registry.latestVersion) {
    return { status: 'installed-version', latestVersion };
  }
  if (state.registry?.kind === 'npm-ok' && state.registry.currentVersion === null) {
    return { status: 'unpinned', latestVersion };
  }
  if (state.registry?.kind === 'npm-ok' && latestVersion) {
    return { status: 'update-available', latestVersion };
  }
  return { status: 'installed', latestVersion };
};

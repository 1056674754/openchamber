import type { SidebarSection } from '@/constants/sidebar';

export type SettingsPageSlug =
  | 'home'
  | 'projects'
  | 'remote-instances'
  | 'remote-connection'
  | 'remote-port-forwarding'
  | 'remote-projects'
  | 'config-sync'
  | 'providers'
  | 'usage'
  | 'subscriptions'
  | 'agents'
  | 'behavior'
  | 'commands'
  | 'mcp'
  | 'plugins'
  | 'permissions'
  | 'config-presets'
  | 'skills.installed'
  | 'skills.catalog'
  | 'git'
  | 'appearance'
  | 'chat'
  | 'shortcuts'
  | 'sessions'
  | 'routing'
  | 'magic-prompts'
  | 'snippets'
  | 'notifications'
  | 'voice'
  | 'integrations'
  | 'tunnel'
  | 'pairing';

export type SettingsPageGroup =
  | 'appearance'
  | 'projects'
  | 'general'
  | 'opencode'
  | 'instance'
  | 'git'
  | 'skills'
  | 'usage'
  | 'sync'
  | 'advanced'
  | 'external';

export type InstanceVisibility = 'default' | 'remote' | 'both';

export interface SettingsRuntimeContext {
  isVSCode: boolean;
  isWeb: boolean;
  isDesktop: boolean;
  /** True when the server was started by the Desktop app (Electron), even if the
   *  client is a plain browser accessing it via tunnel from a phone/iPad. */
  isDesktopServer: boolean;
  /** Whether this server build has Jev routing (`OPENCHAMBER_ROUTING_ENABLE`). */
  routingAvailable: boolean;
}

export interface SettingsPageMeta {
  slug: SettingsPageSlug;
  title: string;
  group: SettingsPageGroup;
  kind: 'single' | 'split';
  /** Which instance types display this page in the nav and content area. */
  showOn?: InstanceVisibility;
  description?: string;
  keywords?: string[];
  isAvailable?: (ctx: SettingsRuntimeContext) => boolean;
}

export type SettingsInstanceType = 'default' | 'remote';

export function isSettingsPageVisibleForInstance(
  page: SettingsPageMeta,
  instanceType: SettingsInstanceType,
): boolean {
  const showOn = page.showOn ?? 'both';
  if (showOn === 'both') {
    return true;
  }
  return showOn === instanceType;
}

export const SETTINGS_GROUP_LABELS: Record<SettingsPageGroup, string> = {
  appearance: 'Appearance',
  projects: 'Projects',
  general: 'General',
  opencode: 'OpenCode',
  instance: 'Instance',
  git: 'Git',
  skills: 'Skills',
  usage: 'Usage',
  sync: 'Sync',
  advanced: 'Advanced',
  external: 'External',
};

export const SETTINGS_PAGE_METADATA: readonly SettingsPageMeta[] = [
  {
    slug: 'home',
    title: 'Settings',
    group: 'general',
    kind: 'single',
    description: 'Search and jump to common pages.',
    keywords: ['search', 'settings'],
  },
  {
    slug: 'projects',
    title: 'Projects',
    group: 'projects',
    kind: 'split',
    showOn: 'default',
    keywords: ['project', 'projects', 'worktree', 'worktrees', 'repo', 'repository', 'directory'],
  },
  {
    slug: 'remote-instances',
    title: 'Remote Instances',
    group: 'external',
    kind: 'split',
    showOn: 'default',
    keywords: ['ssh', 'remote', 'instances', 'tunnels', 'forwarding', 'connection'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
  {
    slug: 'remote-connection',
    title: 'Connection',
    group: 'instance',
    kind: 'single',
    showOn: 'remote',
    keywords: ['ssh', 'connection', 'status', 'logs', 'connect', 'disconnect'],
    isAvailable: () => false,
  },
  {
    slug: 'remote-port-forwarding',
    title: 'Port Forwarding',
    group: 'instance',
    kind: 'single',
    showOn: 'remote',
    keywords: ['port', 'forwarding', 'tunnels', 'proxy'],
    isAvailable: () => false,
  },
  {
    slug: 'remote-projects',
    title: 'Remote Projects',
    group: 'instance',
    kind: 'single',
    showOn: 'remote',
    keywords: ['project', 'directory', 'remote', 'worktree'],
  },
  {
    slug: 'providers',
    title: 'Providers',
    group: 'opencode',
    kind: 'split',
    showOn: 'both',
    keywords: ['provider', 'providers', 'models', 'model', 'api key', 'api keys', 'openai', 'anthropic', 'ollama', 'credentials'],
  },
  {
    slug: 'usage',
    title: 'Usage',
    group: 'usage',
    kind: 'split',
    showOn: 'default',
    keywords: ['quota', 'billing', 'tokens', 'usage', 'limits'],
  },
  {
    slug: 'subscriptions',
    title: 'Subscriptions',
    group: 'usage',
    kind: 'split',
    showOn: 'both',
    description: 'Read-only view of provider credentials, quota linkage, and conflicts.',
    keywords: ['subscription', 'subscriptions', 'auth', 'credentials', 'api key', 'oauth', 'quota', 'egress', 'conflicts'],
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    group: 'general',
    kind: 'single',
    showOn: 'both',
    keywords: ['integration', 'plugin', 'provider', 'oauth', 'claude', 'cursor', 'subscription', 'github', 'linear'],
  },
  {
    slug: 'agents',
    title: 'Agents',
    group: 'opencode',
    kind: 'split',
    showOn: 'both',
    keywords: ['agent', 'agents', 'prompts', 'tools', 'permissions'],
  },
  {
    slug: 'behavior',
    title: 'Behavior',
    group: 'opencode',
    kind: 'single',
    showOn: 'default',
    keywords: ['behavior', 'agents.md', 'system prompt', 'global rules', 'instructions', 'override', 'tokens', 'optimize', 'minimal'],
  },
  {
    slug: 'commands',
    title: 'Commands',
    group: 'opencode',
    kind: 'split',
    showOn: 'both',
    keywords: ['command', 'commands', 'slash', 'macros', 'automation'],
  },
  {
    slug: 'mcp',
    title: 'MCP',
    group: 'opencode',
    kind: 'split',
    showOn: 'both',
    keywords: ['mcp', 'model context protocol', 'servers', 'tools', 'remote', 'stdio'],
  },
  {
    slug: 'plugins',
    title: 'Plugins',
    group: 'opencode',
    kind: 'split',
    showOn: 'default',
    keywords: ['plugin', 'plugins', 'extensions', 'addons', 'npm', 'opencode-wakatime'],
  },
  {
    slug: 'permissions',
    title: 'Permissions',
    group: 'opencode',
    kind: 'split',
    showOn: 'default',
    keywords: ['permission', 'permissions', 'tools', 'rules', 'ask', 'allow', 'deny'],
  },
  {
    slug: 'config-presets',
    title: 'Presets',
    group: 'opencode',
    kind: 'single',
    showOn: 'default',
    keywords: ['preset', 'presets', 'template', 'config', 'install', 'preferences'],
  },
  {
    slug: 'config-sync',
    title: 'Config Sync',
    group: 'sync',
    kind: 'single',
    showOn: 'remote',
    keywords: ['sync', 'config', 'diff', 'push', 'pull', 'distribute'],
    isAvailable: () => false,
  },
  {
    slug: 'skills.installed',
    title: 'Skills',
    group: 'skills',
    kind: 'split',
    showOn: 'both',
    keywords: ['skill', 'skills', 'instructions', 'install', 'catalog'],
  },
  {
    slug: 'skills.catalog',
    title: 'Skills Catalog',
    group: 'skills',
    kind: 'single',
    showOn: 'default',
    keywords: ['install', 'catalog', 'external', 'repository', 'skills catalog'],
  },
  {
    slug: 'git',
    title: 'Git',
    group: 'git',
    kind: 'single',
    showOn: 'default',
    keywords: ['git', 'identity', 'identities', 'ssh', 'profiles', 'credentials', 'keys', 'commit', 'gitmoji'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
  {
    slug: 'appearance',
    title: 'Appearance',
    group: 'appearance',
    kind: 'single',
    showOn: 'default',
    keywords: ['theme', 'font', 'spacing', 'padding', 'corner radius', 'radius', 'input bar', 'keyboard', 'viewport', 'mobile', 'terminal', 'pwa', 'install name', 'app shortcuts'],
  },
  {
    slug: 'chat',
    title: 'Chat',
    group: 'general',
    kind: 'single',
    showOn: 'default',
    keywords: ['tools', 'diff', 'reasoning', 'dotfiles', 'draft', 'queue', 'output', 'copy', 'image', 'split messages', 'message actions'],
  },
  {
    slug: 'shortcuts',
    title: 'Shortcuts',
    group: 'general',
    kind: 'single',
    showOn: 'default',
    keywords: ['keyboard', 'hotkeys', 'shortcuts', 'bindings'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
  {
    slug: 'sessions',
    title: 'Sessions',
    group: 'general',
    kind: 'single',
    showOn: 'both',
    keywords: ['defaults', 'default agent', 'default model', 'retention', 'memory', 'limits', 'zen'],
  },
  {
    slug: 'routing',
    title: 'Routing',
    group: 'general',
    kind: 'single',
    showOn: 'default',
    description: 'Pick the right model for each message automatically, and get asked before risky actions in auto-accepted sessions.',
    keywords: ['routing', 'auto', 'jev', 'typesafe', 'model routing', 'categories', 'safety net', 'auto-accept', 'fallback'],
    isAvailable: (ctx) => !ctx.isVSCode && ctx.routingAvailable,
  },
  {
    slug: 'magic-prompts',
    title: 'Magic Prompts',
    group: 'general',
    kind: 'split',
    showOn: 'both',
    keywords: ['prompts', 'templates', 'git', 'github', 'review', 'commit', 'pull request'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
  {
    slug: 'snippets',
    title: 'Snippets',
    group: 'general',
    kind: 'split',
    showOn: 'both',
    keywords: ['prompt', 'templates', 'multi-run', 'strategy', 'approach'],
  },

  { slug: 'notifications', title: 'Notifications', group: 'general', kind: 'single', showOn: 'default', keywords: ['alerts', 'native', 'summary', 'summarization'], },
  { slug: 'voice', title: 'Voice', group: 'advanced', kind: 'single', showOn: 'default', keywords: ['tts', 'speech', 'voice'], isAvailable: (ctx) => !ctx.isVSCode },
  { slug: 'tunnel', title: 'Remote Tunnel', group: 'advanced', kind: 'single', showOn: 'default', keywords: ['tunnel', 'cloudflare', 'ngrok', 'remote', 'share'], isAvailable: (ctx) => !ctx.isVSCode },
  {
    slug: 'pairing',
    title: 'Private Relay',
    group: 'advanced',
    kind: 'single',
    showOn: 'default',
    keywords: ['relay', 'pairing', 'qr', 'mobile', 'openchamber://', 'anywhere', 'private relay', 'device'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
] as const;

export const LEGACY_SIDEBAR_SECTION_TO_SETTINGS_SLUG: Record<SidebarSection, SettingsPageSlug> = {
  sessions: 'sessions',
  agents: 'agents',
  commands: 'commands',
  mcp: 'mcp',
  skills: 'skills.installed',
  providers: 'providers',
  usage: 'usage',
  'git-identities': 'git',
  settings: 'home',
};

export function getSettingsPageMeta(slug: string): SettingsPageMeta | null {
  const normalized = slug.trim().toLowerCase();
  return (SETTINGS_PAGE_METADATA as readonly SettingsPageMeta[]).find((page) => page.slug === normalized) ?? null;
}

export function resolveSettingsSlug(value: string | null | undefined): SettingsPageSlug {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) {
    return 'home';
  }

  const legacy = (LEGACY_SIDEBAR_SECTION_TO_SETTINGS_SLUG as Record<string, SettingsPageSlug>)[normalized];
  if (legacy) {
    return legacy;
  }

  const direct = getSettingsPageMeta(normalized);
  if (direct) {
    return direct.slug;
  }

  return 'home';
}

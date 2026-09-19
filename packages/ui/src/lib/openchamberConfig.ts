/**
 * OpenChamber project-level configuration service.
 * Stores per-project settings in ~/.config/openchamber/<projectId>.json.
 * Migrates from legacy <project>/.openchamber/openchamber.json.
 */

import { z } from 'zod';

import type { FilesAPI, RuntimeAPIs } from './api/types';
import { resolveApiUrl as resolveServerApiUrl } from './api/serverUrl';
import { getDesktopHomeDirectory } from './desktop';
import { isVSCodeRuntime } from './desktop';
import { DEFAULT_SERVER_ID, serverRegistry } from './opencode/server-registry';
import { registerRemoteInstanceProxy } from './remote-instances/registry';
import { createProjectIdFromPath } from './projectId';
import { runtimeFetch } from './runtime-fetch';
import { sanitizeStarterRefs, type DraftStarterRef } from './draftStarters';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { resolveBaseUrl as resolveDirectoryBaseUrl } from '@/sync/session-actions';

export type ProjectRef = { id: string; path: string; serverId?: string };

type FileRequestContext = {
  baseUrl?: string;
  directory?: string;
  remoteUnavailable?: boolean;
};

const CONFIG_FILENAME = 'openchamber.json';
// LEGACY_PROJECT_CONFIG: legacy per-project config root inside repo.
const LEGACY_CONFIG_DIR = '.openchamber';
const USER_PROJECTS_DIR_SEGMENTS = ['.config', 'openchamber', 'projects'];

/**
 * Get the runtime Files API if available (Desktop/VSCode).
 */
function getRuntimeFilesAPI(): FilesAPI | null {
  if (typeof window === 'undefined') return null;
  const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__;
  if (apis?.files) {
    return apis.files;
  }
  return null;
}

export interface OpenChamberConfig {
  projectPath?: string;
  'setup-worktree'?: string[];
  projectNotes?: string;
  projectTodos?: OpenChamberProjectTodoItem[];
  projectPlanFiles?: OpenChamberProjectPlanFileLink[];
  projectActions?: OpenChamberProjectAction[];
  projectActionsPrimaryId?: string;
  draftStarters?: DraftStarterRef[];
}

export type OpenChamberProjectActionPlatform = 'macos' | 'linux' | 'windows';

export interface OpenChamberProjectAction {
  id: string;
  name: string;
  command: string;
  icon?: string | null;
  runIn?: 'parent';
  /** Present on merged entries only. */
  source?: ProjectSetupSource;
  platforms?: OpenChamberProjectActionPlatform[];
  autoOpenUrl?: boolean;
  openUrl?: string;
  desktopOpenSshForward?: string;
}

export interface OpenChamberProjectActionsState {
  actions: OpenChamberProjectAction[];
  primaryActionId: string | null;
}

export interface OpenChamberProjectTodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

export interface OpenChamberProjectPlanFileLink {
  id: string;
  path: string;
  createdAt: number;
}

export interface OpenChamberProjectPlanFile {
  title: string;
  body: string;
  raw: string;
  path: string;
}

export interface OpenChamberProjectNotesTodos {
  notes: string;
  todos: OpenChamberProjectTodoItem[];
}

export interface OpenChamberProjectContextData extends OpenChamberProjectNotesTodos {
  plans: OpenChamberProjectPlanFileLink[];
}

export const OPENCHAMBER_PROJECT_NOTES_MAX_LENGTH = 3000;
export const OPENCHAMBER_PROJECT_TODO_TEXT_MAX_LENGTH = 120;
export const OPENCHAMBER_PROJECT_ACTION_NAME_MAX_LENGTH = 80;
export const OPENCHAMBER_PROJECT_ACTION_COMMAND_MAX_LENGTH = 4000;
export const OPENCHAMBER_PROJECT_ACTION_OPEN_URL_MAX_LENGTH = 2000;
export const OPENCHAMBER_PROJECT_ACTION_DESKTOP_FORWARD_MAX_LENGTH = 300;
export const OPENCHAMBER_PROJECT_PLAN_TITLE_MAX_LENGTH = 160;

const OPENCHAMBER_ACTION_PLATFORM_SET = new Set<OpenChamberProjectActionPlatform>(['macos', 'linux', 'windows']);

const normalize = (value: string): string => {
  if (!value) return '';
  const replaced = value.replace(/\\/g, '/');
  return replaced === '/' ? '/' : replaced.replace(/\/+$/, '');
};

const joinPath = (base: string, segment: string): string => {
  const normalizedBase = normalize(base);
  const cleanSegment = segment.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalizedBase || normalizedBase === '/') {
    return `/${cleanSegment}`;
  }
  return `${normalizedBase}/${cleanSegment}`;
};

const getLegacyConfigPath = (projectDirectory: string): string => {
  return joinPath(joinPath(projectDirectory, LEGACY_CONFIG_DIR), CONFIG_FILENAME);
};

const resolveProjectFileContext = (project: ProjectRef): FileRequestContext => {
  const projectDirectory = typeof project?.path === 'string' ? normalize(project.path.trim()) : '';
  const knownProject = useProjectsStore.getState().projects.find((entry) => {
    if (project.id && entry.id === project.id) {
      return true;
    }
    return projectDirectory && normalize(entry.path) === projectDirectory;
  });
  const serverId = project.serverId ?? knownProject?.serverId;
  let baseUrl: string | undefined;
  let remoteUnavailable = false;

  if (serverId && serverId !== DEFAULT_SERVER_ID) {
    const conn = serverRegistry.get(serverId)
      ?? registerRemoteInstanceProxy({
        id: serverId,
        label: knownProject?.label || serverId,
        healthStatus: 'connecting',
      });
    if (conn.healthStatus === 'unhealthy') {
      remoteUnavailable = true;
    } else {
      baseUrl = conn.config.baseUrl;
    }
  } else if (projectDirectory) {
    try {
      baseUrl = resolveDirectoryBaseUrl(projectDirectory);
    } catch {
      remoteUnavailable = true;
    }
  }
  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(projectDirectory ? { directory: projectDirectory } : {}),
    ...(remoteUnavailable ? { remoteUnavailable } : {}),
  };
};

const getApiUrl = (path: string, context?: FileRequestContext): string => {
  const envBaseUrl = import.meta.env.VITE_OPENCODE_URL || undefined;
  return resolveServerApiUrl(path, context?.baseUrl ?? envBaseUrl);
};

const appendDirectoryContext = <T extends Record<string, unknown>>(
  body: T,
  context?: FileRequestContext
): T & { directory?: string } => {
  if (!context?.directory) {
    return body;
  }
  return {
    ...body,
    directory: context.directory,
  };
};

const postJson = async <T>(url: string, body: unknown): Promise<{ ok: boolean; data: T | null }> => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { ok: false, data: null };
    }
    const data = (await response.json().catch(() => null)) as T | null;
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
};

const mkdirp = async (path: string, context?: FileRequestContext): Promise<boolean> => {
  if (context?.remoteUnavailable) {
    return false;
  }
  const runtimeFiles = getRuntimeFilesAPI();
  if (!context?.baseUrl && runtimeFiles?.createDirectory) {
    try {
      const result = await runtimeFiles.createDirectory(path);
      if (result?.success) {
        return true;
      }
    } catch {
      // fall through
    }
  }

  const res = await postJson<{ success?: boolean }>(
    getApiUrl('/api/fs/mkdir', context),
    appendDirectoryContext({ path }, context)
  );
  return Boolean(res.ok);
};

const readTextFile = async (path: string, context?: FileRequestContext): Promise<string | null> => {
  if (context?.remoteUnavailable) {
    return null;
  }
  const runtimeFiles = getRuntimeFilesAPI();
  if (!context?.baseUrl && runtimeFiles?.readFile) {
    try {
      const result = await runtimeFiles.readFile(path);
      const content = typeof result?.content === 'string' ? result.content : '';
      return content;
    } catch {
      return null;
    }
  }

  try {
    const params = new URLSearchParams({ path });
    if (context?.directory) {
      params.set('directory', context.directory);
    }
    const response = await fetch(`${getApiUrl('/api/fs/read', context)}?${params.toString()}`, {
      // Avoid conditional requests (304 + empty body).
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
};

const writeTextFile = async (path: string, content: string, context?: FileRequestContext): Promise<boolean> => {
  if (context?.remoteUnavailable) {
    return false;
  }
  const runtimeFiles = getRuntimeFilesAPI();
  if (!context?.baseUrl && runtimeFiles?.writeFile) {
    try {
      const result = await runtimeFiles.writeFile(path, content);
      if (result?.success) {
        return true;
      }
    } catch {
      // fall through
    }
  }

  const res = await postJson<{ success?: boolean }>(
    getApiUrl('/api/fs/write', context),
    appendDirectoryContext({ path, content }, context)
  );
  return Boolean(res.ok);
};

const resolveHomeDirectory = async (context?: FileRequestContext): Promise<string | null> => {
  if (context?.remoteUnavailable) {
    return null;
  }
  // Use server-reported home as the source of truth for user config paths.
  // In some runtimes, window.__OPENCHAMBER_HOME__ can be workspace/project-root
  // scoped, which would incorrectly route writes into the project directory.
  try {
    const response = await fetch(getApiUrl('/api/fs/home', context), {
      // Avoid conditional requests (304 + empty body).
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error('Failed to resolve home directory from API');
    }
    const payload = await response.json().catch(() => null) as { home?: unknown } | null;
    const home = typeof payload?.home === 'string' ? payload.home.trim() : '';
    if (home) {
      return normalize(home);
    }
  } catch {
    // fall through
  }

  if (context?.baseUrl) {
    return null;
  }

  // Fallback for environments where /api/fs/home is unavailable.
  // VSCode intentionally avoids this because embedded home equals workspace path.
  if (!isVSCodeRuntime()) {
    const desktopHome = await getDesktopHomeDirectory().catch(() => null);
    if (desktopHome && desktopHome.trim().length > 0) {
      return normalize(desktopHome);
    }
  }
  return null;
};

const getUserProjectsDirectory = async (context?: FileRequestContext): Promise<string | null> => {
  const home = await resolveHomeDirectory(context);
  if (!home) {
    return null;
  }
  return USER_PROJECTS_DIR_SEGMENTS.reduce((acc, segment) => joinPath(acc, segment), home);
};

const resolveConfigProjectId = (project: ProjectRef): string | null => {
  const projectDirectory = typeof project?.path === 'string' ? project.path.trim() : '';
  const normalizedProject = projectDirectory ? normalize(projectDirectory) : '';
  if (!normalizedProject) return null;
  return createProjectIdFromPath(normalizedProject) || null;
};

const getUserConfigPath = async (project: ProjectRef, context?: FileRequestContext): Promise<string | null> => {
  const base = await getUserProjectsDirectory(context);
  if (!base) {
    return null;
  }
  const safeId = resolveConfigProjectId(project);
  if (!safeId) {
    return null;
  }
  return joinPath(base, `${safeId}.json`);
};

const trimToMaxLength = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
};

const sanitizeProjectNotes = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return trimToMaxLength(value, OPENCHAMBER_PROJECT_NOTES_MAX_LENGTH);
};

const sanitizeProjectTodoItems = (value: unknown): OpenChamberProjectTodoItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const sanitized: OpenChamberProjectTodoItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as {
      id?: unknown;
      text?: unknown;
      completed?: unknown;
      createdAt?: unknown;
    };

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const textRaw = typeof record.text === 'string' ? record.text : '';
    const text = trimToMaxLength(textRaw.trim(), OPENCHAMBER_PROJECT_TODO_TEXT_MAX_LENGTH);
    if (!id || !text) {
      continue;
    }

    const completed = Boolean(record.completed);
    const createdAt =
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) && record.createdAt >= 0
        ? record.createdAt
        : Date.now();

    sanitized.push({
      id,
      text,
      completed,
      createdAt,
    });

  }

  return sanitized;
};

const sanitizeProjectPlanFileLinks = (value: unknown): OpenChamberProjectPlanFileLink[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const sanitized: OpenChamberProjectPlanFileLink[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as {
      id?: unknown;
      path?: unknown;
      createdAt?: unknown;
    };

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    const createdAt =
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) && record.createdAt >= 0
        ? record.createdAt
        : Date.now();

    if (!id || !path || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    sanitized.push({ id, path, createdAt });
  }

  return sanitized.sort((a, b) => b.createdAt - a.createdAt);
};

const sanitizeProjectActionPlatforms = (value: unknown): OpenChamberProjectActionPlatform[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique: OpenChamberProjectActionPlatform[] = [];
  const seen = new Set<OpenChamberProjectActionPlatform>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const normalized = entry.trim().toLowerCase() as OpenChamberProjectActionPlatform;
    if (!OPENCHAMBER_ACTION_PLATFORM_SET.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
};

const sanitizeProjectActions = (value: unknown): OpenChamberProjectAction[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const sanitized: OpenChamberProjectAction[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as {
      id?: unknown;
      name?: unknown;
      command?: unknown;
      icon?: unknown;
      platforms?: unknown;
      autoOpenUrl?: unknown;
      openUrl?: unknown;
      desktopOpenSshForward?: unknown;
    };

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = trimToMaxLength(typeof record.name === 'string' ? record.name.trim() : '', OPENCHAMBER_PROJECT_ACTION_NAME_MAX_LENGTH);
    const command = trimToMaxLength(typeof record.command === 'string' ? record.command.trim() : '', OPENCHAMBER_PROJECT_ACTION_COMMAND_MAX_LENGTH);

    if (!id || !name || !command || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const iconRaw = typeof record.icon === 'string' ? record.icon.trim() : '';
    const platforms = sanitizeProjectActionPlatforms(record.platforms);
    const autoOpenUrl = record.autoOpenUrl === true;
    const openUrlRaw = typeof record.openUrl === 'string' ? record.openUrl.trim() : '';
    const openUrl = trimToMaxLength(openUrlRaw, OPENCHAMBER_PROJECT_ACTION_OPEN_URL_MAX_LENGTH);
    const desktopOpenSshForwardRaw = typeof record.desktopOpenSshForward === 'string'
      ? record.desktopOpenSshForward.trim()
      : '';
    const desktopOpenSshForward = trimToMaxLength(
      desktopOpenSshForwardRaw,
      OPENCHAMBER_PROJECT_ACTION_DESKTOP_FORWARD_MAX_LENGTH
    );

    sanitized.push({
      id,
      name,
      command,
      icon: iconRaw || null,
      ...(autoOpenUrl ? { autoOpenUrl: true } : {}),
      ...(openUrl ? { openUrl } : {}),
      ...(desktopOpenSshForward ? { desktopOpenSshForward } : {}),
      ...(platforms.length > 0 ? { platforms } : {}),
    });
  }

  return sanitized;
};

const sanitizeProjectActionsState = (value: {
  actions?: unknown;
  primaryActionId?: unknown;
} | null | undefined): OpenChamberProjectActionsState => {
  const actions = sanitizeProjectActions(value?.actions);
  const primaryRaw = typeof value?.primaryActionId === 'string' ? value.primaryActionId.trim() : '';
  const primaryActionId = primaryRaw && actions.some((entry) => entry.id === primaryRaw)
    ? primaryRaw
    : null;

  return {
    actions,
    primaryActionId,
  };
};

const sanitizeProjectNotesAndTodos = (value: {
  notes?: unknown;
  todos?: unknown;
} | null | undefined): OpenChamberProjectNotesTodos => {
  return {
    notes: sanitizeProjectNotes(value?.notes),
    todos: sanitizeProjectTodoItems(value?.todos),
  };
};

const sanitizeProjectContextData = (value: {
  notes?: unknown;
  todos?: unknown;
  plans?: unknown;
} | null | undefined): OpenChamberProjectContextData => {
  const notesAndTodos = sanitizeProjectNotesAndTodos(value);
  return {
    ...notesAndTodos,
    plans: sanitizeProjectPlanFileLinks(value?.plans),
  };
};

const slugifyPlanTitle = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[`*_#>[\](){}.!?,:;"']/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'plan';
};

const sanitizePlanTitle = (value: string): string => {
  return trimToMaxLength(value.trim(), OPENCHAMBER_PROJECT_PLAN_TITLE_MAX_LENGTH);
};

const createProjectPlanId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const getProjectStorageDirectory = async (
  project: ProjectRef,
  context?: FileRequestContext
): Promise<string | null> => {
  const base = await getUserProjectsDirectory(context);
  const safeId = resolveConfigProjectId(project);
  if (!base || !safeId) {
    return null;
  }
  return joinPath(base, safeId);
};

const getProjectPlansDirectory = async (
  project: ProjectRef,
  context?: FileRequestContext
): Promise<string | null> => {
  const projectDirectory = await getProjectStorageDirectory(project, context);
  if (!projectDirectory) {
    return null;
  }
  return joinPath(projectDirectory, 'plans');
};

export const formatProjectPlanMarkdown = (title: string, body: string): string => {
  const normalizedTitle = sanitizePlanTitle(title) || 'Plan';
  const normalizedBody = body.trim();
  return normalizedBody
    ? `# ${normalizedTitle}\n\n${normalizedBody}`
    : `# ${normalizedTitle}\n`;
};

export const parseProjectPlanMarkdown = (raw: string): { title: string; body: string } => {
  const text = typeof raw === 'string' ? raw : '';
  const normalized = text.replace(/\r\n?/g, '\n');
  const match = normalized.match(/^\s*#\s+(.+?)\s*(?:\n+|$)/);
  if (match) {
    const title = sanitizePlanTitle(match[1]);
    const body = normalized.slice(match[0].length).replace(/^\n+/, '');
    return {
      title: title || 'Plan',
      body,
    };
  }

  const firstNonEmptyLine = normalized.split('\n').map((line) => line.trim()).find(Boolean) || 'Plan';
  return {
    title: sanitizePlanTitle(firstNonEmptyLine.replace(/^#+\s*/, '')) || 'Plan',
    body: normalized.trim(),
  };
};

/**
 * Read the config for a project.
 * Returns null if file doesn't exist or is invalid.
 */
export async function readOpenChamberConfig(project: ProjectRef): Promise<OpenChamberConfig | null> {
  const projectDirectory = typeof project?.path === 'string' ? project.path.trim() : '';
  if (!projectDirectory) {
    return null;
  }

  const fileContext = resolveProjectFileContext(project);
  const configPath = await getUserConfigPath(project, fileContext);

  const readText = async (path: string): Promise<string | null> => {
    // Keep behavior consistent with other helpers.
    const text = await readTextFile(path, fileContext);
    if (text === null) {
      return null;
    }
    return text;
  };

  const parseConfig = (text: string | null): OpenChamberConfig | null => {
    if (typeof text !== 'string') {
      return null;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed as OpenChamberConfig;
    } catch {
      return null;
    }
  };

  // 1) Prefer new per-user config.
  if (configPath) {
    const existing = parseConfig(await readText(configPath));
    if (existing) {
      return existing;
    }
  }

  // 2) Migrate legacy <project>/.openchamber/openchamber.json.
  // LEGACY_PROJECT_CONFIG: migrate project-local openchamber.json -> ~/.config/openchamber/projects/<projectId>.json
  const legacyPath = getLegacyConfigPath(projectDirectory);
  const legacyConfig = parseConfig(await readText(legacyPath));
  if (!legacyConfig) {
    return null;
  }

  // Best-effort write + delete legacy.
  try {
    const wrote = await writeOpenChamberConfig(project, legacyConfig);
    if (wrote) {
      await deleteLegacyOpenChamberConfig(projectDirectory, fileContext);
    }
  } catch {
    // Ignore migration failures; still return legacy content.
  }

  return legacyConfig;
}

/**
 * Write the per-user config for a project.
 *
 * Server owns `version` and `scheduledTasks` keys; client reads them via their
 * dedicated route and never round-trips them through this config write path to
 * avoid a read-then-write race clobbering a concurrent server update.
 */
export async function writeOpenChamberConfig(
  project: ProjectRef,
  config: OpenChamberConfig
): Promise<boolean> {
  const projectDirectory = typeof project?.path === 'string' ? project.path.trim() : '';
  if (!projectDirectory) {
    return false;
  }

  const fileContext = resolveProjectFileContext(project);
  const configDir = await getUserProjectsDirectory(fileContext);
  const configPath = await getUserConfigPath(project, fileContext);
  if (!configDir || !configPath) {
    return false;
  }

  try {
    const okDir = await mkdirp(configDir, fileContext);
    if (!okDir) {
      return false;
    }

    const existingRaw = await readTextFile(configPath, fileContext);
    let existing: Record<string, unknown> = {};
    if (typeof existingRaw === 'string' && existingRaw.trim()) {
      try {
        const parsed = JSON.parse(existingRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        existing = {};
      }
    }

    const serverOwned: Record<string, unknown> = {};
    if (existing.version !== undefined) serverOwned.version = existing.version;
    if (existing.scheduledTasks !== undefined) serverOwned.scheduledTasks = existing.scheduledTasks;

    const content = JSON.stringify({
      ...existing,
      ...config,
      ...serverOwned,
      projectPath: normalize(projectDirectory),
    }, null, 2);
    return await writeTextFile(configPath, content, fileContext);
  } catch (error) {
    console.error('Failed to write openchamber config:', error);
    return false;
  }
}

/**
 * Update specific keys in the config, preserving other values.
 */
export async function updateOpenChamberConfig(
  project: ProjectRef,
  updates: Partial<OpenChamberConfig>
): Promise<boolean> {
  const existing = await readOpenChamberConfig(project) || {};
  const merged = { ...existing, ...updates };
  return writeOpenChamberConfig(project, merged);
}

/**
 * Get worktree setup commands from config.
 */
export async function getWorktreeSetupCommands(project: ProjectRef): Promise<string[]> {
  const config = await readOpenChamberConfig(project);
  return config?.['setup-worktree'] ?? [];
}

export async function saveWorktreeSetupCommands(project: ProjectRef, commands: string[]): Promise<boolean> {
  const filtered = commands.filter((cmd) => cmd.trim().length > 0);
  return updateOpenChamberConfig(project, { 'setup-worktree': filtered });
}

// Upstream 82a0ee757: project starters come from the merged setup view
// (shared ones first), not from a direct read of the personal file.
export async function getProjectDraftStarters(project: ProjectRef): Promise<ProjectDraftStarter[]> {
  return (await getProjectSetup(project)).draftStarters;
}

export async function saveProjectDraftStarters(project: ProjectRef, starters: DraftStarterRef[]): Promise<boolean> {
  return updateProjectSetup(project, { draftStarters: sanitizeStarterRefs(starters) });
}

export async function getProjectNotesAndTodos(project: ProjectRef): Promise<OpenChamberProjectNotesTodos> {
  const config = await readOpenChamberConfig(project);
  return sanitizeProjectNotesAndTodos({
    notes: config?.projectNotes,
    todos: config?.projectTodos,
  });
}

export async function saveProjectNotesAndTodos(
  project: ProjectRef,
  value: OpenChamberProjectNotesTodos
): Promise<boolean> {
  const sanitized = sanitizeProjectNotesAndTodos({
    notes: value.notes,
    todos: value.todos,
  });

  return updateOpenChamberConfig(project, {
    projectNotes: sanitized.notes,
    projectTodos: sanitized.todos,
  });
}

export async function getProjectContextData(project: ProjectRef): Promise<OpenChamberProjectContextData> {
  const config = await readOpenChamberConfig(project);
  return sanitizeProjectContextData({
    notes: config?.projectNotes,
    todos: config?.projectTodos,
    plans: config?.projectPlanFiles,
  });
}

export async function getProjectPlanFiles(project: ProjectRef): Promise<OpenChamberProjectPlanFileLink[]> {
  const config = await readOpenChamberConfig(project);
  return sanitizeProjectPlanFileLinks(config?.projectPlanFiles);
}

export async function saveProjectPlanFiles(
  project: ProjectRef,
  value: OpenChamberProjectPlanFileLink[]
): Promise<boolean> {
  const sanitized = sanitizeProjectPlanFileLinks(value);
  return updateOpenChamberConfig(project, {
    projectPlanFiles: sanitized,
  });
}

export async function readProjectPlanFile(
  path: string,
  project?: ProjectRef
): Promise<OpenChamberProjectPlanFile | null> {
  const trimmedPath = typeof path === 'string' ? path.trim() : '';
  if (!trimmedPath) {
    return null;
  }

  const raw = await readTextFile(trimmedPath, project ? resolveProjectFileContext(project) : undefined);
  if (raw === null) {
    return null;
  }

  const parsed = parseProjectPlanMarkdown(raw);
  return {
    title: parsed.title,
    body: parsed.body,
    raw,
    path: trimmedPath,
  };
}

const deleteFile = async (path: string, context?: FileRequestContext): Promise<boolean> => {
  if (context?.remoteUnavailable) {
    return false;
  }
  const runtimeFiles = getRuntimeFilesAPI();
  if (!context?.baseUrl && runtimeFiles?.delete) {
    try {
      const result = await runtimeFiles.delete(path);
      if (result?.success !== false) {
        return true;
      }
    } catch {
      // fall through
    }
  }

  const res = await postJson<{ success?: boolean }>(
    getApiUrl('/api/fs/delete', context),
    appendDirectoryContext({ path }, context)
  );
  return Boolean(res.ok);
};

export async function deleteProjectPlanFile(
  project: ProjectRef,
  planId: string
): Promise<boolean> {
  const trimmedId = typeof planId === 'string' ? planId.trim() : '';
  if (!trimmedId) {
    return false;
  }
  const fileContext = resolveProjectFileContext(project);

  const existing = await getProjectPlanFiles(project);
  const target = existing.find((entry) => entry.id === trimmedId);
  if (!target) {
    return false;
  }

  const next = existing.filter((entry) => entry.id !== trimmedId);
  const saved = await saveProjectPlanFiles(project, next);
  if (!saved) {
    return false;
  }

  // Best-effort: remove underlying markdown file, ignore failure.
  await deleteFile(target.path, fileContext).catch(() => false);
  return true;
}

export async function importProjectPlanFileFromContent(
  project: ProjectRef,
  content: string,
  fallbackTitle?: string
): Promise<OpenChamberProjectPlanFileLink | null> {
  const raw = typeof content === 'string' ? content : '';
  if (!raw.trim()) {
    return null;
  }

  const parsed = parseProjectPlanMarkdown(raw);
  const title = parsed.title || sanitizePlanTitle(fallbackTitle ?? '') || 'Plan';
  return createProjectPlanFile(project, { title, body: parsed.body });
}

export async function createProjectPlanFile(
  project: ProjectRef,
  value: { title: string; body: string }
): Promise<OpenChamberProjectPlanFileLink | null> {
  const fileContext = resolveProjectFileContext(project);
  const plansDirectory = await getProjectPlansDirectory(project, fileContext);
  if (!plansDirectory) {
    return null;
  }

  const title = sanitizePlanTitle(value.title) || 'Plan';
  const createdAt = Date.now();
  const id = createProjectPlanId();
  const filePath = joinPath(plansDirectory, `${createdAt}-${slugifyPlanTitle(title)}.md`);

  const projectDirectory = await getProjectStorageDirectory(project, fileContext);
  if (!projectDirectory) {
    return null;
  }

  const createdProjectDir = await mkdirp(projectDirectory, fileContext);
  const createdPlansDir = createdProjectDir ? await mkdirp(plansDirectory, fileContext) : false;
  if (!createdProjectDir || !createdPlansDir) {
    return null;
  }

  const wrote = await writeTextFile(filePath, formatProjectPlanMarkdown(title, value.body), fileContext);
  if (!wrote) {
    return null;
  }

  const existing = await getProjectPlanFiles(project);
  const nextEntry = { id, path: filePath, createdAt };
  const saved = await saveProjectPlanFiles(project, [nextEntry, ...existing]);
  if (!saved) {
    return null;
  }

  return nextEntry;
}

export async function getProjectActionsState(project: ProjectRef): Promise<OpenChamberProjectActionsState> {
  const config = await readOpenChamberConfig(project);
  return sanitizeProjectActionsState({
    actions: config?.projectActions,
    primaryActionId: config?.projectActionsPrimaryId,
  });
}

export async function saveProjectActionsState(
  project: ProjectRef,
  value: OpenChamberProjectActionsState
): Promise<boolean> {
  const sanitized = sanitizeProjectActionsState({
    actions: value.actions,
    primaryActionId: value.primaryActionId,
  });

  return updateOpenChamberConfig(project, {
    projectActions: sanitized.actions,
    projectActionsPrimaryId: sanitized.primaryActionId ?? undefined,
  });
}

/**
 * Substitute variables in a command string.
 * Supported variables:
 * - $ROOT_PROJECT_PATH: The root project directory path
 * - $ROOT_WORKTREE_PATH: Legacy alias for $ROOT_PROJECT_PATH
 */
export function substituteCommandVariables(
  command: string,
  variables: { rootWorktreePath: string }
): string {
  return command
    // New preferred name
    .replace(/\$ROOT_PROJECT_PATH/g, variables.rootWorktreePath)
    .replace(/\$\{ROOT_PROJECT_PATH\}/g, variables.rootWorktreePath)
    // Legacy
    .replace(/\$ROOT_WORKTREE_PATH/g, variables.rootWorktreePath)
    .replace(/\$\{ROOT_WORKTREE_PATH\}/g, variables.rootWorktreePath);
}

async function deleteLegacyOpenChamberConfig(
  projectDirectory: string,
  context?: FileRequestContext
): Promise<void> {
  if (context?.remoteUnavailable) {
    return;
  }
  const legacyPath = getLegacyConfigPath(projectDirectory);
  const runtimeFiles = getRuntimeFilesAPI();

  if (!context?.baseUrl && runtimeFiles?.delete) {
    try {
      await runtimeFiles.delete(legacyPath);
      return;
    } catch {
      // fall through
    }
  }

  try {
    await postJson(
      getApiUrl('/api/fs/delete', context),
      appendDirectoryContext({ path: legacyPath }, context)
    );
  } catch {
    // ignored
  }
}


// ── Project setup (upstream 82a0ee757) ─────────────────────────────────────
// The client view of the project's setup: the personal config file merged with
// the team's optional `.openchamber/project.json` in the checkout. The server
// (or the VS Code bridge) sanitizes; the client only checks the shape.

/** Where a merged entry came from: the repo's shared file or the user's own file. */
export type ProjectSetupSource = 'shared' | 'personal';

const sourceSchema = z.enum(['shared', 'personal']);

const projectActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  icon: z.string().nullable().optional(),
  runIn: z.literal('parent').optional(),
  platforms: z.array(z.enum(['macos', 'linux', 'windows'])).optional(),
  autoOpenUrl: z.literal(true).optional(),
  openUrl: z.string().optional(),
  desktopOpenSshForward: z.string().optional(),
});

const starterRefsSchema = z.unknown().transform((value) => sanitizeStarterRefs(value));

const sourcedStartersSchema = z.array(z.object({
  type: z.enum(['command', 'skill']),
  name: z.string().min(1),
  source: sourceSchema,
}));

const sharedSchema = z.object({
  status: z.enum(['missing', 'ok', 'invalid']),
  reason: z.string().optional(),
  path: z.string(),
  setupWorktree: z.array(z.string()),
  setupWorktreeWait: z.boolean().nullable(),
  projectActions: z.array(projectActionSchema),
  draftStarters: starterRefsSchema,
  plansDir: z.string().nullable(),
});

const personalSchema = z.object({
  setupWorktree: z.array(z.string()),
  setupWorktreeWait: z.boolean().nullable(),
  setupWorktreeMode: z.enum(['append', 'replace']),
  projectActions: z.array(projectActionSchema),
  projectActionsPrimaryId: z.string().nullable(),
  draftStarters: starterRefsSchema,
  hiddenSharedActionIds: z.array(z.string()),
  sharedTrust: z.object({ hash: z.string(), trustedAt: z.number() }).nullable(),
});

const projectSetupSchema = z.object({
  /** Nothing to trust when `hash` is null; otherwise trusted only for the recorded hash. */
  trust: z.object({ hash: z.string().nullable(), trusted: z.boolean() }),
  setupWorktree: z.array(z.string()),
  setupWorktreeWait: z.boolean(),
  projectActions: z.array(projectActionSchema.extend({ source: sourceSchema })),
  projectActionsPrimaryId: z.string().nullable(),
  draftStarters: sourcedStartersSchema,
  shared: sharedSchema,
  personal: personalSchema,
});

export type ProjectSetup = z.infer<typeof projectSetupSchema>;

/** The starters pinned for this project, shared ones first, each marked with its source. */
export type ProjectDraftStarter = DraftStarterRef & { source: ProjectSetupSource };

/** What a client may change: the personal file only. */
export type ProjectSetupPatch = Partial<{
  setupWorktree: string[];
  setupWorktreeWait: boolean;
  setupWorktreeMode: 'append' | 'replace';
  projectActions: OpenChamberProjectAction[];
  projectActionsPrimaryId: string | null;
  draftStarters: DraftStarterRef[];
  hiddenSharedActionIds: string[];
  /** The trust answer for the shared commands with this hash; `null` forgets it. */
  sharedTrustHash: string | null;
}>;

const EMPTY_PROJECT_SETUP: ProjectSetup = {
  trust: { hash: null, trusted: true },
  setupWorktree: [],
  setupWorktreeWait: false,
  projectActions: [],
  projectActionsPrimaryId: null,
  draftStarters: [],
  shared: {
    status: 'missing',
    path: '.openchamber/project.json',
    setupWorktree: [],
    setupWorktreeWait: null,
    projectActions: [],
    draftStarters: [],
    plansDir: null,
  },
  personal: {
    setupWorktree: [],
    setupWorktreeWait: null,
    setupWorktreeMode: 'append',
    projectActions: [],
    projectActionsPrimaryId: null,
    draftStarters: [],
    hiddenSharedActionIds: [],
    sharedTrust: null,
  },
};

/**
 * The storage id is derived from the project path, not from `project.id`:
 * project ids in settings have churned across versions, and the path-derived
 * id is what names the config file on disk and locates the checkout.
 */
const resolveProjectSetupId = (project: ProjectRef): string => {
  const projectPath = typeof project?.path === 'string' ? project.path.trim() : '';
  return projectPath ? createProjectIdFromPath(projectPath) : '';
};

const projectSetupEndpointFor = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/config`;

const parseSetupResponse = async (response: Response): Promise<ProjectSetup> => {
  const parsed = projectSetupSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Project config response has an unexpected shape');
  }
  return parsed.data;
};

/** The project's merged setup, or the empty setup when it cannot be read. */
export async function getProjectSetup(project: ProjectRef): Promise<ProjectSetup> {
  const projectId = resolveProjectSetupId(project);
  if (!projectId) return EMPTY_PROJECT_SETUP;
  try {
    const response = await runtimeFetch(projectSetupEndpointFor(projectId), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await parseSetupResponse(response);
  } catch (error) {
    console.warn('Failed to read project config:', error);
    return EMPTY_PROJECT_SETUP;
  }
}

/** Change the personal part of the project's setup. */
export async function updateProjectSetup(project: ProjectRef, patch: ProjectSetupPatch): Promise<boolean> {
  const projectId = resolveProjectSetupId(project);
  if (!projectId) return false;
  try {
    const response = await runtimeFetch(projectSetupEndpointFor(projectId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...patch, projectPath: project.path.trim() }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await parseSetupResponse(response);
    return true;
  } catch (error) {
    console.warn('Failed to save project config:', error);
    return false;
  }
}

/** The source mark is the server's to add; it never travels back in a write. */
const withoutSource = (action: OpenChamberProjectAction): OpenChamberProjectAction => {
  const { source: _source, ...rest } = action as OpenChamberProjectAction & { source?: ProjectSetupSource };
  return rest;
};

/** What a client may change in the team's shared file; every named key replaces the current value. */
export type SharedProjectSetupPatch = Partial<{
  setupWorktree: string[];
  setupWorktreeWait: boolean | null;
  projectActions: OpenChamberProjectAction[];
  draftStarters: DraftStarterRef[];
  plansDir: string | null;
}>;

/**
 * Change the team's shared file in the checkout (`<repo>/.openchamber/project.json`).
 * The server removes the file when nothing is left in it, and records trust
 * for the commands this instance just shared. Resolves the merged view, or
 * `null` on failure so a caller can tell "saved nothing" from "saved and empty".
 */
export async function updateSharedProjectSetup(project: ProjectRef, patch: SharedProjectSetupPatch): Promise<ProjectSetup | null> {
  const projectId = resolveProjectSetupId(project);
  if (!projectId) return null;
  const body: SharedProjectSetupPatch = { ...patch };
  if (patch.projectActions) body.projectActions = patch.projectActions.map(withoutSource);
  try {
    const response = await runtimeFetch(`${projectSetupEndpointFor(projectId)}/shared`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await parseSetupResponse(response);
  } catch (error) {
    console.warn('Failed to save the shared project config:', error);
    return null;
  }
}
// ── end project setup ──────────────────────────────────────────────────────

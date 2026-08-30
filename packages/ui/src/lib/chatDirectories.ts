import { resolveApiUrl } from './api/serverUrl';
import { DEFAULT_SERVER_ID, serverRegistry } from './opencode/server-registry';
import { registerRemoteInstanceProxy } from './remote-instances/registry';
import { normalizePath } from './pathNormalization';
import { runtimeFetch } from './runtime-fetch';
import { getRuntimeKey } from './runtime-switch';

export const CHAT_DRAFT_PROJECT_ID = 'openchamber:chats';
const MANAGED_CHATS_PATH_SEGMENT = '/.config/openchamber/chats/';
const chatsRootByAuthority = new Map<string, Promise<string>>();

const joinPath = (base: string, ...parts: string[]): string => {
  const separator = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...parts].join(separator);
};

const resolveServerBaseUrl = (serverId?: string | null): string => {
  const normalized = serverId?.trim();
  if (!normalized || normalized === DEFAULT_SERVER_ID) return '';
  const connection = serverRegistry.get(normalized) ?? registerRemoteInstanceProxy({
    id: normalized,
    label: normalized,
    healthStatus: 'connecting',
  });
  if (!connection?.config.baseUrl) throw new Error(`Chat server ${normalized} is unavailable`);
  return connection.config.baseUrl;
};

const authorityKey = (serverId?: string | null): string => (
  `${getRuntimeKey()}\n${serverId?.trim() || DEFAULT_SERVER_ID}`
);

export const isChatDirectoryForHome = (
  directory: string | null | undefined,
  home: string | null | undefined,
): boolean => {
  const normalized = normalizePath(directory ?? null);
  if (normalized?.includes(MANAGED_CHATS_PATH_SEGMENT)) return true;
  const normalizedHome = normalizePath(home ?? null);
  if (!normalized || !normalizedHome) return false;
  const root = normalizePath(joinPath(normalizedHome, '.config', 'openchamber', 'chats'));
  return Boolean(root && normalized.startsWith(`${root}/`));
};

export const isChatDirectoryPath = (directory: string | null | undefined): boolean => (
  normalizePath(directory ?? null)?.includes(MANAGED_CHATS_PATH_SEGMENT) === true
);

export const getChatsRootFromDirectory = (directory: string | null | undefined): string | null => {
  const normalized = normalizePath(directory ?? null);
  const index = normalized?.indexOf(MANAGED_CHATS_PATH_SEGMENT) ?? -1;
  return normalized && index >= 0
    ? normalized.slice(0, index + MANAGED_CHATS_PATH_SEGMENT.length - 1)
    : null;
};

export const getChatsRootForHome = (home: string | null | undefined): string | null => {
  const normalized = normalizePath(home ?? null);
  return normalized ? normalizePath(joinPath(normalized, '.config', 'openchamber', 'chats')) : null;
};

const getChatsRootDirectory = async (serverId?: string | null): Promise<string> => {
  const key = authorityKey(serverId);
  const existing = chatsRootByAuthority.get(key);
  if (existing) return existing;
  const baseUrl = resolveServerBaseUrl(serverId);
  const pending = runtimeFetch(resolveApiUrl('/api/fs/home', baseUrl), { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Failed to resolve chat server home (${response.status})`);
      const payload = await response.json() as { home?: unknown };
      if (typeof payload.home !== 'string' || !payload.home.trim()) {
        throw new Error('Chat server returned no home directory');
      }
      return joinPath(payload.home.trim(), '.config', 'openchamber', 'chats');
    })
    .catch((error) => {
      chatsRootByAuthority.delete(key);
      throw error;
    });
  chatsRootByAuthority.set(key, pending);
  return pending;
};

export const warmChatsRootDirectory = (serverId?: string | null): void => {
  void getChatsRootDirectory(serverId).catch(() => undefined);
};

export const createChatDirectory = async (
  options: { serverId?: string | null; now?: Date } = {},
): Promise<string> => {
  const now = options.now ?? new Date();
  const root = await getChatsRootDirectory(options.serverId);
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const id = globalThis.crypto?.randomUUID?.() ?? `${now.getTime()}-${Math.random().toString(36).slice(2)}`;
  const directory = joinPath(root, date, `session-${id}`);
  const response = await runtimeFetch(resolveApiUrl('/api/fs/mkdir', resolveServerBaseUrl(options.serverId)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: directory, allowOutsideWorkspace: true }),
  });
  if (!response.ok) throw new Error(`Failed to create chat directory (${response.status})`);
  return directory;
};

export const deleteChatDirectory = async (
  directory: string,
  serverId?: string | null,
): Promise<void> => {
  const normalized = normalizePath(directory);
  const root = normalizePath(await getChatsRootDirectory(serverId));
  if (!normalized || !root || !normalized.startsWith(`${root}/`)) return;
  const response = await runtimeFetch(resolveApiUrl('/api/fs/delete', resolveServerBaseUrl(serverId)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: normalized, allowOutsideWorkspace: true }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete chat directory (${response.status})`);
  }
};

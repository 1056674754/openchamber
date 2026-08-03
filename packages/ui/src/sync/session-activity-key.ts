import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { normalizePath } from '@/lib/pathNormalization';

export const createSessionActivityKey = (
  serverId: string | null | undefined,
  directory: string | null | undefined,
  sessionId: string,
): string => JSON.stringify([
  serverId || DEFAULT_SERVER_ID,
  normalizePath(directory ?? '') ?? '',
  sessionId,
]);

import type { FileReadOptions, FilesAPI } from '@/lib/api/types';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { runtimeFetch } from '@/lib/runtime-fetch';

export type FilesViewFileStat = {
  path: string;
  isFile: boolean;
  size: number;
  mtimeMs?: number;
};

export const statFilesViewPath = async (
  files: Pick<FilesAPI, 'statFile'>,
  path: string,
  options: FileReadOptions = {},
  serverBaseUrl: string = '',
): Promise<FilesViewFileStat | null> => {
  if (!serverBaseUrl) {
    return files.statFile?.(path, options) ?? null;
  }

  const params = new URLSearchParams({ path });
  if (options.allowOutsideWorkspace) {
    params.set('allowOutsideWorkspace', 'true');
  } else if (options.directory) {
    params.set('directory', options.directory);
  }

  const response = await runtimeFetch(`${resolveApiUrl('/api/fs/stat', serverBaseUrl)}?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((errorPayload as { error?: string }).error || 'Failed to stat file');
  }

  const result = await response.json() as Partial<FilesViewFileStat>;
  return {
    path: typeof result.path === 'string' ? result.path : path,
    isFile: result.isFile === true,
    size: typeof result.size === 'number' ? result.size : 0,
    mtimeMs: typeof result.mtimeMs === 'number' ? result.mtimeMs : undefined,
  };
};

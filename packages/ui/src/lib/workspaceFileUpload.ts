import { FilesystemError, parseFilesystemErrorReason } from '@/lib/api/files-errors';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { runtimeFetch } from '@/lib/runtime-fetch';

type UploadResponse = {
  success?: boolean;
  path?: string;
  error?: string;
  reason?: unknown;
};

type UploadWorkspaceFileOptions = {
  serverBaseUrl: string;
  directory: string;
  path: string;
  file: Blob;
  overwrite?: boolean;
  fetcher?: typeof runtimeFetch;
};

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

export const uploadWorkspaceFile = async ({
  serverBaseUrl,
  directory,
  path,
  file,
  overwrite = false,
  fetcher = runtimeFetch,
}: UploadWorkspaceFileOptions): Promise<{ success: boolean; path: string }> => {
  const owner = normalizePath(directory.trim());
  const target = normalizePath(path.trim());
  if (!owner) throw new FilesystemError('Owning directory is required');
  if (!target) throw new FilesystemError('Path is required');

  const params = new URLSearchParams({ path: target, directory: owner });
  if (overwrite) params.set('overwrite', 'true');

  const response = await fetcher(`${resolveApiUrl('/api/fs/upload', serverBaseUrl)}?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });

  const payload = await response.json().catch(() => ({})) as UploadResponse;
  if (!response.ok) {
    throw new FilesystemError(payload.error || response.statusText || 'Failed to upload file', {
      reason: parseFilesystemErrorReason(payload.reason),
      status: response.status,
    });
  }

  return {
    success: payload.success === true,
    path: typeof payload.path === 'string' ? normalizePath(payload.path) : target,
  };
};

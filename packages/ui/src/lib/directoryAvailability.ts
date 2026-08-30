import { resolveApiUrl } from '@/lib/api/serverUrl';
import { runtimeFetch } from '@/lib/runtime-fetch';

export type DirectoryAvailability = 'available' | 'missing' | 'unknown';

type ProbeOptions = {
  directory: string;
  serverBaseUrl: string;
  fetcher?: typeof runtimeFetch;
};

const looksMissing = (payload: unknown): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  const reason = Reflect.get(payload, 'reason');
  if (reason === 'not-found' || reason === 'not-directory') return true;
  const message = Reflect.get(payload, 'error');
  return typeof message === 'string'
    && /\bENOENT\b|\bENOTDIR\b|no such file or directory|does not exist/i.test(message);
};

export const probeWorkspaceDirectoryAvailability = async ({
  directory,
  serverBaseUrl,
  fetcher = runtimeFetch,
}: ProbeOptions): Promise<DirectoryAvailability> => {
  const target = directory.trim().replace(/\\/g, '/');
  if (!target) return 'unknown';

  try {
    const response = await fetcher(resolveApiUrl('/api/fs/stat', serverBaseUrl), {
      cache: 'no-store',
      query: { path: target, directory: target },
    });
    if (response.ok) return 'available';
    const payload = await response.json().catch(() => null);
    if (response.status === 404 || looksMissing(payload)) return 'missing';
    return 'unknown';
  } catch {
    return 'unknown';
  }
};

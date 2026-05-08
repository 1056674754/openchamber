import { useActiveServerBaseUrl } from '@/hooks/useActiveServerId';

export function useServerAwareFetch(): (path: string, init?: RequestInit) => Promise<Response> {
  const baseUrl = useActiveServerBaseUrl();
  return (path: string, init?: RequestInit) => fetch(baseUrl + path, init);
}

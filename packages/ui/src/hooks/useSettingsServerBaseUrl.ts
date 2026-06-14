import { useMemo } from 'react';
import { useActiveServerId } from './useActiveServerId';
import { serverRegistry, DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';

export function useSettingsServerBaseUrl(): string {
  const activeServerId = useActiveServerId();

  return useMemo(() => {
    if (activeServerId === DEFAULT_SERVER_ID) return '';
    const connection = serverRegistry.get(activeServerId);
    return connection?.config.baseUrl ?? '';
  }, [activeServerId]);
}

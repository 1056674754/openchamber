import { useMemo } from 'react';
import { useActiveServerId } from './useActiveServerId';
import { useUIStore } from '@/stores/useUIStore';
import { serverRegistry, DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';

export function useSettingsServerBaseUrl(): string {
  const activeServerId = useActiveServerId();
  const selectedServerId = useUIStore((s) => s.settingsSelectedServerId);
  const effectiveServerId = selectedServerId ?? activeServerId;

  return useMemo(() => {
    if (effectiveServerId === DEFAULT_SERVER_ID) return '';
    const connection = serverRegistry.get(effectiveServerId);
    return connection?.config.baseUrl ?? '';
  }, [effectiveServerId]);
}

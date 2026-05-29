import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useSessionDirectory } from '@/sync/sync-context';

export const useMessageDirectory = (sessionId?: string | null): string => {
  const sessionDirectory = useSessionDirectory(sessionId ?? undefined);
  const effectiveDirectory = useEffectiveDirectory();
  const fallbackDirectory = useDirectoryStore((state) => state.currentDirectory);

  return sessionDirectory ?? effectiveDirectory ?? fallbackDirectory ?? '';
};

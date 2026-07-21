import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

import { opencodeClient } from '@/lib/opencode/client';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { resolveSdkForDirectory } from '@/sync/session-actions';

export const getMcpApiClient = (directory: string | null | undefined): OpencodeClient => {
  if (directory) {
    return resolveSdkForDirectory(directory);
  }

  const defaultConnection = serverRegistry.get(DEFAULT_SERVER_ID);
  return defaultConnection?.client ?? opencodeClient.getApiClient();
};

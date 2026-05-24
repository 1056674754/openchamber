import { serverRegistry, type ServerConnection } from '@/lib/opencode/server-registry';

type RemoteHealthStatus = ServerConnection['healthStatus'];

const remoteProxyBaseUrl = (id: string): string => `/api/remote/${encodeURIComponent(id)}`;
const remoteHealthUrl = (id: string): string => `/api/remote-instances/${encodeURIComponent(id)}/health`;

export function registerRemoteInstanceProxy(
  input: {
    id: string;
    label: string;
    healthStatus?: RemoteHealthStatus;
  },
): ServerConnection {
  const connection = serverRegistry.register({
    id: input.id,
    label: input.label,
    baseUrl: remoteProxyBaseUrl(input.id),
    sseUrl: remoteProxyBaseUrl(input.id),
    healthUrl: remoteHealthUrl(input.id),
    healthMethod: 'POST',
  });

  if (input.healthStatus !== undefined) {
    serverRegistry.setHealthStatus(input.id, input.healthStatus);
  }

  return connection;
}


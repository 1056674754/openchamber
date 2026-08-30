import { invokeDesktopCommand } from '@/lib/desktopNative';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { isLoopbackUrl } from './url';

type TunnelResult = { localPort: number; reused: boolean; url: string };

const localPortByTarget = new Map<string, number>();
const originByLocalPort = new Map<number, string>();

const isDesktopRuntime = (): boolean => (
  typeof window !== 'undefined' && Boolean(window.__OPENCHAMBER_ELECTRON__)
);

const isRemoteServer = (serverId: string): boolean => (
  Boolean(serverId) && serverId !== DEFAULT_SERVER_ID
);

const loopbackPort = (url: string): number => {
  try {
    const parsed = new URL(url);
    const port = Number.parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);
    return Number.isInteger(port) && port > 0 ? port : 0;
  } catch {
    return 0;
  }
};

const rewriteToLocalPort = (url: string, localPort: number): string => {
  try {
    const parsed = new URL(url);
    parsed.protocol = 'http:';
    parsed.hostname = '127.0.0.1';
    parsed.port = String(localPort);
    return parsed.toString();
  } catch {
    return url;
  }
};

export class DevTunnelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevTunnelUnavailableError';
  }
}

export const resolveBrowsableUrl = async (url: string, serverId: string): Promise<string> => {
  if (!url || !isDesktopRuntime() || !isRemoteServer(serverId) || !isLoopbackUrl(url)) return url;

  const port = loopbackPort(url);
  if (!port) return url;
  const key = `${serverId}|${port}`;
  const cached = localPortByTarget.get(key);
  if (cached) {
    originByLocalPort.set(cached, new URL(url).origin);
    return rewriteToLocalPort(url, cached);
  }

  try {
    const result = await invokeDesktopCommand<TunnelResult>('desktop_dev_tunnel_open', {
      serverId,
      port,
    });
    if (!result || !Number.isInteger(result.localPort) || result.localPort <= 0) {
      throw new DevTunnelUnavailableError(url);
    }
    localPortByTarget.set(key, result.localPort);
    originByLocalPort.set(result.localPort, new URL(url).origin);
    return rewriteToLocalPort(url, result.localPort);
  } catch (error) {
    if (error instanceof DevTunnelUnavailableError) throw error;
    throw new DevTunnelUnavailableError(url);
  }
};

export const shouldTunnelLoopbackUrl = (url: string, serverId: string): boolean => {
  if (!url || !isDesktopRuntime() || !isRemoteServer(serverId) || !isLoopbackUrl(url)) return false;
  const port = loopbackPort(url);
  return port > 0 && !originByLocalPort.has(port);
};

export const toDisplayUrl = (url: string): string => {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1') return url;
    const origin = originByLocalPort.get(Number.parseInt(parsed.port || '0', 10));
    if (!origin) return url;
    return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
};

const resetDevTunnelCache = (): void => {
  localPortByTarget.clear();
  originByLocalPort.clear();
};

if (typeof window !== 'undefined') {
  subscribeRuntimeEndpointChanged(resetDevTunnelCache);
}

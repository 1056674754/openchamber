const normalizeHttpUrl = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
};

export const resolveDesktopDevTunnelAuthority = ({
  serverId,
  status,
  hosts,
  localHostId = 'local',
}) => {
  const id = typeof serverId === 'string' ? serverId.trim() : '';
  if (!id || id === localHostId || id === 'default') {
    throw new Error('A remote SSH instance is required');
  }
  const baseUrl = status?.phase === 'ready' ? normalizeHttpUrl(status.localUrl) : null;
  if (!baseUrl) throw new Error('The remote SSH instance is not connected');

  const host = Array.isArray(hosts) ? hosts.find((entry) => entry?.id === id) : null;
  const hostUrl = normalizeHttpUrl(host?.apiUrl || host?.url || '');
  if (!hostUrl || new URL(hostUrl).origin !== new URL(baseUrl).origin) {
    throw new Error('The remote SSH instance authority is stale');
  }
  const clientToken = typeof host?.clientToken === 'string' ? host.clientToken.trim() : '';
  if (!clientToken) throw new Error('The remote SSH instance has no paired client token');
  return { id, baseUrl, clientToken };
};

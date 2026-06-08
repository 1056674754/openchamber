export const normalizeRemoteProjectDiscoveryPath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
};

export const getRemoteProjectDiscoveryKey = (serverId: string, path: string): string =>
  `${serverId}:${normalizeRemoteProjectDiscoveryPath(path)}`;

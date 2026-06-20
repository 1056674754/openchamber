function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeBase(serverBaseUrl: string): string {
  return serverBaseUrl.replace(/\/+$/, "");
}

function resolveBasePath(base: string): string {
  try {
    return new URL(base).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return base.replace(/\/+$/, "") || "/";
  }
}

function isOpenChamberApiBasePath(basePath: string): boolean {
  return basePath === "/api"
    || basePath.endsWith("/api")
    || /^\/api\/remote\/[^/]+$/.test(basePath)
    || /\/api\/remote\/[^/]+$/.test(basePath);
}

export function resolveApiUrl(path: string, serverBaseUrl?: string): string {
  const normalizedPath = normalizePath(path);
  if (serverBaseUrl && serverBaseUrl.length > 0) {
    const base = normalizeBase(serverBaseUrl);
    const apiBasePath = isOpenChamberApiBasePath(resolveBasePath(base));
    const suffix = apiBasePath
      ? normalizedPath.replace(/^\/api(?=\/|$)/, "")
      : normalizedPath;
    return `${base}${suffix || ""}`;
  }
  return normalizedPath;
}

export function resolveOpenCodeProxyApiUrl(path: string, serverBaseUrl?: string): string {
  const normalizedPath = normalizePath(path);
  const upstreamPath = normalizedPath === "/api" || normalizedPath.startsWith("/api/")
    ? normalizedPath
    : `/api${normalizedPath}`;

  if (serverBaseUrl && serverBaseUrl.length > 0) {
    const base = normalizeBase(serverBaseUrl);
    const basePath = resolveBasePath(base);
    if (isOpenChamberApiBasePath(basePath)) {
      return `${base}/api${upstreamPath}`;
    }
    return `${base}${upstreamPath}`;
  }

  return `/api/api${upstreamPath}`;
}

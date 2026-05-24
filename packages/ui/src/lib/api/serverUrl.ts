export function resolveApiUrl(path: string, serverBaseUrl?: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (serverBaseUrl && serverBaseUrl.length > 0) {
    const base = serverBaseUrl.replace(/\/+$/, "");
    const basePath = (() => {
      try {
        return new URL(base).pathname.replace(/\/+$/, "") || "/";
      } catch {
        return base;
      }
    })();
    const apiBasePath = basePath === "/api"
      || basePath.endsWith("/api")
      || /^\/api\/remote\/[^/]+$/.test(basePath)
      || /\/api\/remote\/[^/]+$/.test(basePath);
    const suffix = apiBasePath
      ? normalizedPath.replace(/^\/api(?=\/|$)/, "")
      : normalizedPath;
    return `${base}${suffix || ""}`;
  }
  return normalizedPath;
}

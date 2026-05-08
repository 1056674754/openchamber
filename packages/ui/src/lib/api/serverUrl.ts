export function resolveApiUrl(path: string, serverBaseUrl?: string): string {
  if (serverBaseUrl && serverBaseUrl.length > 0) {
    const base = serverBaseUrl.replace(/\/+$/, "")
    return `${base}${path}`
  }
  return path
}

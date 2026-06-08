import { resolveApiUrl } from "@/lib/api/serverUrl"

const buildApiFetchUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string => {
  const normalizedBase = baseUrl.replace(/\/+$/, "")
  const url = resolveApiUrl(path, normalizedBase)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      params.set(key, value)
    }
  }
  const queryString = params.toString()
  if (!queryString) {
    return url
  }
  return `${url}${url.includes("?") ? "&" : "?"}${queryString}`
}

export const buildOpenCodeHealthUrl = (baseUrl: string): string =>
  buildApiFetchUrl(baseUrl, "/api/opencode/health")

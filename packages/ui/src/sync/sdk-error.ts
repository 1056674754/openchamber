type SdkErrorData = {
  readonly message?: unknown
  readonly ref?: unknown
}

export const formatSdkError = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return String(error)

  if ("data" in error && typeof error.data === "object" && error.data !== null) {
    const data = error.data as SdkErrorData
    if (typeof data.message === "string") {
      return typeof data.ref === "string" ? `${data.message} (${data.ref})` : data.message
    }
  }

  if ("message" in error && typeof error.message === "string") return error.message
  return JSON.stringify(error)
}

type SdkResponseMetadata = {
  readonly status: number
  readonly statusText: string
}

export type SdkRequestErrorDetails = {
  readonly operation: string
  readonly endpoint: string
  readonly error: unknown
  readonly response: SdkResponseMetadata
  readonly directory: string | null
  readonly serverId: string
  readonly source: string
  readonly attempt: number
}

export class SdkRequestError extends Error {
  readonly name = "SdkRequestError"
  readonly endpoint: string
  readonly status: number
  readonly statusText: string
  readonly upstreamMessage: string
  readonly directory: string | null
  readonly serverId: string
  readonly source: string
  readonly attempt: number

  constructor(details: SdkRequestErrorDetails) {
    const upstreamMessage = formatSdkError(details.error)
    const statusText = details.response.statusText.trim()
    const responseLabel = statusText
      ? `${details.response.status} ${statusText}`
      : String(details.response.status)
    super(`${details.operation} failed (${responseLabel}): ${upstreamMessage}`, {
      cause: details.error,
    })
    this.endpoint = details.endpoint
    this.status = details.response.status
    this.statusText = statusText
    this.upstreamMessage = upstreamMessage
    this.directory = details.directory
    this.serverId = details.serverId
    this.source = details.source
    this.attempt = details.attempt
  }
}

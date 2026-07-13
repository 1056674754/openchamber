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

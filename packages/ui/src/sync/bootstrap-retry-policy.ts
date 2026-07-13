const MAX_BOOTSTRAP_RETRY_ATTEMPT = 5

export type BootstrapFailureAction = "retry" | "finish"

export const getBootstrapFailureAction = (attempt: number): BootstrapFailureAction =>
  attempt < MAX_BOOTSTRAP_RETRY_ATTEMPT ? "retry" : "finish"

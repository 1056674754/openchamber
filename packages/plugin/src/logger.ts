/**
 * Minimal plugin-scoped logger.
 *
 * Writes to stderr so it doesn't interfere with OpenCode's stdout IPC.
 * Prefixes every line with `[openchamber-plugin]` for easy grepping.
 */

export function log(message: string, details?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString()
  const detailStr = details ? ` ${JSON.stringify(details)}` : ""
  console.error(`[openchamber-plugin] ${timestamp} ${message}${detailStr}`)
}

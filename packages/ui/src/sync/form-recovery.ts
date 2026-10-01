import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { blocksOnForm } from "@/lib/opencode/tools"

type MessageRecord = {
  readonly info: Message
  readonly parts: readonly Part[]
}

const RECOVERY_DELAYS_MS = [0, 500, 1500] as const

/**
 * Neither protocol ships a dedicated form tool: a form is raised by the tool
 * that blocks on it, which on the v1 wire is `question` (`blocksOnForm` knows
 * the full set, so the v2 track needs no branch here).
 */
const isActiveFormTool = (part: Part): boolean => {
  if (part.type !== "tool" || !blocksOnForm(part.tool)) return false
  return part.state.status === "pending" || part.state.status === "running"
}

export function hasActiveFormToolInCurrentTurn(messages: readonly MessageRecord[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    if (message.info.role === "user") return false
    if (message.parts.some(isActiveFormTool)) return true
  }
  return false
}

export async function recoverPendingFormWithRetry(
  recover: () => Promise<boolean>,
  options?: {
    readonly isCancelled?: () => boolean
    readonly sleep?: (delayMs: number) => Promise<void>
  },
): Promise<boolean> {
  const isCancelled = options?.isCancelled ?? (() => false)
  const sleep = options?.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)))

  for (const delayMs of RECOVERY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs)
    if (isCancelled()) return false
    if (await recover()) return true
  }
  return false
}

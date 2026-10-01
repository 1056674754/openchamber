import type { PermissionMode } from "@/stores/utils/permissionAutoAccept"

export type DraftPermissionIntent = {
  readonly mode: PermissionMode
}

type ApplyDraftPermissionIntentInput = {
  readonly sessionId: string
  readonly intent: DraftPermissionIntent
  readonly setSessionMode: (sessionId: string, mode: PermissionMode) => Promise<void>
}

export const createDraftPermissionIntent = (mode: PermissionMode = "ask"): DraftPermissionIntent => ({
  mode,
})

export const applyDraftPermissionIntentAfterSessionCreation = async (
  input: ApplyDraftPermissionIntentInput,
): Promise<void> => {
  // `ask` is the server-side default; nothing to write. Without a draft choice
  // at all the server writes the Settings default itself.
  if (input.intent.mode === "ask") {
    return
  }

  await input.setSessionMode(input.sessionId, input.intent.mode)
}


export type DraftPermissionIntent = {
  readonly autoAccept: boolean
}

type ApplyDraftPermissionIntentInput = {
  readonly sessionId: string
  readonly intent: DraftPermissionIntent
  readonly setSessionAutoAccept: (sessionId: string, enabled: boolean) => Promise<void>
}

export const createDraftPermissionIntent = (autoAccept = false): DraftPermissionIntent => ({
  autoAccept,
})

export const applyDraftPermissionIntentAfterSessionCreation = async (
  input: ApplyDraftPermissionIntentInput,
): Promise<void> => {
  if (!input.intent.autoAccept) {
    return
  }

  await input.setSessionAutoAccept(input.sessionId, true)
}

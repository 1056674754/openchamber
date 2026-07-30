export type DraftStarterSubmitType = "command" | "skill"

export function buildDraftStarterSubmitText(
  starterText: string,
  type: DraftStarterSubmitType,
  draftText: string,
): string {
  const draft = draftText.trim()
  if (!draft) {
    return starterText
  }
  return `${starterText}${type === "command" ? " " : "\n"}${draft}`
}

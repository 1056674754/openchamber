/**
 * Names skills in an instruction for the model (OC2 spine S6, SegB #4
 * `61e6535cf`). The fallback for skills that cannot be attached to the v2
 * prompt: queued messages (delivered later by the server or the VS Code
 * auto-send), the command route, and names OpenCode does not list.
 */
export const buildSkillMentionInstruction = (skillNames: readonly string[]): string | null => {
  if (skillNames.length === 0) return null;
  const formatted = skillNames.map((name) => `/${name}`).join(", ");
  return `The user explicitly mentioned these skills in their message: ${formatted}. Use the corresponding skill tool when it is relevant to accomplishing the user's request.`;
};

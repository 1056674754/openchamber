/**
 * One prompt the user sent in a session, as the visible transcript shows it.
 *
 * Minimal fork port: only the type is shared for now. The full snapshot
 * builder (`buildUserMessageHistorySnapshot`, revert-aware transcript
 * filtering) lands with the composer/history wiring port; the fork's
 * `useUserMessageHistory` in sync-context covers the transcript side today.
 */
export type TranscriptPrompt = {
  text: string;
  /** `message.time.created`, milliseconds. */
  createdAt: number;
};

const LEGACY_FORM_TEXTAREA_LINE_HEIGHT = 20;
const LEGACY_FORM_TEXTAREA_MIN_LINES = 2;
const LEGACY_FORM_TEXTAREA_MAX_LINES = 10;

export const LEGACY_FORM_CUSTOM_TEXTAREA_MIN_HEIGHT = LEGACY_FORM_TEXTAREA_LINE_HEIGHT * LEGACY_FORM_TEXTAREA_MIN_LINES;

export function getLegacyFormCustomTextareaHeight({
  scrollHeight,
  currentHeight,
}: {
  scrollHeight: number;
  currentHeight: number | null | undefined;
}): number | null {
  const maxHeight = LEGACY_FORM_TEXTAREA_LINE_HEIGHT * LEGACY_FORM_TEXTAREA_MAX_LINES;
  const nextHeight = Math.min(Math.max(scrollHeight, LEGACY_FORM_CUSTOM_TEXTAREA_MIN_HEIGHT), maxHeight);

  return currentHeight === nextHeight ? null : nextHeight;
}

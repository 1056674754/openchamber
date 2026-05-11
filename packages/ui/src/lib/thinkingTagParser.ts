/**
 * Client-side parser for HTML-style thinking tags embedded in TextPart content.
 *
 * Some models emit thinking/reasoning output wrapped in tags like `<thinking>`,
 * `<think_content>`, `<think-process>`, etc. instead of using dedicated reasoning
 * parts. This parser detects those tags and splits text into typed segments so
 * the UI can render them as collapsible reasoning blocks.
 */

export type ThinkingSegment =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string };

// Combined pattern that matches either an opening or closing think tag.
// Group 1 = opening tag, Group 2 = closing tag.
const TAG_RE = /(<think[a-zA-Z_-]*\s*[^>]*>)|(<\/think[a-zA-Z_-]*\s*>)/gi;

const EMPTY_SEGMENTS: ThinkingSegment[] = [];

/**
 * Parse text into alternating text/thinking segments.
 *
 * - Tags starting with `<think` (case-insensitive) delimit thinking blocks.
 * - Tag names are stripped from the output content.
 * - During streaming, an unclosed opening tag means everything after it is
 *   treated as thinking content still in progress.
 * - If no thinking tags are found, returns `[{ type: 'text', content }]`.
 * - Returns a frozen empty-segment sentinel when the input is empty, to keep
 *   referential stability for useMemo callers.
 */
export function parseThinkingSegments(text: string): ThinkingSegment[] {
  if (!text || text.length === 0) {
    return EMPTY_SEGMENTS;
  }

  // Quick check: if no `<think` substring exists at all, skip regex work.
  const lower = text.toLowerCase();
  const firstThinkIdx = lower.indexOf('<think');
  if (firstThinkIdx === -1) {
    return [{ type: 'text', content: text }];
  }

  // Reset combined regex state
  TAG_RE.lastIndex = 0;

  const segments: ThinkingSegment[] = [];
  let cursor = 0;
  let inThinking = false;
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(text)) !== null) {
    const tagStart = match.index;
    const tagEnd = TAG_RE.lastIndex;

    // Text between cursor and this tag
    if (tagStart > cursor) {
      const between = text.slice(cursor, tagStart);
      if (between.length > 0) {
        segments.push(
          inThinking
            ? { type: 'thinking', content: between }
            : { type: 'text', content: between },
        );
      }
    }

    if (match[1]) {
      // Opening tag — enter thinking mode
      inThinking = true;
    } else {
      // Closing tag — exit thinking mode
      inThinking = false;
    }

    cursor = tagEnd;
  }

  // Handle remaining text after last tag
  if (cursor < text.length) {
    const remaining = text.slice(cursor);
    if (remaining.length > 0) {
      segments.push(
        inThinking
          ? { type: 'thinking', content: remaining }
          : { type: 'text', content: remaining },
      );
    }
  } else if (inThinking) {
    // Opening tag at the very end with no content yet — add an empty thinking
    // segment so the UI can show a streaming indicator.
    segments.push({ type: 'thinking', content: '' });
  }

  // If parsing produced no segments (shouldn't happen, but be safe), fall back
  if (segments.length === 0) {
    return [{ type: 'text', content: text }];
  }

  // Merge adjacent segments of the same type
  return mergeAdjacentSegments(segments);
}

function mergeAdjacentSegments(segments: ThinkingSegment[]): ThinkingSegment[] {
  if (segments.length <= 1) {
    return segments;
  }

  const merged: ThinkingSegment[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];
    if (prev.type === curr.type) {
      prev.content += curr.content;
    } else {
      merged.push(curr);
    }
  }

  // Filter out empty text segments (keep empty thinking for streaming indicator)
  const filtered = merged.filter(
    (s) => s.type === 'thinking' || s.content.length > 0,
  );

  return filtered.length > 0 ? filtered : EMPTY_SEGMENTS;
}

/**
 * Quick check whether text contains any `<think` tags.
 * Useful for short-circuiting before calling the full parser.
 */
export function hasThinkingTags(text: string): boolean {
  if (!text) return false;
  return text.toLowerCase().indexOf('<think') !== -1;
}

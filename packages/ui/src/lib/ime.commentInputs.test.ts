import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every place a user writes a comment submits on a bare Enter, and Enter is
 * also how an IME confirms a candidate. Without a composition guard the first
 * confirmation posts the half-typed reading and closes the input, so the guard
 * is a contract across all of these surfaces rather than a per-component
 * detail. `keyCode === 229` is part of it: WebKit reports the confirming Enter
 * that way after `compositionend`.
 */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const COMMENT_INPUTS: Array<{ name: string; file: string; handler: string; guard: RegExp }> = [
  {
    name: 'diff and file comments',
    file: 'components/comments/InlineCommentInput.tsx',
    handler: 'const handleKeyDown',
    guard: /isIMECompositionEvent\(e\)\) return;/,
  },
];

describe('comment inputs ignore IME composition keystrokes', () => {
  for (const input of COMMENT_INPUTS) {
    test(input.name, () => {
      const source = readFileSync(join(srcDir, input.file), 'utf-8');
      const start = source.indexOf(input.handler);
      expect(start).toBeGreaterThan(-1);

      const handler = source.slice(start, start + 900);
      const guardIndex = handler.search(input.guard);
      const keyIndex = handler.search(/(event|e)\.key === '(Enter|Escape)'/);

      expect(guardIndex).toBeGreaterThan(-1);
      expect(keyIndex).toBeGreaterThan(guardIndex);
    });
  }
});

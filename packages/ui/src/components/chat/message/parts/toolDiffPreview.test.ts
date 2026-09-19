import { describe, expect, test } from 'bun:test';

import {
    getToolDiffPreviewText,
    isToolDiffPreviewOversized,
    TOOL_DIFF_PREVIEW_MAX_CHARS,
    TOOL_DIFF_PREVIEW_MAX_LINES,
} from './toolDiffPreview';
import { getDiffPatchEntries } from './toolDiffUtils';

const identity = (path: string) => path;

describe('toolDiffPreview', () => {
    test('keeps oversized metadata patches out of the rich diff renderer', () => {
        const patch = [
            '--- a/src/generated.ts',
            '+++ b/src/generated.ts',
            `@@ -1,${TOOL_DIFF_PREVIEW_MAX_LINES + 1} +0,0 @@`,
            ...Array.from(
                { length: TOOL_DIFF_PREVIEW_MAX_LINES + 1 },
                (_, index) => `-${String(index).padStart(40, '0')}`,
            ),
        ].join('\n');
        const metadata = {
            files: [{ relativePath: 'src/generated.ts', patch }],
        };
        const entries = getDiffPatchEntries(metadata, undefined, identity);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.renderMode).toBe('text');
        expect(entries[0]?.patch).toBe(patch);

        const preview = getToolDiffPreviewText(entries[0]?.patch ?? '');
        expect(preview.endsWith('\n…')).toBe(true);
        expect(preview.split('\n')).toHaveLength(TOOL_DIFF_PREVIEW_MAX_LINES + 1);
        expect(preview.length).toBeLessThan(patch.length);
    });

    test('bounds oversized single-line diff previews by character count', () => {
        const patch = `+${'x'.repeat(TOOL_DIFF_PREVIEW_MAX_CHARS + 1_000)}`;
        const preview = getToolDiffPreviewText(patch);

        expect(preview.endsWith('\n…')).toBe(true);
        expect(preview.length).toBe(TOOL_DIFF_PREVIEW_MAX_CHARS + 2);
    });

    test('does not cut an astral character in half at the character limit', () => {
        // The boundary lands between the two halves of the emoji, which would
        // otherwise leave a lone surrogate rendering as the replacement glyph.
        const patch = `+${'x'.repeat(TOOL_DIFF_PREVIEW_MAX_CHARS - 2)}\u{1F600}${'y'.repeat(100)}`;
        const preview = getToolDiffPreviewText(patch);
        const body = preview.slice(0, -2);

        expect(isToolDiffPreviewOversized(patch)).toBe(true);
        expect(body).toBe(`+${'x'.repeat(TOOL_DIFF_PREVIEW_MAX_CHARS - 2)}`);
        expect(/[\uD800-\uDFFF]/.test(body)).toBe(false);
    });

    test('preserves diff previews at the character and line limits', () => {
        const characterLimit = 'x'.repeat(TOOL_DIFF_PREVIEW_MAX_CHARS);
        const lineLimit = Array.from({ length: TOOL_DIFF_PREVIEW_MAX_LINES }, () => '+line').join('\n');
        const terminatedLineLimit = `${lineLimit}\n`;

        expect(getToolDiffPreviewText(characterLimit)).toBe(characterLimit);
        expect(getToolDiffPreviewText(lineLimit)).toBe(lineLimit);
        expect(getToolDiffPreviewText(terminatedLineLimit)).toBe(terminatedLineLimit);
    });

    test('counts bare carriage returns as line separators', () => {
        const patch = Array.from(
            { length: TOOL_DIFF_PREVIEW_MAX_LINES + 1 },
            (_, index) => `+${index}`,
        ).join('\r');

        expect(isToolDiffPreviewOversized(patch)).toBe(true);
    });
});

import { describe, expect, test } from 'bun:test';

import { getDiffPatchEntries, getRenderablePatchInfo } from './toolDiffUtils';

const identity = (path: string) => path;

describe('toolDiffUtils', () => {
    test('treats raw apply_patch envelopes as text, not visual diffs', () => {
        const entries = getDiffPatchEntries(undefined, [
            '*** Begin Patch',
            '*** Update File: src/app.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
            '*** End Patch',
        ].join('\n'), identity);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.renderMode).toBe('text');
        expect(entries[0]?.patch).toContain('*** Begin Patch');
    });

    test('splits multi-file unified patches into one renderable entry per file', () => {
        const entries = getDiffPatchEntries(undefined, [
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
            '--- a/src/b.ts',
            '+++ b/src/b.ts',
            '@@ -1 +1 @@',
            '-left',
            '+right',
        ].join('\n'), identity);

        expect(entries.map((entry) => entry.renderMode)).toEqual(['diff', 'diff']);
        expect(entries.map((entry) => entry.title)).toEqual(['src/a.ts', 'src/b.ts']);
    });

    test('uses metadata.files patches before top-level fallback diffs', () => {
        const entries = getDiffPatchEntries({
            files: [{
                relativePath: 'src/file.ts',
                patch: [
                    '--- a/src/file.ts',
                    '+++ b/src/file.ts',
                    '@@ -1 +1 @@',
                    '-old',
                    '+new',
                ].join('\n'),
            }],
        }, 'not a diff', identity);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.renderMode).toBe('diff');
        expect(entries[0]?.title).toBe('src/file.ts');
    });

    test('synthesizes headers for valid headerless hunks', () => {
        const entries = getDiffPatchEntries(undefined, [
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n'), identity);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.renderMode).toBe('diff');
        expect(getRenderablePatchInfo(entries[0]?.patch ?? '')).not.toBeNull();
    });

    test('normalizes loose unified headers, body lines, and hunk counts', () => {
        const entries = getDiffPatchEntries(undefined, [
            ' --- a\\src\\file.ts',
            ' +++ b\\src\\file.ts',
            '@@ -10,99 +10,99 @@ section',
            'unchanged',
            '-old',
            '+new',
            '',
            'tail',
        ].join('\n'), identity);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.renderMode).toBe('diff');
        expect(entries[0]?.title).toBe('src/file.ts');
        expect(entries[0]?.patch).toContain('--- a/src/file.ts');
        expect(entries[0]?.patch).toContain('@@ -10,4 +10,4 @@ section');
        expect(entries[0]?.patch).toContain('\n unchanged\n');
        expect(entries[0]?.patch).toContain('\n \n tail');
    });

    test('keeps dev-null headers intact while normalizing loose added files', () => {
        const info = getRenderablePatchInfo([
            '--- /dev/null',
            '+++ src\\new.ts',
            '@@ -0,0 +1,9 @@',
            '+export const value = 1;',
        ].join('\n'));

        expect(info).not.toBeNull();
        expect(info?.title).toBe('src/new.ts');
        expect(info?.patch).toContain('@@ -0,0 +1 @@');
    });

    test('keeps malformed unified patches as text fallbacks', () => {
        const entries = getDiffPatchEntries(undefined, [
            '--- a/src/file.ts',
            '+++ b/src/file.ts',
            '@@',
            '-old',
            '+new',
        ].join('\n'), identity);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.renderMode).toBe('text');
        expect(entries[0]?.patch).toContain('@@');
    });
});

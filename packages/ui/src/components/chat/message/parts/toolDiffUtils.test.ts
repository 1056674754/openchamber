import { describe, expect, test } from 'bun:test';

import {
    getApplyPatchFilePath,
    getDiffPatchEntries,
    getMutatedToolPaths,
    getPrimaryToolPath,
    getRenderablePatchInfo,
} from './toolDiffUtils';

const identity = (path: string) => path;

describe('toolDiffUtils', () => {
    test('uses the moved destination as the primary apply_patch path', () => {
        const metadata = {
            files: [
                { type: 'delete', filePath: '/workspace/project/src/deleted.ts' },
                {
                    type: 'update',
                    filePath: '/workspace/project/src/old.ts',
                    movePath: '/workspace/project/src/new.ts',
                    relativePath: 'src/new.ts',
                },
            ],
        };

        expect(getPrimaryToolPath('apply_patch', undefined, metadata)).toBe('/workspace/project/src/new.ts');
    });

    test('lists every apply_patch mutation path, including both sides of a move', () => {
        expect(getMutatedToolPaths('apply_patch', undefined, {
            files: [
                { filePath: '/workspace/project/src/deleted.ts', type: 'delete' },
                {
                    filePath: '/workspace/project/src/old.ts',
                    movePath: '/workspace/project/src/new.ts',
                    type: 'move',
                },
            ],
        })).toEqual([
            '/workspace/project/src/deleted.ts',
            '/workspace/project/src/new.ts',
            '/workspace/project/src/old.ts',
        ]);
    });

    test('does not invent paths for bash or task tools', () => {
        expect(getMutatedToolPaths('bash', { command: 'date' }, undefined)).toEqual([]);
        expect(getMutatedToolPaths('task', { description: 'inspect' }, undefined)).toEqual([]);
    });

    test('resolves each apply_patch file independently', () => {
        expect(getApplyPatchFilePath({
            filePath: '/workspace/project/src/first.ts',
            relativePath: 'src/first.ts',
        })).toBe('/workspace/project/src/first.ts');
        expect(getApplyPatchFilePath({
            filePath: '/workspace/project/src/old.ts',
            movePath: '/workspace/project/src/second.ts',
            relativePath: 'src/second.ts',
        })).toBe('/workspace/project/src/second.ts');
    });

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

    test('keeps the authoritative path for every metadata file entry', () => {
        const patch = [
            '--- a/src/file.ts',
            '+++ b/src/file.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n');
        const entries = getDiffPatchEntries({
            files: [
                { filePath: '/workspace/project/src/first.ts', relativePath: 'src/first.ts', patch },
                { filePath: '/workspace/project/src/second.ts', relativePath: 'src/second.ts', patch },
            ],
        }, undefined, identity);

        expect(entries.map((entry) => entry.filePath)).toEqual([
            '/workspace/project/src/first.ts',
            '/workspace/project/src/second.ts',
        ]);
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

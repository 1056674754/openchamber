/**
 * Regression guard for slow terminal opening.
 *
 * The viewport key must be directory + tab (+ serverId for multi-instance) only.
 * Session changes are handled by the chunk replay path, which resets the existing
 * terminal in place. New sessions start concurrently with a container-derived size
 * (or 80x24) and resize after their viewport fits, so shell startup overlaps
 * renderer initialization instead of serializing behind it.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const terminalViewSource = readFileSync(
    join(here, '../TerminalView.tsx'),
    'utf-8',
);
const terminalViewportSource = readFileSync(
    join(here, '../../terminal/TerminalViewport.tsx'),
    'utf-8',
);

const terminalViewportKeyBlock = (() => {
    const start = terminalViewSource.indexOf('const terminalViewportKey =');
    expect(start).toBeGreaterThan(-1);
    const end = terminalViewSource.indexOf('});', start);
    return terminalViewSource.slice(start, end);
})();

describe('terminal viewport remount guard', () => {
    test('viewport identity excludes the PTY session id', () => {
        expect(terminalViewportKeyBlock).toContain('effectiveDirectory');
        expect(terminalViewportKeyBlock).toContain('activeTabId');
        expect(terminalViewportKeyBlock).not.toContain('terminalSessionId');
    });

    test('replay discontinuities reset the terminal in place instead of remounting it', () => {
        expect(terminalViewSource).toContain('getBuffer(');
    });

    test('starts the PTY before Ghostty reports its first viewport size', () => {
        expect(terminalViewSource).toContain('const FALLBACK_TERMINAL_SIZE = { cols: 80, rows: 24 } as const;');
        expect(terminalViewSource).toContain('const initialSize = lastViewportSizeRef.current ?? FALLBACK_TERMINAL_SIZE;');
        expect(terminalViewSource).not.toContain('if (!size && isTerminalVisibleRef.current)');
        expect(terminalViewSource).toContain('cols: initialSize.cols');
        expect(terminalViewSource).toContain('rows: initialSize.rows');
        expect(terminalViewSource).toContain('void terminal.resize({');
        expect(terminalViewSource).toContain('if (!isTerminalVisible) {');
        expect(terminalViewSource).not.toContain('isTerminalVisibleRef');
    });

    test('deduplicates create attempts while the viewport layout settles', () => {
        expect(terminalViewSource).toContain('pendingTerminalCreatesRef.current.has(createKey)');
        expect(terminalViewSource).toContain('pendingTerminalCreatesRef.current.delete(createKey)');
    });

    test('derives the initial PTY size before Ghostty mounts', () => {
        expect(terminalViewportSource).toContain('const getProvisionalTerminalSize');
        expect(terminalViewportSource).toContain('React.useLayoutEffect(() => {');
        expect(terminalViewportSource).toContain('(provisionalSizeCallbackRef.current ?? resizeRef.current)(size.cols, size.rows)');
    });
});

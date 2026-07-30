import { describe, expect, test } from 'bun:test';
import {
  buildBlockCodePathScanText,
  shouldInterceptMarkdownFileHref,
  shouldPreserveMarkdownFileUrl,
} from '../markdownFileReferences';

describe('markdown file URL preservation', () => {
  test('preserves a local image URL when React Markdown transforms the src attribute', () => {
    // Given
    const localImageUrl = 'file:///Users/test/project/.tmp/preview.png';

    // When
    const preserved = shouldPreserveMarkdownFileUrl(localImageUrl, 'src');

    // Then
    expect(preserved).toBe(true);
  });

  test('continues to reject unsafe non-file protocols', () => {
    // Given
    const unsafeUrl = 'javascript:alert(1)';

    // When
    const preserved = shouldPreserveMarkdownFileUrl(unsafeUrl, 'src');

    // Then
    expect(preserved).toBe(false);
  });
});

describe('markdown file-link navigation', () => {
  test('intercepts workspace paths before browser navigation', () => {
    // Given
    const workspaceHrefs = [
      'AGENTS.md',
      '.okf/infrastructure/server-topology.md',
      '/Users/test/project/README.md:42:7',
      'file:///Users/test/project/preview.png',
    ];

    // When
    const intercepted = workspaceHrefs.map(shouldInterceptMarkdownFileHref);

    // Then
    expect(intercepted).toEqual([true, true, true, true]);
  });

  test('leaves non-file links to their native handlers', () => {
    // Given
    const nativeHrefs = [
      'https://example.com/docs',
      'mailto:test@example.com',
      '#installation',
      '?tab=preview',
    ];

    // When
    const intercepted = nativeHrefs.map(shouldInterceptMarkdownFileHref);

    // Then
    expect(intercepted).toEqual([false, false, false, false]);
  });
});

describe('markdown block-code file references', () => {
  test('excludes visual line numbers from path scanning', () => {
    // Given
    const renderedSegments = [
      { text: '1', isLineNumber: true },
      { text: 'acme.sh --set-default-ca --server letsencrypt\n', isLineNumber: false },
      { text: '2', isLineNumber: true },
      { text: 'acme.sh --issue -d edu-hub.ai', isLineNumber: false },
    ];

    // When
    const scanText = buildBlockCodePathScanText(renderedSegments);

    // Then
    expect(scanText).toBe(
      'acme.sh --set-default-ca --server letsencrypt\nacme.sh --issue -d edu-hub.ai',
    );
  });
});

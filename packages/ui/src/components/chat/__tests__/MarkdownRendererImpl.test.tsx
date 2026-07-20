import { describe, expect, test } from 'bun:test';
import { shouldPreserveMarkdownFileUrl } from '../markdownFileReferences';

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

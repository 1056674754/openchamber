import { describe, expect, test } from 'bun:test';

import {
  buildHtmlFilePreviewDocument,
  isHtmlFilePreviewNavigationMessage,
  resolveHtmlFilePreviewNavigation,
} from './htmlFilePreviewNavigation';

describe('HTML file preview document', () => {
  test('injects the navigation bridge without replacing the document base URL', () => {
    // Given
    const html = '<!doctype html><html><head><title>Report</title></head><body><a href="#summary">Summary</a></body></html>';

    // When
    const output = buildHtmlFilePreviewDocument(html);

    // Then
    expect(output).toContain('openchamber-html-file-preview');
    expect(output.indexOf('openchamber-html-file-preview')).toBeLessThan(output.indexOf('<title>Report</title>'));
    expect(output).not.toContain('<base href=');
  });
});

describe('HTML file preview navigation', () => {
  test('keeps same-document fragments inside the iframe', () => {
    // Given
    const href = '#execution-summary';

    // When
    const navigation = resolveHtmlFilePreviewNavigation(href, '/workspace/reports/REPORT.html');

    // Then
    expect(navigation).toEqual({ kind: 'ignore' });
  });

  test('opens relative file links beside the source file', () => {
    // Given
    const href = '../notes/SYNTHESIS%20FINAL.md#decision';

    // When
    const navigation = resolveHtmlFilePreviewNavigation(href, '/workspace/reports/REPORT.html');

    // Then
    expect(navigation).toEqual({
      kind: 'file',
      path: '/workspace/notes/SYNTHESIS FINAL.md',
    });
  });

  test('opens HTTP links outside the preview iframe', () => {
    // Given
    const href = 'https://example.com/docs?q=preview#links';

    // When
    const navigation = resolveHtmlFilePreviewNavigation(href, '/workspace/reports/REPORT.html');

    // Then
    expect(navigation).toEqual({
      kind: 'external',
      url: 'https://example.com/docs?q=preview#links',
    });
  });

  test('ignores untrusted preview messages with the wrong contract', () => {
    // Given
    const message = {
      source: 'openchamber-html-file-preview',
      version: 2,
      type: 'navigate',
      href: '../SYNTHESIS.md',
    };

    // When
    const valid = isHtmlFilePreviewNavigationMessage(message);

    // Then
    expect(valid).toBe(false);
  });
});

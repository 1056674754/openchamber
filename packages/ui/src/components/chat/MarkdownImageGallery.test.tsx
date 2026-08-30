import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { MarkdownImageGallery } from './MarkdownImageGallery';

describe('MarkdownImageGallery', () => {
  test('renders a stable compact thumbnail slot for every remote image', () => {
    const html = renderToStaticMarkup(
      <MarkdownImageGallery
        sessionId="ses_gallery"
        messageId="msg_gallery"
        directory="/repo"
        contents={[
          '![Desktop](https://example.com/desktop.png)\n'
          + '![Tablet](https://example.com/tablet.png)\n'
          + '![Mobile](https://example.com/mobile.png)',
        ]}
      />,
    );

    expect(html).toContain('data-openchamber-markdown-gallery="true"');
    expect((html.match(/size-\[100px\]/g) ?? [])).toHaveLength(3);
    expect(html).toContain('desktop.png');
    expect(html).toContain('tablet.png');
    expect(html).toContain('mobile.png');
  });
});

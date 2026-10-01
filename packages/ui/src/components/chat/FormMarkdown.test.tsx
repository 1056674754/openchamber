import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { FormMarkdown } from './FormMarkdown';

// The markdown renderer is lazy, so a synchronous server render always emits
// the Suspense fallback. The typography classes live on FormMarkdown's own
// wrapper, which is the surface that has to keep the question typography.
describe('FormMarkdown', () => {
  test('applies meta typography and caller classes on the wrapper', () => {
    const html = renderToStaticMarkup(
      <FormMarkdown content="Meta" size="meta" className="font-medium text-foreground" />,
    );

    expect(html).toContain('class="form-markdown typography-meta font-medium text-foreground"');
  });

  test('applies micro typography and caller classes', () => {
    const html = renderToStaticMarkup(
      <FormMarkdown content="Micro" size="micro" className="text-muted-foreground" />,
    );

    expect(html).toContain('class="form-markdown typography-micro text-muted-foreground"');
  });
});

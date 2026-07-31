import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { I18nProvider } from '@/lib/i18n';

mock.module('@/hooks/useSessionAssist', () => ({
  useSessionAssistState: () => ({
    assist: null,
    visibleRecap: 'No coding action has been performed yet.',
    suggestion: null,
  }),
}));

const { SessionRecapNote } = await import('./SessionRecapNote');

describe('SessionRecapNote', () => {
  test('keeps the recap below the final assistant message metadata', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <SessionRecapNote sessionId="session-test" isMobile={false} />
      </I18nProvider>,
    );

    expect(markup).toContain('class="mt-2"');
    expect(markup).not.toContain('-mt-');
    expect(markup).toContain('No coding action has been performed yet.');
  });
});

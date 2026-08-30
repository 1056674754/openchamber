import React from 'react';
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { I18nProvider } from '@/lib/i18n';

const SESSION_ID = 'ses_context_stall_test';
const STALL = {
  sessionId: SESSION_ID,
  statusType: 'busy' as const,
  lastActivityAt: 1_700_000_000_000,
  detectedAt: 1_700_000_030_000,
};
let currentSessionId: string | null = SESSION_ID;
let draftOpen = false;

mock.module('@/contexts/useThemeSystem', () => ({
  useThemeSystem: () => ({ currentTheme: {} }),
}));

mock.module('@/lib/theme/syntaxThemeGenerator', () => ({
  generateSyntaxTheme: () => ({}),
}));

mock.module('@/stores/useConfigStore', () => ({
  useConfigStore: (selector: (state: { providers: unknown[] }) => unknown) => selector({ providers: [] }),
}));

mock.module('@/stores/useSessionStallStore', () => ({
  useSessionStall: () => STALL,
  useSessionStallStore: {
    getState: () => ({ clearStall: () => {} }),
  },
}));

mock.module('@/components/chat/work-status/DraftContextOverview', () => ({
  DraftContextOverview: () => <div data-testid="draft-context-overview">Draft context</div>,
}));

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: (selector: (state: { currentSessionId: string | null; newSessionDraft: { open: boolean } }) => unknown) => selector({
    currentSessionId,
    newSessionDraft: { open: draftOpen },
  }),
}));

mock.module('@/sync/sync-context', () => ({
  useSessions: () => [{ id: SESSION_ID, title: 'Stalled session', time: { created: 1_700_000_000_000 } }],
  useSessionMessageRecords: () => [],
}));

const { ContextPanelContent } = await import('./ContextSidebarTab');

describe('ContextPanelContent', () => {
  test('shows the current session stall before raw messages', () => {
    currentSessionId = SESSION_ID;
    draftOpen = false;
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <ContextPanelContent />
      </I18nProvider>,
    );

    const diagnosticIndex = markup.indexOf('data-testid="session-stall-diagnostic"');
    const rawMessagesIndex = markup.indexOf('Raw Messages');

    expect(diagnosticIndex).toBeGreaterThan(-1);
    expect(rawMessagesIndex).toBeGreaterThan(diagnosticIndex);
    expect(markup).toContain(SESSION_ID);
  });

  test('shows the draft overview when no session has materialized yet', () => {
    currentSessionId = null;
    draftOpen = true;

    const markup = renderToStaticMarkup(
      <I18nProvider>
        <ContextPanelContent />
      </I18nProvider>,
    );

    expect(markup).toContain('data-testid="draft-context-overview"');
    expect(markup).toContain('Draft context');
  });
});

import React from 'react';
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { I18nProvider } from '@/lib/i18n';

type MockContainerProps = React.PropsWithChildren<{ open?: boolean }>;
type MockButtonProps = React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>;

mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ children, open = true }: MockContainerProps) => (open ? <>{children}</> : null),
  DialogContent: ({ children }: MockContainerProps) => <div>{children}</div>,
  DialogDescription: ({ children }: MockContainerProps) => <p>{children}</p>,
  DialogFooter: ({ children }: MockContainerProps) => <div>{children}</div>,
  DialogHeader: ({ children }: MockContainerProps) => <div>{children}</div>,
  DialogTitle: ({ children }: MockContainerProps) => <h2>{children}</h2>,
}));

mock.module('@/components/ui/button', () => ({
  Button: ({ children, ...props }: MockButtonProps) => <button {...props}>{children}</button>,
}));

const { RuntimeFallbackApprovalContent } = await import('./RuntimeFallbackApprovalDialog');

describe('RuntimeFallbackApprovalContent', () => {
  test('shows the target model in the title, model transition, and primary action', () => {
    const candidateModel = 'zhipuai-coding-plan/glm-5.2';
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <RuntimeFallbackApprovalContent
          active={{
            id: 'fallback-qa',
            sessionID: 'ses_fallback_qa',
            currentModel: 'deepseek/deepseek-v4-pro',
            candidateModel,
            source: 'session.timeout',
            expiresAt: Date.now() + 30_000,
            preflight: {
              status: 'available',
              providerId: 'zhipuai-coding-plan',
            },
          }}
          submitting={false}
          secondsRemaining={30}
          onRespond={() => {}}
        />
      </I18nProvider>,
    );

    expect(markup).toContain(`Switch to ${candidateModel}?`);
    expect(markup).toContain(`Switch to ${candidateModel}</button>`);
    expect(markup).toContain('deepseek/deepseek-v4-pro');
    expect(markup).toContain(candidateModel);
  });
});

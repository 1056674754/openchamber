import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { useSessionStall, useSessionStallStore } from '@/stores/useSessionStallStore';

type SessionStallDiagnosticProps = {
  sessionId: string;
};

export const SessionStallDiagnostic = React.memo<SessionStallDiagnosticProps>(({ sessionId }) => {
  const { t } = useI18n();
  const sessionStall = useSessionStall(sessionId);

  if (!sessionStall) {
    return null;
  }

  const diagnostic = JSON.stringify({
    sessionId: sessionStall.sessionId,
    statusType: sessionStall.statusType,
    statusAttempt: sessionStall.statusAttempt,
    statusMessage: sessionStall.statusMessage,
    lastActivityAt: new Date(sessionStall.lastActivityAt).toISOString(),
    detectedAt: new Date(sessionStall.detectedAt).toISOString(),
    stalledForMs: Date.now() - sessionStall.detectedAt,
  }, null, 2);

  return (
    <section
      role="alert"
      data-testid="session-stall-diagnostic"
      className="mb-5 overflow-hidden rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-background)]"
    >
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[var(--status-warning)] [&::-webkit-details-marker]:hidden">
          <Icon name="error-warning" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 typography-ui-label font-semibold">Session status stall</span>
          <span className="typography-micro font-semibold uppercase">{sessionStall.statusType}</span>
          <Icon name="arrow-right-s" className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-[var(--status-warning-border)] px-3 pb-2.5 pt-2">
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all typography-micro text-foreground/80">
            {diagnostic}
          </pre>
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              size="xs"
              className="text-[var(--status-warning)] hover:bg-[var(--interactive-hover)]"
              onClick={() => useSessionStallStore.getState().clearStall(sessionStall.sessionId)}
            >
              {t('chat.questionCard.dismiss')}
            </Button>
          </div>
        </div>
      </details>
    </section>
  );
});

SessionStallDiagnostic.displayName = 'SessionStallDiagnostic';

import React from 'react';
import { RiArrowDownLine, RiShieldCheckLine, RiTimerLine } from '@remixicon/react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { subscribeOpenchamberEventEnvelopes } from '@/lib/openchamberEvents';
import { useI18n } from '@/lib/i18n';

export type RuntimeFallbackApproval = {
  id: string;
  sessionID: string;
  currentModel: string;
  candidateModel: string;
  source: string;
  expiresAt: number;
  preflight: {
    status: 'available' | 'unknown';
    providerId: string | null;
  };
};

type RuntimeFallbackDecision = 'approve' | 'reject';

function parseApproval(value: unknown): RuntimeFallbackApproval | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.status !== 'pending') return null;
  const preflight = record.preflight && typeof record.preflight === 'object'
    ? record.preflight as Record<string, unknown>
    : {};
  const status = preflight.status === 'available' ? 'available' : 'unknown';
  if (
    typeof record.id !== 'string'
    || typeof record.sessionID !== 'string'
    || typeof record.currentModel !== 'string'
    || typeof record.candidateModel !== 'string'
    || typeof record.source !== 'string'
    || typeof record.expiresAt !== 'number'
  ) {
    return null;
  }
  return {
    id: record.id,
    sessionID: record.sessionID,
    currentModel: record.currentModel,
    candidateModel: record.candidateModel,
    source: record.source,
    expiresAt: record.expiresAt,
    preflight: {
      status,
      providerId: typeof preflight.providerId === 'string' ? preflight.providerId : null,
    },
  };
}

type RuntimeFallbackApprovalContentProps = {
  active: RuntimeFallbackApproval | null;
  submitting: boolean;
  secondsRemaining: number;
  onRespond: (decision: RuntimeFallbackDecision) => void;
};

export function RuntimeFallbackApprovalContent({
  active,
  submitting,
  secondsRemaining,
  onRespond,
}: RuntimeFallbackApprovalContentProps): React.ReactNode {
  const { t } = useI18n();
  const timeoutTriggered = active?.source === 'session.timeout';

  return (
    <Dialog
      open={Boolean(active)}
      onOpenChange={(open) => {
        if (!open && active && !submitting) onRespond('reject');
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiShieldCheckLine className="size-5 text-primary" />
            {t('runtimeFallback.approval.title', { model: active?.candidateModel ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {timeoutTriggered
              ? t('runtimeFallback.approval.timeoutDescription')
              : t('runtimeFallback.approval.errorDescription')}
          </DialogDescription>
        </DialogHeader>

        {active ? (
          <div className="flex flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <span className="min-w-0 break-words typography-ui-label text-muted-foreground">
                {active.currentModel}
              </span>
              <div className="flex min-w-0 items-start gap-2">
                <RiArrowDownLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words typography-ui-label text-foreground">
                  {active.candidateModel}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 typography-micro text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <RiShieldCheckLine className="size-3.5" />
                {active.preflight.status === 'available'
                  ? t('runtimeFallback.approval.quotaAvailable')
                  : t('runtimeFallback.approval.quotaUnknown')}
              </span>
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <RiTimerLine className="size-3.5" />
                {t('runtimeFallback.approval.autoSwitch', { seconds: secondsRemaining })}
              </span>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onRespond('reject')}>
            {t('runtimeFallback.approval.keepCurrent')}
          </Button>
          <Button disabled={submitting} onClick={() => onRespond('approve')}>
            {t('runtimeFallback.approval.switchNow', { model: active?.candidateModel ?? '' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RuntimeFallbackApprovalDialog(): React.ReactNode {
  const [approvals, setApprovals] = React.useState<RuntimeFallbackApproval[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const active = approvals[0] ?? null;

  React.useEffect(() => {
    let cancelled = false;
    void fetch('/api/runtime-fallback/approvals')
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled || !Array.isArray(payload?.approvals)) return;
        setApprovals(payload.approvals.map(parseApproval).filter(Boolean) as RuntimeFallbackApproval[]);
      })
      .catch(() => {});

    const unsubscribe = subscribeOpenchamberEventEnvelopes((event) => {
      if (event.type !== 'openchamber:runtime-fallback-approval') return;
      const properties = event.properties && typeof event.properties === 'object'
        ? event.properties as Record<string, unknown>
        : null;
      const id = typeof properties?.id === 'string' ? properties.id : '';
      if (!id) return;
      if (properties?.status === 'resolved') {
        setApprovals((current) => current.filter((item) => item.id !== id));
        return;
      }
      const approval = parseApproval(properties);
      if (!approval) return;
      setApprovals((current) => [
        ...current.filter((item) => item.id !== approval.id),
        approval,
      ].sort((left, right) => left.expiresAt - right.expiresAt));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const respond = React.useCallback(async (decision: RuntimeFallbackDecision) => {
    if (!active || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/runtime-fallback/approvals/${encodeURIComponent(active.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (response.ok || response.status === 404) {
        setApprovals((current) => current.filter((item) => item.id !== active.id));
      }
    } finally {
      setSubmitting(false);
    }
  }, [active, submitting]);

  const secondsRemaining = active
    ? Math.max(0, Math.ceil((active.expiresAt - now) / 1_000))
    : 0;

  return (
    <RuntimeFallbackApprovalContent
      active={active}
      submitting={submitting}
      secondsRemaining={secondsRemaining}
      onRespond={respond}
    />
  );
}

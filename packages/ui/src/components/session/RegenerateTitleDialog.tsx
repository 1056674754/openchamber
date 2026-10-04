import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SidebarSpinner } from './sidebar/SidebarSpinner';
import { RiSparklingLine, RiCheckLine, RiRefreshLine } from '@remixicon/react';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/components/ui';
import { opencodeClient } from '@/lib/opencode/client';
import { useConfigStore } from '@/stores/useConfigStore';
import { getSessionLastAssistantModel } from '@/sync/session-actions';
import { getSessionDirectoryFromRoutingIndex } from '@/sync/sync-refs';
import { buildSessionText, fetchSessionTitleCandidates } from '@/lib/sessionTitleApi';

type RegenerateTitleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  sessionTitle: string;
  onApply: (sessionId: string, newTitle: string) => Promise<void>;
};

export function RegenerateTitleDialog({
  open,
  onOpenChange,
  sessionId,
  sessionTitle,
  onApply,
}: RegenerateTitleDialogProps): React.ReactNode {
  const { t } = useI18n();
  const [loading, setLoading] = React.useState(false);
  const [candidates, setCandidates] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState<number>(-1);
  const [editedTitle, setEditedTitle] = React.useState('');
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setCandidates([]);
      setError(null);
      setSelectedIndex(-1);
      setEditedTitle('');
      setLoading(false);
      setApplying(false);
    }
  }, [open]);

  const loadCandidates = React.useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    setCandidates([]);
    setSelectedIndex(-1);
    // Manual escape hatch: keep the current title editable when AI fails.
    setEditedTitle(sessionTitle || '');
    try {
      const page = await opencodeClient.getSessionMessages(sessionId, { limit: 30 });
      if (signal?.cancelled) return;
      const text = buildSessionText(page.items);
      const sessionModel = getSessionLastAssistantModel(sessionId);
      const { currentProviderId, currentModelId } = useConfigStore.getState();
      const directory = getSessionDirectoryFromRoutingIndex(sessionId)
        || opencodeClient.getDirectory()
        || null;
      const res = await fetchSessionTitleCandidates({
        text,
        directory,
        preferredProviderID: sessionModel?.providerID || currentProviderId || null,
        preferredModelID: sessionModel?.modelID || currentModelId || null,
      });
      if (signal?.cancelled) return;
      if (res.generated && res.candidates.length > 0) {
        setCandidates(res.candidates);
        setSelectedIndex(0);
        setEditedTitle(res.candidates[0]);
        setError(null);
      } else {
        setCandidates([]);
        setSelectedIndex(-1);
        setEditedTitle(sessionTitle || '');
        setError(res.reason || t('sessions.sidebar.session.regenerateTitle.error'));
      }
    } catch (err) {
      if (signal?.cancelled) return;
      setCandidates([]);
      setSelectedIndex(-1);
      setEditedTitle(sessionTitle || '');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [sessionId, sessionTitle, t]);

  React.useEffect(() => {
    if (!open || !sessionId) return;
    const signal = { cancelled: false };
    void loadCandidates(signal);
    return () => { signal.cancelled = true; };
  }, [open, sessionId, loadCandidates]);
  const handleSelect = React.useCallback((index: number) => {
    setSelectedIndex(index);
    setEditedTitle(candidates[index]);
  }, [candidates]);

  const handleApply = React.useCallback(async () => {
    if (!editedTitle.trim() || applying) return;
    setApplying(true);
    try {
      await onApply(sessionId, editedTitle.trim());
      toast.success(t('sessions.sidebar.session.regenerateTitle.toastApplied'));
      onOpenChange(false);
    } catch {
      toast.error(t('sessions.sidebar.session.regenerateTitle.toastError'));
    } finally {
      setApplying(false);
    }
  }, [editedTitle, applying, onApply, sessionId, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiSparklingLine className="h-4 w-4 text-[var(--primary-base)]" />
            {t('sessions.sidebar.session.regenerateTitle.dialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {sessionTitle || t('sessions.sidebar.session.untitled')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <SidebarSpinner state="streaming" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {error ? (
              <div className="rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/5 px-3 py-3 text-sm">
                <p className="font-medium text-[var(--status-error)]">
                  {t('sessions.sidebar.session.regenerateTitle.error')}
                </p>
                <p className="mt-1 text-xs text-[var(--surface-mutedForeground)]">{error}</p>
                <p className="mt-2 text-xs text-[var(--surface-mutedForeground)]">
                  {t('sessions.sidebar.session.regenerateTitle.manualHint')}
                </p>
              </div>
            ) : null}

            {candidates.length > 0 ? (
              <div className="flex flex-col gap-2">
                {candidates.map((candidate, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleSelect(index)}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selectedIndex === index
                        ? 'border-[var(--primary-base)] bg-[var(--primary-base)]/10 text-[var(--surface-foreground)]'
                        : 'border-[var(--interactive-border)] hover:bg-[var(--interactive-hover)] text-[var(--surface-foreground)]'
                    }`}
                  >
                    <span className="mt-0.5 flex-shrink-0">
                      {selectedIndex === index
                        ? <RiCheckLine className="h-4 w-4 text-[var(--primary-base)]" />
                        : <span className="inline-block h-4 w-4 rounded-full border border-[var(--interactive-border)]" />}
                    </span>
                    <span className="flex-1">{candidate}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs text-[var(--surface-mutedForeground)]">
                {t('sessions.sidebar.session.regenerateTitle.editLabel')}
              </label>
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="w-full rounded-md border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--surface-foreground)] placeholder:text-[var(--surface-mutedForeground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-base)]"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { void loadCandidates(); }}
            disabled={loading}
          >
            <RiRefreshLine className="mr-1 h-3.5 w-3.5" />
            {t('sessions.sidebar.session.regenerateTitle.regenerate')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={applying}
            >
              {t('sessions.sidebar.session.regenerateTitle.cancel')}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleApply}
              disabled={loading || applying || !editedTitle.trim()}
            >
              {t('sessions.sidebar.session.regenerateTitle.apply')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

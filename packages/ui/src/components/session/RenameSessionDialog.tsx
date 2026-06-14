import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/components/ui';

type RenameSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  currentTitle: string;
  onApply: (sessionId: string, newTitle: string) => Promise<void>;
};

export function RenameSessionDialog({
  open,
  onOpenChange,
  sessionId,
  currentTitle,
  onApply,
}: RenameSessionDialogProps): React.ReactNode {
  const { t } = useI18n();
  const [editedTitle, setEditedTitle] = React.useState('');
  const [applying, setApplying] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setEditedTitle(currentTitle);
      setApplying(false);
    }
  }, [open, currentTitle]);

  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  const handleApply = React.useCallback(async () => {
    const trimmed = editedTitle.trim();
    if (!trimmed || applying) return;
    setApplying(true);
    try {
      await onApply(sessionId, trimmed);
      toast.success(t('sessions.sidebar.session.rename.toastApplied'));
      onOpenChange(false);
    } catch {
      toast.error(t('sessions.sidebar.session.rename.toastError'));
    } finally {
      setApplying(false);
    }
  }, [editedTitle, applying, onApply, sessionId, onOpenChange, t]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleApply();
    }
  }, [handleApply]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="pencil-ai" className="h-4 w-4 text-[var(--primary-base)]" />
            {t('sessions.sidebar.session.rename.dialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {currentTitle || t('sessions.sidebar.session.untitled')}
          </DialogDescription>
        </DialogHeader>

        <div>
          <label className="mb-1 block text-xs text-[var(--surface-mutedForeground)]">
            {t('sessions.sidebar.session.rename.editLabel')}
          </label>
          <input
            ref={inputRef}
            type="text"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full rounded-md border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--surface-foreground)] placeholder:text-[var(--surface-mutedForeground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-base)]"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            {t('sessions.sidebar.session.rename.dialogCancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleApply}
            disabled={applying || !editedTitle.trim()}
          >
            {t('sessions.sidebar.session.rename.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, { useCallback, useEffect, useRef } from 'react';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/components/ui/toast';
import type { UseBrowserVoiceReturn } from '@/hooks/useBrowserVoice';

export interface ComposerDictationProps {
    open: boolean;
    voice: UseBrowserVoiceReturn;
    composerMessage: string;
    onClose: () => void;
    onCommit?: () => void;
}

export const ComposerDictation: React.FC<ComposerDictationProps> = ({
    open,
    voice,
    composerMessage,
    onClose,
    onCommit,
}) => {
    const { t } = useI18n();
    const {
        status,
        interimTranscript,
        stopVoice,
        finishVoiceInput,
        conversationMode,
        toggleConversationMode,
        error,
    } = voice;

    const lastToastedErrorRef = useRef<string | null>(null);

    useEffect(() => {
        if (error) {
            if (lastToastedErrorRef.current !== error) {
                lastToastedErrorRef.current = error;
                toast.error(error, { duration: 5000 });
            }
        } else {
            lastToastedErrorRef.current = null;
        }
    }, [error]);

    const handleDone = useCallback(() => {
        finishVoiceInput();
        onClose();
    }, [finishVoiceInput, onClose]);

    const handleCancel = useCallback(() => {
        stopVoice();
        if (onCommit) {
            onCommit();
        } else {
            onClose();
        }
    }, [stopVoice, onCommit, onClose]);

    const isListening = status === 'listening';
    const isError = status === 'error' && Boolean(error);
    const hasText = composerMessage.trim().length > 0 || interimTranscript.length > 0;

    const renderGrabber = () => (
        <div className="flex items-center justify-center py-2.5" aria-hidden="true">
            <span className="oc-dictation-grabber h-1 w-10 rounded-full bg-[var(--interactive-border)]" />
        </div>
    );

    return (
        <MobileOverlayPanel
            open={open}
            title={t('voice.dictation.title')}
            onClose={handleCancel}
            className="oc-dictation-sheet"
            contentMaxHeightClassName="max-h-[min(50vh,360px)]"
            renderHeader={renderGrabber}
            footer={
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onPointerDownCapture={(event) => event.stopPropagation()}
                        onClick={toggleConversationMode}
                        aria-pressed={conversationMode}
                        aria-label={t('voice.status.conversationModeActiveAria')}
                        title={t('voice.status.conversationModeActiveAria')}
                        className={conversationMode
                            ? 'text-[var(--status-info)] hover:text-[var(--status-info)]'
                            : 'text-[var(--surface-muted-foreground)]'}
                    >
                        <Icon name="voice-recognition" className="h-4 w-4" />
                    </Button>
                    <div className="flex-1" />
                    <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                        {t('voice.dictation.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={handleDone}
                        disabled={status === 'processing'}
                    >
                        {status === 'processing'
                            ? <Icon name="loader-4" className="h-4 w-4 animate-spin" />
                            : <Icon name="check" className="h-4 w-4" />}
                        {t('voice.dictation.done')}
                    </Button>
                </div>
            }
        >
            <div className="oc-dictation-body flex min-h-[120px] flex-col gap-3 px-1 py-2">
                {isError ? (
                    <div className="flex items-start gap-2 rounded-lg bg-[var(--status-error-background)] p-3 text-[var(--status-error)]">
                        <Icon name="error-warning" className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span className="typography-ui-label">{error}</span>
                    </div>
                ) : hasText ? (
                    <p className="typography-markdown leading-relaxed text-[var(--surface-foreground)]">
                        {composerMessage}
                        {interimTranscript
                            ? <span className="italic text-[var(--surface-muted-foreground)]"> {interimTranscript}</span>
                            : null}
                    </p>
                ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                        <Icon
                            name="mic"
                            className={cn(
                                'h-7 w-7',
                                isListening
                                    ? 'animate-pulse text-[var(--status-error)]'
                                    : 'text-[var(--surface-muted-foreground)]',
                            )}
                        />
                        <span className="typography-ui-label text-[var(--surface-muted-foreground)]">
                            {isListening ? t('voice.dictation.listeningHint') : t('voice.dictation.idleHint')}
                        </span>
                    </div>
                )}
            </div>
        </MobileOverlayPanel>
    );
};

ComposerDictation.displayName = 'ComposerDictation';

export default ComposerDictation;

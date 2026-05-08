import React from 'react';
import { OpenChamberLogo } from '@/components/ui/OpenChamberLogo';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useGlobalSyncStore } from '@/sync/global-sync-store';
import { useI18n } from '@/lib/i18n';

interface ChatEmptyStateProps {
    isSubmitting?: boolean;
}

const ChatEmptyState: React.FC<ChatEmptyStateProps> = ({ isSubmitting }) => {
    const { t } = useI18n();
    const { currentTheme } = useThemeSystem();
    const initError = useGlobalSyncStore((s) => s.error);

    const textColor = currentTheme?.colors?.surface?.mutedForeground || 'var(--muted-foreground)';

    return (
        <div className="flex flex-col items-center justify-center min-h-full w-full gap-6">
            {isSubmitting ? (
                <>
                    <div className="relative">
                        <OpenChamberLogo width={140} height={140} className="opacity-20" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent opacity-50" style={{ color: textColor }} />
                        </div>
                    </div>
                    <span className="text-body-md" style={{ color: textColor }}>{t('chat.emptyState.creatingSession')}</span>
                </>
            ) : initError ? (
                <div className="flex flex-col items-center gap-2 max-w-md text-center px-4">
                    <span className="text-body-md font-medium text-destructive">{t('chat.emptyState.opencodeUnreachable')}</span>
                    <span className="text-body-sm" style={{ color: textColor }}>
                        {initError.message}
                    </span>
                </div>
            ) : (
                <>
                    <OpenChamberLogo width={140} height={140} className="opacity-20" />
                    <span className="text-body-md" style={{ color: textColor }}>{t('chat.emptyState.startNewChat')}</span>
                </>
            )}
        </div>
    );
};

export default React.memo(ChatEmptyState);

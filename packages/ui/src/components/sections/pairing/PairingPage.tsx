import React from 'react';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { PairingDevicesPanel } from '@/components/sections/remote-instances/PairingDevicesPanel';
import { useI18n } from '@/lib/i18n';

/**
 * Standalone settings page for Private Relay + device pairing.
 * Kept separate from Remote Instances (SSH / HTTP remotes).
 */
export const PairingPage: React.FC = () => {
  const { t } = useI18n();

  return (
    <SettingsPageLayout>
      <div className="mb-6 px-1 space-y-0.5">
        <h2 className="typography-ui-header font-semibold text-foreground">
          {t('settings.page.pairing.title')}
        </h2>
        <p className="typography-meta text-muted-foreground">
          {t('settings.page.pairing.description')}
        </p>
      </div>
      <div className="px-1">
        <PairingDevicesPanel />
      </div>
    </SettingsPageLayout>
  );
};

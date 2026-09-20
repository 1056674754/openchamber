import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { isVSCodeRuntime } from '@/lib/desktop';
import { useI18n } from '@/lib/i18n';

import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { GuestIntegrationCard, GuestIntegrationsSection } from './GuestIntegrationsSection';
import { useGuestsStore } from '@/lib/guests/store';
import { isGuestActive } from '@/lib/guests/capabilities';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';
import { GitHubIntegration } from './GitHubIntegration';
import { LinearSettings } from './LinearSettings';
import { ThirdPartyIntegrationsSection } from './ThirdPartyIntegrationsSection';

type IntegrationsPageProps = {
  onOpenProviderSetup: (providerId: string) => Promise<boolean>;
  onOpenPluginManager: () => void;
};

export const IntegrationsPage: React.FC<IntegrationsPageProps> = ({
  onOpenProviderSetup,
  onOpenPluginManager,
}) => {
  const { t } = useI18n();

  // GitHub sign-in is an OpenChamber server feature; the VS Code extension
  // uses the editor's own GitHub session instead. Linear is available when
  // the connected runtime exposes the integration API.
  const hasGitHub = !isVSCodeRuntime();
  const hasLinear = Boolean(getRegisteredRuntimeAPIs()?.linear);
  // Bundled extensions with an integration surface a card here, next to the
  // first-party GitHub/Linear accounts. (upstream 5181bcd33/b59ab5671)
  const guests = useGuestsStore((state) => state.guests);
  const runtimeKey = useGuestsStore((state) => state.runtimeKey);
  const builtInGuests = !isVSCodeRuntime() && !isMobileSurfaceRuntime()
    ? guests.filter((guest) => guest.source === 'bundled' && guest.integration && isGuestActive(guest))
    : [];
  const hasBuiltIn = hasGitHub || hasLinear || builtInGuests.length > 0;

  return (
    <SettingsPageLayout>
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="typography-ui-header font-semibold text-foreground">{t('settings.page.integrations.title')}</h1>
          <p className="typography-meta text-muted-foreground">{t('settings.page.integrations.description')}</p>
        </div>
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] p-3"
        >
          <Icon name="error-warning" className="mt-0.5 size-4 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
          <p className="typography-meta text-[var(--status-warning)]">
            {t('settings.integrations.experimentalWarning')}
          </p>
        </div>
      </div>
      {hasBuiltIn ? (
        <SettingsSection
          title={t('settings.integrations.firstParty.title')}
          info={t('settings.integrations.firstParty.info')}
          divider={false}
          settingsItem="integrations.first-party"
          contentClassName="space-y-3"
        >
          {hasGitHub ? <GitHubIntegration /> : null}
          {hasLinear ? <LinearSettings /> : null}
          {builtInGuests.map((guest) => <GuestIntegrationCard key={`${runtimeKey}:${guest.id}`} guest={guest} />)}
        </SettingsSection>
      ) : null}
      <GuestIntegrationsSection divider={hasBuiltIn} />
      <ThirdPartyIntegrationsSection
        onOpenProviderSetup={onOpenProviderSetup}
        onOpenPluginManager={onOpenPluginManager}
      />
    </SettingsPageLayout>
  );
};

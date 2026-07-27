import React from 'react';

import {
  connectionDisplayUrl,
  findActiveConnection,
  type MobileSavedConnection,
} from '@/apps/mobileConnections';
import { useI18n } from '@/lib/i18n';
import { isRelayModeActive } from '@/lib/relay/runtime-tunnel';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

const truncateLabel = (value: string, max = 14): string => {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
};

/**
 * Narrow header chip: active saved instance short name + live LAN/Relay.
 * Reads findActiveConnection imperatively so Header does not subscribe to the
 * full connections list.
 */
export const MobileActiveInstanceChip: React.FC = () => {
  const { t } = useI18n();
  const [active, setActive] = React.useState<MobileSavedConnection | null>(() => findActiveConnection());
  const [relayActive, setRelayActive] = React.useState(() => isRelayModeActive());

  React.useEffect(() => {
    const refresh = () => {
      setActive(findActiveConnection());
      setRelayActive(isRelayModeActive());
    };
    refresh();
    return subscribeRuntimeEndpointChanged(refresh);
  }, []);

  if (!active) return null;

  const label = truncateLabel(active.label || connectionDisplayUrl(active));
  const transport = t(relayActive ? 'mobile.transport.relay' : 'mobile.transport.lan');

  return (
    <span
      className="max-w-[9.5rem] truncate typography-meta text-muted-foreground"
      title={`${active.label || connectionDisplayUrl(active)} · ${transport}`}
    >
      {label}
      {' · '}
      {transport}
    </span>
  );
};

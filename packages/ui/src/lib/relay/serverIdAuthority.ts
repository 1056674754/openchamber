/**
 * P0 — Private relay / pairing identity authority for the fork.
 *
 * Pairing and relay transport candidates resolve to at most one `serverId`.
 * Reserved local identities must never be overwritten by pairing enrollment.
 */

import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';

/** Reserved ids that pairing / relay enrollment must not replace. */
export const RESERVED_LOCAL_SERVER_IDS = new Set([DEFAULT_SERVER_ID, 'local']);

export const isReservedLocalServerId = (serverId: string | null | undefined): boolean => {
  const id = typeof serverId === 'string' ? serverId.trim() : '';
  return Boolean(id && RESERVED_LOCAL_SERVER_IDS.has(id));
};

/**
 * Map a relay/pairing host identity to a fork registry serverId.
 * Prefer an explicit remote-instance id; never return reserved local ids for
 * a remote paired host.
 */
export const resolvePairingServerId = (options: {
  preferredServerId?: string | null;
  relayServerId?: string | null;
  fallbackPrefix?: string;
}): string => {
  const preferred = options.preferredServerId?.trim() || '';
  if (preferred && !isReservedLocalServerId(preferred)) {
    return preferred;
  }

  const relayId = options.relayServerId?.trim() || '';
  if (relayId && !isReservedLocalServerId(relayId)) {
    // Remote instances use opaque ids; prefix relay routing ids so they never
    // collide with reserved local keys if the hash ever looks like "default".
    if (relayId === DEFAULT_SERVER_ID || relayId === 'local') {
      return `relay-${relayId}`;
    }
    return relayId;
  }

  const prefix = (options.fallbackPrefix || 'paired').trim() || 'paired';
  return `${prefix}-${crypto.randomUUID()}`;
};

export type PairingTransportKind = 'lan' | 'tunnel' | 'relay';

export const describePairingTransport = (
  candidates: Array<{ type?: string }> | null | undefined,
  activeType?: string | null,
): { kind: PairingTransportKind | 'unknown'; messageKey: `mobile.transport.${'lan' | 'relay' | 'tunnel' | 'lanRelay' | 'unknown'}` } => {
  if (activeType === 'relay' || activeType === 'lan' || activeType === 'tunnel') {
    return {
      kind: activeType,
      messageKey: activeType === 'relay'
        ? 'mobile.transport.relay'
        : activeType === 'tunnel'
          ? 'mobile.transport.tunnel'
          : 'mobile.transport.lan',
    };
  }
  const types = new Set((candidates || []).map((c) => c.type).filter(Boolean));
  if (types.has('relay') && (types.has('lan') || types.has('tunnel'))) {
    return { kind: 'lan', messageKey: 'mobile.transport.lanRelay' };
  }
  if (types.has('relay')) return { kind: 'relay', messageKey: 'mobile.transport.relay' };
  if (types.has('tunnel')) return { kind: 'tunnel', messageKey: 'mobile.transport.tunnel' };
  if (types.has('lan')) return { kind: 'lan', messageKey: 'mobile.transport.lan' };
  return { kind: 'unknown', messageKey: 'mobile.transport.unknown' };
};

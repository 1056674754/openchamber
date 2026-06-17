import React from 'react';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { isDesktopShell, isWebRuntime } from '@/lib/desktop';
import { subscribeOpenchamberEventEnvelopes } from '@/lib/openchamberEvents';
import { useUIStore } from '@/stores/useUIStore';
import type { NotificationPayload } from '@/lib/api/types';

const isFocused = () => {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible' && document.hasFocus();
};

const isLoopbackHost = (host: string): boolean => {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

const isLocalServerOrigin = (): boolean => {
  if (typeof window === 'undefined') return false;
  return isLoopbackHost(window.location.hostname);
};

const toNotificationPayload = (value: unknown): NotificationPayload | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === 'object'
    ? record.properties as Record<string, unknown>
    : null;
  if (record.type !== 'openchamber:notification' || !properties) return null;
  return {
    title: typeof properties.title === 'string' ? properties.title : undefined,
    body: typeof properties.body === 'string' ? properties.body : undefined,
    tag: typeof properties.tag === 'string' ? properties.tag : undefined,
  };
};

export const useWebNotificationStream = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;

  React.useEffect(() => {
    if (!enabled || isDesktopShell() || !isWebRuntime() || typeof window === 'undefined') {
      return;
    }

    return subscribeOpenchamberEventEnvelopes((data) => {
      const settings = useUIStore.getState();
      if (!settings.nativeNotificationsEnabled) return;
      if (settings.notificationMode !== 'always' && isFocused()) return;

      const payload = toNotificationPayload(data);
      if (!payload) return;

      const properties = (data as { properties?: Record<string, unknown> }).properties;
      const deliveredNatively =
        properties?.desktopNotificationDelivered === true ||
        properties?.desktopStdoutActive === true;
      if (deliveredNatively && isLocalServerOrigin()) return;

      const apis = getRegisteredRuntimeAPIs();
      void apis?.notifications?.notifyAgentCompletion(payload);
    });
  }, [enabled]);
};

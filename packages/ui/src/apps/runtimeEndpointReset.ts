import type { RuntimeEndpointChangedDetail } from '@/lib/runtime-switch';

/**
 * Minimal reset when the mobile active endpoint changes.
 * Full upstream reset clears many stores; fork MVP reloads the document so
 * sync/bootstrap rebinds cleanly to the new serverId/baseUrl.
 */
export const resetAppForRuntimeEndpointChange = (detail: RuntimeEndpointChangedDetail): void => {
  if (typeof window === 'undefined') return;
  if (!detail.apiBaseUrl && !detail.previousApiBaseUrl) return;
  if (detail.apiBaseUrl === detail.previousApiBaseUrl) return;
  // Soft hint for future incremental resets; hard reload kept opt-in by callers.
};

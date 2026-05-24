/**
 * Transport-agnostic remote instance types for OpenChamber.
 *
 * UI code should depend on these rather than the transport-specific types in
 * `desktopSsh.ts`.
 */

export type RemoteInstancePhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type RemoteInstanceAuth = {
  type: 'none' | 'password' | 'bearer';
  value?: string;
};

export type RemoteInstance = {
  id: string;
  label: string;
  enabled: boolean;
  url?: string;
  auth?: RemoteInstanceAuth;
  connectionTimeoutSec?: number;
  source?: 'ssh' | 'explicit';
};

export type RemoteInstanceStatus = {
  id: string;
  phase: RemoteInstancePhase;
  detail?: string;
  url?: string;
  healthy?: boolean;
  latencyMs?: number;
  error?: string;
  updatedAtMs: number;
};

export type RemoteInstanceApiEntry = RemoteInstance & {
  health?: {
    healthy: boolean;
    lastCheck?: number;
    latencyMs?: number;
    error?: string;
  };
};

export type RemoteInstancesApiResponse = {
  instances: RemoteInstanceApiEntry[];
};

/**
 * Map fine-grained DesktopSshPhase values to the unified
 * RemoteInstancePhase. The `default` branch collapses all intermediate SSH
 * phases (master_connecting, installing, server_starting, …) into
 * "connecting" so the UI shows a single spinner.
 */
export function mapSshPhaseToRemotePhase(
  phase: string,
): RemoteInstancePhase {
  switch (phase) {
    case 'ready':
    case 'degraded':
      return 'connected';
    case 'error':
      return 'error';
    case 'idle':
      return 'idle';
    default:
      return 'connecting';
  }
}

export function resolveRemoteLabel(instance: RemoteInstance): string {
  return instance.label?.trim() || instance.id;
}

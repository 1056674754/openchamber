/**
 * Pure decision helpers for the OpenCode update toast and PWA install toast.
 *
 * Extracted from React surfaces so dedup decisions can be unit-tested without
 * DOM, storage, or toast side effects.
 */

export interface PwaInstallToastDecisionInput {
  readonly dismissed: string | null;
  readonly sessionShown: string | null;
  readonly hasActiveToast: boolean;
}

export const shouldShowPwaInstallToast = (input: PwaInstallToastDecisionInput): boolean => {
  if (input.dismissed === 'true') return false;
  if (input.sessionShown === 'true') return false;
  if (input.hasActiveToast) return false;
  return true;
};

export interface OpenCodeUpdateToastDecisionInput {
  readonly version: string;
  readonly dismissedVersion: string | null;
  readonly seenVersions: ReadonlySet<string>;
}

export const shouldShowOpenCodeUpdateToast = (
  input: OpenCodeUpdateToastDecisionInput,
): boolean => {
  if (!input.version) return false;
  if (input.seenVersions.has(input.version)) return false;
  if (input.dismissedVersion !== null && input.dismissedVersion === input.version) return false;
  return true;
};

export const resolveOpenCodeUpdateVersion = (detail: unknown): string => {
  if (detail === null || typeof detail !== 'object') return '';
  const candidate = (detail as { version?: unknown }).version;
  if (typeof candidate !== 'string') return '';
  return candidate.trim();
};

export interface OpenCodeUpgradeStatusLike {
  readonly available?: boolean | null;
  readonly latestVersion?: string | null;
}

export const resolveOpenCodeUpgradeStatusVersion = (
  status: OpenCodeUpgradeStatusLike | null | undefined,
): string => {
  if (!status) return '';
  if (status.available !== true) return '';
  if (typeof status.latestVersion !== 'string') return '';
  return status.latestVersion.trim();
};

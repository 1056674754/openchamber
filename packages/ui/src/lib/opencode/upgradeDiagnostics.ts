export type OpenCodeUpgradeResponseLike = {
  success?: boolean;
  version?: string;
  error?: string;
  copyText?: string;
  [key: string]: unknown;
};

export type OpenCodeUpgradeCopyContext = {
  target?: string | null;
  httpStatus?: number | null;
  httpStatusText?: string | null;
};

const DIAGNOSTIC_FIELDS: Array<[key: string, label: string]> = [
  ['rpcTarget', 'RPC target'],
  ['instanceId', 'Instance ID'],
  ['path', 'Path'],
  ['method', 'Method'],
  ['timeoutMs', 'Timeout ms'],
  ['manager', 'Manager'],
  ['packageManager', 'Package manager'],
  ['command', 'Command'],
  ['exitCode', 'Exit code'],
  ['code', 'Code'],
  ['stderr', 'stderr'],
  ['stdout', 'stdout'],
  ['output', 'Output'],
  ['logs', 'Logs'],
  ['detail', 'Detail'],
  ['details', 'Details'],
  ['cause', 'Cause'],
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringFromUnknown = (value: unknown): string => {
  if (value == null || value === false) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(stringFromUnknown).filter(Boolean).join('\n').trim();
  }
  if (isRecord(value)) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value).trim();
};

export const isOpenCodeUpgradeResponseLike = (value: unknown): value is OpenCodeUpgradeResponseLike =>
  isRecord(value);

export const resolveOpenCodeUpgradeError = (
  payload: OpenCodeUpgradeResponseLike | null | undefined,
  fallbackError: string,
): string => {
  const error = stringFromUnknown(payload?.error);
  if (error) return error;
  const message = stringFromUnknown(payload?.message);
  if (message) return message;
  return fallbackError;
};

export const formatOpenCodeUpgradeCopyText = (
  payload: OpenCodeUpgradeResponseLike | null | undefined,
  fallbackError: string,
  context: OpenCodeUpgradeCopyContext = {},
): string => {
  const explicitCopyText = stringFromUnknown(payload?.copyText);
  if (explicitCopyText) return explicitCopyText;

  const error = resolveOpenCodeUpgradeError(payload, fallbackError);
  const sections = ['OpenCode upgrade failed', `Error: ${error}`];

  const target = stringFromUnknown(context.target);
  if (target) sections.push(`Target: ${target}`);

  if (typeof context.httpStatus === 'number' && Number.isFinite(context.httpStatus)) {
    const statusText = stringFromUnknown(context.httpStatusText);
    sections.push(`HTTP status: ${context.httpStatus}${statusText ? ` ${statusText}` : ''}`);
  }

  for (const [key, label] of DIAGNOSTIC_FIELDS) {
    const value = stringFromUnknown(payload?.[key]);
    if (!value || value === error) continue;
    sections.push(`${label}:\n${value}`);
  }

  return sections.join('\n\n');
};

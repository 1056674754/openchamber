import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';

/**
 * Utility for opening external URLs through the active runtime.
 * In desktop runtime, uses Electron preload IPC for system browser handling.
 * Falls back to window.open() for web runtime.
 */

type DesktopShell = {
  shell?: {
    open?: (url: string) => Promise<unknown>;
  };
};

const parseUrlSafely = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const URL_EXPLANATORY_TEXT_BOUNDARY = /[（(，,。；;、\s]/;
const URL_ENCODED_EXPLANATORY_TEXT_BOUNDARY
  = /%(?:20|28|2c|3b|ef%bc%88|ef%bc%8c|e3%80%82|ef%bc%9b|e3%80%81)/i;
const URL_TRAILING_PUNCTUATION = /[),.;:!?'"`，。；、）]+$/g;

const findUrlBoundaryIndex = (value: string): number => {
  const literalIndex = URL_EXPLANATORY_TEXT_BOUNDARY.exec(value)?.index ?? -1;
  const encodedIndex = URL_ENCODED_EXPLANATORY_TEXT_BOUNDARY.exec(value)?.index ?? -1;
  if (literalIndex === -1) {
    return encodedIndex;
  }
  if (encodedIndex === -1) {
    return literalIndex;
  }
  return Math.min(literalIndex, encodedIndex);
};

export const normalizeHttpUrlCandidate = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  if (parseUrlSafely(trimmed)) {
    return trimmed.replace(URL_TRAILING_PUNCTUATION, '');
  }

  const schemeMatch = /^https?:\/\//i.exec(trimmed);
  if (!schemeMatch) {
    return trimmed;
  }

  const afterScheme = trimmed.slice(schemeMatch[0].length);
  const boundaryIndex = findUrlBoundaryIndex(afterScheme);
  if (boundaryIndex <= 0) {
    return trimmed.replace(URL_TRAILING_PUNCTUATION, '');
  }

  const candidate = `${schemeMatch[0]}${afterScheme.slice(0, boundaryIndex)}`.replace(URL_TRAILING_PUNCTUATION, '');
  return parseUrlSafely(candidate) ? candidate : trimmed.replace(URL_TRAILING_PUNCTUATION, '');
};

export const isExternalHttpUrl = (url: string): boolean => {
  const parsed = parseUrlSafely(normalizeHttpUrlCandidate(url));
  if (!parsed) {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
};

export const getUrlScheme = (url: string): string | null => {
  const parsed = parseUrlSafely(url.trim());
  return parsed ? parsed.protocol.replace(/:$/, '').toLowerCase() : null;
};

const BROWSER_HANDLED_SCHEMES = new Set([
  'http', 'https', 'mailto', 'tel', 'sms', 'callto', 'cid', 'xmpp', 'irc', 'news', 'nntp', 'feed', 'webcal',
]);
const BLOCKED_APP_LINK_SCHEMES = new Set([
  'javascript', 'data', 'vbscript', 'blob', 'filesystem', 'about',
  'chrome', 'chrome-extension', 'devtools', 'moz-extension', 'ms-browser-extension',
  'file', 'ws', 'wss', 'ftp', 'ftps', 'intent', 'ms-msdt', 'search-ms', 'shell',
  'openchamber', 'openchamber-ui', 'capacitor',
]);
const APP_LINK_SCHEME_RE = /^[a-z][a-z0-9+.-]{1,31}$/;

export const isAppLinkUrl = (url: string): boolean => {
  const scheme = getUrlScheme(url);
  return Boolean(
    scheme
    && APP_LINK_SCHEME_RE.test(scheme)
    && !BROWSER_HANDLED_SCHEMES.has(scheme)
    && !BLOCKED_APP_LINK_SCHEMES.has(scheme)
  );
};

export const getExternalFaviconUrl = (url: string): string | null => {
  const parsed = parseUrlSafely(normalizeHttpUrlCandidate(url));
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return null;
  }

  return `https://icons.duckduckgo.com/ip3/${parsed.hostname.toLowerCase()}.ico`;
};

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * Returns true when the URL is an http(s) URL pointing at a loopback host
 * (localhost, 127.0.0.1, 0.0.0.0, ::1). Used to decide whether to offer an in-app
 * preview pane instead of opening the system browser.
 */
export const isLoopbackHttpUrl = (url: string): boolean => {
  const parsed = parseUrlSafely(normalizeHttpUrlCandidate(url));
  if (!parsed) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
};

const LOOPBACK_URL_PATTERN
  // eslint-disable-next-line no-control-regex
  = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s<>"'`\u0000-\u001f]*)?/gi;

/**
 * Extracts loopback http(s) URLs from a free-text string. Returns unique URLs
 * in order of first appearance. Trailing punctuation that is unlikely to be
 * part of a real URL is stripped.
 */
export const extractLoopbackUrls = (text: string): string[] => {
  if (!text) {
    return [];
  }
  const matches = text.match(LOOPBACK_URL_PATTERN);
  if (!matches || matches.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const cleaned = normalizeHttpUrlCandidate(raw);
    if (!cleaned || !isLoopbackHttpUrl(cleaned)) {
      continue;
    }
    if (seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
};

/**
 * Opens an external URL in the system browser.
 * In desktop runtime, uses preload IPC for proper handling.
 * Falls back to window.open() for web runtime.
 *
 * @param url - The URL to open
 * @returns Promise<boolean> - true if the URL was opened successfully
 */
const openValidatedExternalUrl = async (url: string): Promise<boolean> => {
  if (typeof window === 'undefined') {
    return false;
  }

  const target = url.trim();
  if (!target) {
    return false;
  }

  const parsed = parseUrlSafely(target);
  if (!parsed) {
    return false;
  }

  const normalizedTarget = parsed.toString();

  const runtimeApis = getRegisteredRuntimeAPIs();
  if (runtimeApis?.runtime?.isVSCode && runtimeApis.vscode?.openExternalUrl) {
    try {
      await runtimeApis.vscode.openExternalUrl(normalizedTarget);
      return true;
    } catch {
      return false;
    }
  }

  const desktop = (window as unknown as { __OPENCHAMBER_DESKTOP__?: DesktopShell }).__OPENCHAMBER_DESKTOP__;
  if (desktop?.shell?.open) {
    try {
      await desktop.shell.open(normalizedTarget);
      return true;
    } catch {
      // Fall through to window.open
    }
  }

  try {
    window.open(normalizedTarget, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
};

export const openExternalUrl = (url: string): Promise<boolean> => (
  isExternalHttpUrl(url) ? openValidatedExternalUrl(url) : Promise.resolve(false)
);

export const openConfirmedAppLinkUrl = (url: string): Promise<boolean> => (
  isAppLinkUrl(url) ? openValidatedExternalUrl(url) : Promise.resolve(false)
);

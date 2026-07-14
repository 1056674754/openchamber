const PREVIEW_MESSAGE_SOURCE = 'openchamber-html-file-preview';
const PREVIEW_MESSAGE_VERSION = 1;
const MAX_PREVIEW_HREF_LENGTH = 4096;

type HtmlFilePreviewNavigation =
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'ignore' };

const PREVIEW_NAVIGATION_BRIDGE = String.raw`<script data-openchamber-html-file-preview>(() => {
  const SOURCE = 'openchamber-html-file-preview';
  const VERSION = 1;
  const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const href = (anchor.getAttribute('href') || '').trim();
    if (!href) {
      event.preventDefault();
      return;
    }

    if (href.startsWith('#')) {
      event.preventDefault();
      const rawFragment = href.slice(1);
      if (!rawFragment) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }

      let fragment = rawFragment;
      try {
        fragment = decodeURIComponent(rawFragment);
      } catch (error) {
        if (!(error instanceof URIError)) throw error;
      }

      const destination = document.getElementById(fragment) || document.getElementsByName(fragment)[0];
      destination?.scrollIntoView({ block: 'start' });
      return;
    }

    const scheme = SCHEME.exec(href)?.[0]?.toLowerCase();
    if (scheme && scheme !== 'http:' && scheme !== 'https:' && scheme !== 'file:') return;

    event.preventDefault();
    window.parent.postMessage({
      source: SOURCE,
      version: VERSION,
      type: 'navigate',
      href,
    }, '*');
  }, true);
})();</script>`;

const parseAbsoluteUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
};

const decodePreviewPath = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      return value;
    }
    throw error;
  }
};

const normalizeFilePath = (value: string): string => {
  const normalizedSeparators = value.replace(/\\/g, '/');
  const windowsDrive = /^[A-Za-z]:\//.exec(normalizedSeparators)?.[0] ?? '';
  const hasUncRoot = normalizedSeparators.startsWith('//');
  const hasUnixRoot = !windowsDrive && !hasUncRoot && normalizedSeparators.startsWith('/');
  const prefix = windowsDrive || (hasUncRoot ? '//' : (hasUnixRoot ? '/' : ''));
  const body = windowsDrive
    ? normalizedSeparators.slice(windowsDrive.length)
    : normalizedSeparators.slice(prefix.length);
  const segments: string[] = [];

  for (const segment of body.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `${prefix}${segments.join('/')}`;
};

const resolveFileUrlPath = (url: URL): string => {
  const decoded = decodePreviewPath(url.pathname);
  if (/^\/[A-Za-z]:\//.test(decoded)) {
    return normalizeFilePath(decoded.slice(1));
  }
  return normalizeFilePath(decoded);
};

export const resolveHtmlFilePreviewNavigation = (
  rawHref: string,
  sourceFilePath: string,
): HtmlFilePreviewNavigation => {
  const href = rawHref.trim();
  if (!href || href.startsWith('#') || href.startsWith('?')) {
    return { kind: 'ignore' };
  }

  if (href.startsWith('//')) {
    return { kind: 'external', url: `https:${href}` };
  }

  const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(href);
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(href)?.[0]?.toLowerCase();
  if (scheme && !isWindowsAbsolutePath) {
    const parsed = parseAbsoluteUrl(href);
    if (!parsed) {
      return { kind: 'ignore' };
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { kind: 'external', url: parsed.toString() };
    }
    if (parsed.protocol === 'file:') {
      return { kind: 'file', path: resolveFileUrlPath(parsed) };
    }
    return { kind: 'ignore' };
  }

  const hrefPath = decodePreviewPath(href.split(/[?#]/, 1)[0] ?? '');
  if (!hrefPath) {
    return { kind: 'ignore' };
  }

  if (hrefPath.startsWith('/') || isWindowsAbsolutePath) {
    return { kind: 'file', path: normalizeFilePath(hrefPath) };
  }

  const normalizedSourcePath = sourceFilePath.replace(/\\/g, '/');
  const sourceDirectory = normalizedSourcePath.slice(0, normalizedSourcePath.lastIndexOf('/') + 1);
  return {
    kind: 'file',
    path: normalizeFilePath(`${sourceDirectory}${hrefPath}`),
  };
};

export const isHtmlFilePreviewNavigationMessage = (value: unknown): value is {
  readonly source: typeof PREVIEW_MESSAGE_SOURCE;
  readonly version: typeof PREVIEW_MESSAGE_VERSION;
  readonly type: 'navigate';
  readonly href: string;
} => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('source' in value) || value.source !== PREVIEW_MESSAGE_SOURCE) return false;
  if (!('version' in value) || value.version !== PREVIEW_MESSAGE_VERSION) return false;
  if (!('type' in value) || value.type !== 'navigate') return false;
  return 'href' in value
    && typeof value.href === 'string'
    && value.href.length <= MAX_PREVIEW_HREF_LENGTH;
};

export const buildHtmlFilePreviewDocument = (html: string): string => {
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${PREVIEW_NAVIGATION_BRIDGE}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (root) => `${root}<head>${PREVIEW_NAVIGATION_BRIDGE}</head>`);
  }
  return `${PREVIEW_NAVIGATION_BRIDGE}${html}`;
};

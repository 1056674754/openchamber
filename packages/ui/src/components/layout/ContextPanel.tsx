import React from 'react';

import { FileTypeIcon } from '@/components/icons/FileTypeIcon';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SortableTabsStrip } from '@/components/ui/sortable-tabs-strip';
import { DiffView } from '@/components/views/DiffView';
import { WalkthroughView } from '@/components/views/walkthrough/WalkthroughView';
import { FilesView } from '@/components/views/FilesView';
import { GitView } from '@/components/views/GitView';
import { PullRequestView } from '@/components/views/PullRequestView';
import { PlanView } from '@/components/views/PlanView';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { lazyWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import { openExternalUrl } from '@/lib/url';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useActiveServerId } from '@/hooks/useActiveServerId';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { resolvePreviewHeaderDisplayUrl } from '@/lib/previewDisplayUrl';
import { useFilesViewTabsStore } from '@/stores/useFilesViewTabsStore';
import { useUIStore, type ContextPanelMode } from '@/stores/useUIStore';
import { useInlineCommentDraftStore } from '@/stores/useInlineCommentDraftStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useInputStore } from '@/sync/input-store';
import { markSessionViewed } from '@/sync/notification-store';
import { setExternallyViewedSession } from '@/sync/sync-context';
import { ContextPanelContent } from './ContextSidebarTab';
import { toast } from '@/components/ui';
import { Icon } from "@/components/icon/Icon";
import { OpenChamberLogo } from "@/components/ui/OpenChamberLogo";
import { invokeDesktopCommand } from '@/lib/desktopNative';
import { registerBrowserController, registerBrowserOpener } from '@/lib/browser/controlClient';
import {
  buildClickScript,
  buildInspectScript,
  buildScrollScript,
  buildSnapshotScript,
  buildTypeScript,
} from '@/lib/browser/pageActions';
import {
  FILL_VIEWPORT,
  fitViewport,
  isViewportMode,
  viewportForMode,
  viewportSummary,
  type BrowserViewport,
} from '@/lib/browser/viewport';
import { UNRESOLVED_SERVER_ID } from '@/sync/session-authority';
import { buildEmbeddedSessionChatURL, getActiveEmbeddedSessionChatTab } from './contextPanelEmbeddedChat';
import { ProjectContextPanel } from './RightSidebarTabs';
import { getContextSurfaceWidthFraction } from '@/lib/surfaces/registry';

const TerminalView = lazyWithChunkRecovery(() => import('@/components/views/TerminalView').then(m => ({ default: m.TerminalView })));

const CONTEXT_PANEL_MIN_WIDTH = 380;
const CONTEXT_PANEL_MAX_WIDTH = 1400;
const CONTEXT_PANEL_DEFAULT_WIDTH = 600;
const CONTEXT_TAB_LABEL_MAX_CHARS = 24;
const CONTEXT_PANEL_SPLIT_HANDLE_HEIGHT = 3;
type TranslateFn = ReturnType<typeof useI18n>['t'];
type ContextPanelTabMode = 'diff' | 'file' | 'context' | 'plan' | 'chat' | 'preview' | 'terminal' | 'browser' | 'git' | 'pr' | 'notes' | 'walkthrough';
type ContextPanelTabLike = { id: string; mode: ContextPanelTabMode; targetPath: string | null; dedupeKey: string; label: string | null; readOnly: boolean };
type SplitDropZone = 'top' | 'bottom' | 'middle';

const CONTEXT_PANEL_TAB_MODES = new Set<ContextPanelTabMode>([
  'diff',
  'file',
  'context',
  'plan',
  'chat',
  'preview',
  'terminal',
  'browser',
  'git',
  'pr',
  'notes',
]);

type PreviewConsoleEvent = {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'resource' | 'runtime';
  message: string;
  details?: string;
  ts: number;
};

type PreviewConsoleFilter = 'all' | 'errors' | 'warnings' | 'logs';

type PreviewBridgeMessage = {
  source?: string;
  version?: number;
  type?: string;
  level?: PreviewConsoleEvent['level'];
  args?: unknown[];
  message?: unknown;
  stack?: unknown;
  filename?: unknown;
  line?: unknown;
  column?: unknown;
  tag?: unknown;
  url?: unknown;
  outerHTML?: unknown;
  title?: unknown;
  ts?: unknown;
  target?: unknown;
  navigation?: unknown;
};

type PreviewElementMetadata = {
  frame: 'top';
  tag: string;
  text: string;
  selector: string;
  path: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  attributes: Record<string, string>;
  computedStyle: Record<string, string>;
  ancestry: Array<{ tag: string; id?: string; className?: string; selectorPart: string }>;
};

const PREVIEW_CONSOLE_EVENT_LIMIT = 200;

const getPreviewConsoleFilterMatch = (event: PreviewConsoleEvent, filter: PreviewConsoleFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'errors') return event.level === 'error' || event.level === 'runtime' || event.level === 'resource';
  if (filter === 'warnings') return event.level === 'warn';
  return event.level === 'log' || event.level === 'info' || event.level === 'debug';
};

const isPreviewElementMetadata = (value: unknown): value is PreviewElementMetadata => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PreviewElementMetadata>;
  const bounds = record.bounds;
  return typeof record.tag === 'string'
    && typeof record.selector === 'string'
    && typeof record.path === 'string'
    && Boolean(bounds)
    && typeof bounds?.x === 'number'
    && typeof bounds?.y === 'number'
    && typeof bounds?.width === 'number'
    && typeof bounds?.height === 'number';
};

const formatPreviewAnnotationMarkdown = ({
  pageUrl,
  viewport,
  devicePixelRatio,
  target,
  screenshotAttached,
  intro,
}: {
  pageUrl: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  target: PreviewElementMetadata;
  screenshotAttached: boolean;
  intro: string;
}): string => {
  const text = target.text.trim();
  const attributes = Object.entries(target.attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
  const styles = target.computedStyle;
  const bounds = target.bounds;
  const center = target.center;
  const introLabel = intro.replace(/[.:]+$/g, '');
  const ancestry = target.ancestry
    .map((entry) => entry.selectorPart)
    .join(' > ');

  return [
    `${introLabel}:`,
    `Page: ${pageUrl || 'preview'}`,
    `Viewport: ${viewport.width}x${viewport.height}, DPR ${devicePixelRatio}`,
    `Screenshot: ${screenshotAttached ? 'attached' : 'not attached'}`,
    `Element: ${target.tag}`,
    text ? `Text: ${text}` : null,
    `- Selector: ${target.selector}`,
    `- Path: ${target.path}`,
    ancestry ? `- Ancestry: ${ancestry}` : null,
    attributes ? `- Attributes: ${attributes}` : null,
    `- Bounds: x=${Math.round(bounds.x)}, y=${Math.round(bounds.y)}, width=${Math.round(bounds.width)}, height=${Math.round(bounds.height)}`,
    `- Center: x=${Math.round(center.x)}, y=${Math.round(center.y)}`,
    `Styles: display=${styles.display}; position=${styles.position}; font=${styles.fontWeight} ${styles.fontSize} / ${styles.lineHeight} ${styles.fontFamily}; color=${styles.color}; background=${styles.backgroundColor}; z-index=${styles.zIndex}`,
  ].filter((line): line is string => typeof line === 'string').join('\n');
};

const renderPreviewScreenshot = async (
  iframe: HTMLIFrameElement,
  target: PreviewElementMetadata,
): Promise<File | null> => {
  try {
    const rect = iframe.getBoundingClientRect();
    const capture = await invokeDesktopCommand<{ mime: string; base64: string; width: number; height: number }>('desktop_capture_page_rect', {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to load desktop preview screenshot'));
      image.src = `data:${capture.mime};base64,${capture.base64}`;
    });

    const width = Math.max(1, image.naturalWidth || capture.width || Math.floor(rect.width));
    const height = Math.max(1, image.naturalHeight || capture.height || Math.floor(rect.height));
    const maxOutputWidth = 1200;
    const outputScale = Math.min(1, maxOutputWidth / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(width * outputScale);
    canvas.height = Math.floor(height * outputScale);
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.scale(outputScale, outputScale);
    context.drawImage(image, 0, 0, width, height);
    const xScale = width / Math.max(1, rect.width);
    const yScale = height / Math.max(1, rect.height);
    context.fillStyle = 'rgba(37, 99, 235, 0.28)';
    context.strokeStyle = 'rgb(37, 99, 235)';
    context.lineWidth = Math.max(2, 2 * xScale);
    context.fillRect(target.bounds.x * xScale, target.bounds.y * yScale, target.bounds.width * xScale, target.bounds.height * yScale);
    context.strokeRect(target.bounds.x * xScale, target.bounds.y * yScale, target.bounds.width * xScale, target.bounds.height * yScale);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) return null;
    return new File([blob], `preview-annotation-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } catch (error) {
    console.warn('[preview] failed to capture annotation screenshot:', error);
    return null;
  }
};

const normalizeDirectoryKey = (value: string): string => {
  if (!value) return '';

  const raw = value.replace(/\\/g, '/');
  const hadUncPrefix = raw.startsWith('//');
  let normalized = raw.replace(/\/+$/g, '');
  normalized = normalized.replace(/\/+/g, '/');

  if (hadUncPrefix && !normalized.startsWith('//')) {
    normalized = `/${normalized}`;
  }

  if (normalized === '') {
    return raw.startsWith('/') ? '/' : '';
  }

  return normalized;
};

const clampWidth = (width: number): number => {
  if (!Number.isFinite(width)) {
    return CONTEXT_PANEL_DEFAULT_WIDTH;
  }

  return Math.min(CONTEXT_PANEL_MAX_WIDTH, Math.max(CONTEXT_PANEL_MIN_WIDTH, Math.round(width)));
};

const getAvailablePanelWidth = (panel: HTMLElement | null): number | null => {
  const parentWidth = panel?.parentElement?.clientWidth;
  if (!parentWidth || parentWidth <= 0) {
    return null;
  }

  const rail = panel?.parentElement?.querySelector<HTMLElement>('[data-context-panel-rail="true"]');
  return Math.max(1, parentWidth - (rail?.offsetWidth ?? 0));
};

const clampWidthToAvailableSpace = (width: number, panel: HTMLElement | null): number => {
  const clampedWidth = clampWidth(width);
  const availableWidth = getAvailablePanelWidth(panel);
  if (availableWidth === null) {
    return clampedWidth;
  }

  return Math.min(clampedWidth, Math.max(1, availableWidth));
};

const getRelativePathLabel = (filePath: string | null, directory: string): string => {
  if (!filePath) {
    return '';
  }
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedDir = directory.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedDir && normalizedFile.startsWith(normalizedDir + '/')) {
    return normalizedFile.slice(normalizedDir.length + 1);
  }
  return normalizedFile;
};

const getModeLabel = (
  mode: ContextPanelMode,
  t: TranslateFn
): string => {
  if (mode === 'chat') return t('contextPanel.mode.chat');
  if (mode === 'file') return t('contextPanel.mode.files');
  if (mode === 'diff') return t('contextPanel.mode.diff');
  if (mode === 'plan') return t('contextPanel.mode.plan');
  if (mode === 'preview') return t('contextPanel.mode.preview');
  if (mode === 'terminal') return t('contextPanel.mode.terminal');
  if (mode === 'browser') return t('contextPanel.mode.browser');
  if (mode === 'git') return t('layout.rightSidebar.git');
  if (mode === 'pr') return t('contextPanel.mode.pr');
  if (mode === 'notes') return t('contextRail.surface.notes');
  return t('contextPanel.mode.context');
};

const getFileNameFromPath = (path: string | null): string | null => {
  if (!path) {
    return null;
  }

  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return null;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return normalized;
  }

  return segments[segments.length - 1] || null;
};

const getTabLabel = (
  tab: { mode: ContextPanelMode; label: string | null; targetPath: string | null },
  t: TranslateFn
): string => {
  if (tab.label) {
    return tab.label;
  }

  if (tab.mode === 'file') {
    return getFileNameFromPath(tab.targetPath) || t('contextPanel.mode.files');
  }

  if (tab.mode === 'preview') {
    const url = tab.targetPath;
    if (url) {
      try {
        const parsed = new URL(url);
        return parsed.host || parsed.hostname || t('contextPanel.mode.preview');
      } catch {
        // ignore invalid URL
      }
    }
    return t('contextPanel.mode.preview');
  }

  return getModeLabel(tab.mode, t);
};

const getTabIcon = (tab: { mode: ContextPanelMode; targetPath: string | null }): React.ReactNode | undefined => {
  if (tab.mode === 'file') {
    return tab.targetPath
      ? <FileTypeIcon filePath={tab.targetPath} className="h-3.5 w-3.5" />
      : undefined;
  }

  if (tab.mode === 'diff') {
    return <Icon name="arrow-left-right" className="h-3.5 w-3.5" />;
  }

  if (tab.mode === 'git') {
    return <Icon name="git-branch" className="h-3.5 w-3.5" />;
  }

  if (tab.mode === 'pr') {
    return <Icon name="git-pull-request" className="h-3.5 w-3.5" />;
  }

  if (tab.mode === 'notes') {
    return <Icon name="sticky-note" className="h-3.5 w-3.5" />;
  }

  if (tab.mode === 'plan') {
    return <Icon name="file-text" className="h-3.5 w-3.5" />;
  }

  if (tab.mode === 'context') {
    return <Icon name="donut-chart-fill" className="h-3.5 w-3.5" />;
  }

  if (tab.mode === 'chat') {
    return <Icon name="chat-4" className="h-3.5 w-3.5" />;
  }

  if (tab.mode === 'preview') {
    return <Icon name="global" className="h-3.5 w-3.5 text-[var(--status-info)]" />;
  }

  if (tab.mode === 'terminal') {
    return <Icon name="terminal-box" className="h-3.5 w-3.5"  />;
  }
  if (tab.mode === 'browser') {
    return <Icon name="global" className="h-3.5 w-3.5" />;
  }

  return undefined;
};

const coerceContextPanelTabForRender = (value: unknown): ContextPanelTabLike | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const tab = value as {
    id?: unknown;
    mode?: unknown;
    targetPath?: unknown;
    dedupeKey?: unknown;
    label?: unknown;
    readOnly?: unknown;
  };
  const id = typeof tab.id === 'string' ? tab.id.trim() : '';
  const mode = tab.mode;
  if (!id || !CONTEXT_PANEL_TAB_MODES.has(mode as ContextPanelTabMode)) {
    return null;
  }

  return {
    id,
    mode: mode as ContextPanelTabMode,
    targetPath: typeof tab.targetPath === 'string' && tab.targetPath.trim().length > 0
      ? tab.targetPath
      : null,
    dedupeKey: typeof tab.dedupeKey === 'string' && tab.dedupeKey.trim().length > 0
      ? tab.dedupeKey
      : id,
    label: typeof tab.label === 'string' && tab.label.trim().length > 0
      ? tab.label
      : null,
    readOnly: tab.readOnly === true,
  };
};

const normalizeContextPanelTabsForRender = (value: unknown): ContextPanelTabLike[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: ContextPanelTabLike[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const tab = coerceContextPanelTabForRender(entry);
    if (!tab || seen.has(tab.id)) {
      continue;
    }
    seen.add(tab.id);
    result.push(tab);
  }
  return result;
};

const getSessionIDFromDedupeKey = (dedupeKey: string | undefined): string | null => {
  if (!dedupeKey || !dedupeKey.startsWith('session:')) {
    return null;
  }

  const sessionID = dedupeKey.slice('session:'.length).trim();
  return sessionID || null;
};

const DESKTOP_BROWSER_INSPECT_SCRIPT = `new Promise((resolve) => {
  const existing = document.getElementById('__openchamber_desktop_browser_overlay');
  if (existing) existing.remove();
  if (typeof window.__openchamberDesktopBrowserCancelInspect === 'function') {
    try { window.__openchamberDesktopBrowserCancelInspect(); } catch { /* webview not ready */ }
  }
  const overlay = document.createElement('div');
  overlay.id = '__openchamber_desktop_browser_overlay';
  overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #60a5fa;background:rgba(96,165,250,.24);border-radius:3px;display:none;box-sizing:border-box;';
  document.documentElement.appendChild(overlay);
  const cssEscape = (value) => {
    try { return CSS.escape(value); } catch { return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'); }
  };
  const selectorPart = (element) => {
    const tag = element.tagName.toLowerCase();
    if (element.id) return tag + '#' + cssEscape(element.id);
    const className = String(element.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 3).map((part) => '.' + cssEscape(part)).join('');
    return tag + className;
  };
  const metadata = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const ancestry = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && ancestry.length < 8) {
      ancestry.unshift({ tag: current.tagName.toLowerCase(), id: current.id || undefined, className: typeof current.className === 'string' ? current.className : undefined, selectorPart: selectorPart(current) });
      current = current.parentElement;
    }
    const attrs = {};
    for (const attr of Array.from(element.attributes || []).slice(0, 16)) attrs[attr.name] = attr.value.slice(0, 300);
    const path = ancestry.map((entry) => entry.selectorPart).join(' > ');
    return {
      frame: 'top',
      tag: element.tagName.toLowerCase(),
      text: String(element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
      selector: element.id ? '#' + cssEscape(element.id) : path,
      path,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      attributes: attrs,
      computedStyle: { display: style.display, position: style.position, fontWeight: style.fontWeight, fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily, color: style.color, backgroundColor: style.backgroundColor, zIndex: style.zIndex },
      ancestry,
    };
  };
  const move = (event) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || element === overlay || element === document.documentElement || element === document.body) return;
    const rect = element.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  };
  const cleanup = () => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('click', click, true);
    window.removeEventListener('keydown', keydown, true);
    if (window.__openchamberDesktopBrowserCancelInspect === cancel) {
      delete window.__openchamberDesktopBrowserCancelInspect;
    }
  };
  const cancel = () => {
    cleanup();
    overlay.remove();
    resolve(null);
  };
  const click = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const result = element ? metadata(element) : null;
    cleanup();
    overlay.remove();
    resolve(result);
  };
  const keydown = (event) => {
    if (event.key !== 'Escape') return;
    cancel();
  };
  window.__openchamberDesktopBrowserCancelInspect = cancel;
  window.addEventListener('mousemove', move, true);
  window.addEventListener('click', click, true);
  window.addEventListener('keydown', keydown, true);
});`;

const DESKTOP_BROWSER_CANCEL_INSPECT_SCRIPT = `(() => {
  if (typeof window.__openchamberDesktopBrowserCancelInspect === 'function') {
    window.__openchamberDesktopBrowserCancelInspect();
    return;
  }
  const overlay = document.getElementById('__openchamber_desktop_browser_overlay');
  if (overlay) overlay.remove();
})()`;

const normalizeBrowserUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return 'about:blank';
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'about:blank';
    return parsed.toString();
  } catch {
    return 'about:blank';
  }
};

const desktopAnnotationToFile = async (
  base64: string,
  screenshotWidth: number,
  screenshotHeight: number,
  cssWidth: number,
  cssHeight: number,
  target: PreviewElementMetadata,
): Promise<File | null> => {
  if (!base64) return null;
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to load desktop browser screenshot'));
      image.src = `data:image/jpeg;base64,${base64}`;
    });

    const width = Math.max(1, image.naturalWidth || screenshotWidth);
    const height = Math.max(1, image.naturalHeight || screenshotHeight);
    const maxOutputWidth = 1200;
    const outputScale = Math.min(1, maxOutputWidth / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(width * outputScale);
    canvas.height = Math.floor(height * outputScale);
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.scale(outputScale, outputScale);
    context.drawImage(image, 0, 0, width, height);
    const xScale = width / Math.max(1, cssWidth || width);
    const yScale = height / Math.max(1, cssHeight || height);
    context.fillStyle = 'rgba(37, 99, 235, 0.14)';
    context.strokeStyle = 'rgb(37, 99, 235)';
    context.lineWidth = Math.max(2, 2 * xScale);
    context.fillRect(target.bounds.x * xScale, target.bounds.y * yScale, target.bounds.width * xScale, target.bounds.height * yScale);
    context.strokeRect(target.bounds.x * xScale, target.bounds.y * yScale, target.bounds.width * xScale, target.bounds.height * yScale);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) return null;
    return new File([blob], `browser-annotation-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } catch {
    return null;
  }
};

const truncateTabLabel = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3)}...`;
};

type PreviewPaneProps = {
  rawUrl: string;
  onNavigate: (url: string) => void;
};

type PreviewProxyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; proxyBasePath: string; expiresAt: number }
  | { status: 'error'; message: string };

// Module-scoped, in-memory cache of registered proxy targets keyed by the
// fully-qualified upstream URL. Survives PreviewPane unmount/remount and tab
// switches, but intentionally does NOT survive a full page reload: the server
// holds the target map in memory and the auth cookie is HttpOnly + scoped to
// the proxy id, so a stale persisted entry would 404 after a server restart.
// Entries are evicted on registration error (refetched) or when the upstream
// returns 403 (cookie expired) / 404 (target unknown) at iframe load time.
type CachedProxyTarget = { proxyBasePath: string; expiresAt: number };
const previewProxyTargetCache = new Map<string, CachedProxyTarget>();
const PREVIEW_PROXY_CACHE_SAFETY_MS = 30_000;

const getCachedProxyTarget = (url: string): CachedProxyTarget | null => {
  const entry = previewProxyTargetCache.get(url);
  if (!entry) return null;
  if (entry.expiresAt - Date.now() <= PREVIEW_PROXY_CACHE_SAFETY_MS) {
    previewProxyTargetCache.delete(url);
    return null;
  }
  return entry;
};

const PreviewPane: React.FC<PreviewPaneProps> = ({ rawUrl, onNavigate }) => {
  const { t } = useI18n();
  const { currentTheme } = useThemeSystem();
  const [reloadNonce, bumpReload] = React.useReducer((x: number) => x + 1, 0);
  const [proxyRegistrationNonce, bumpProxyRegistration] = React.useReducer((x: number) => x + 1, 0);
  const [proxyState, setProxyState] = React.useState<PreviewProxyState>({ status: 'idle' });
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const nextConsoleEventIdRef = React.useRef(1);
  const [bridgeReady, setBridgeReady] = React.useState(false);
  const [consoleOpen, setConsoleOpen] = React.useState(false);
  const [consoleFilter, setConsoleFilter] = React.useState<PreviewConsoleFilter>('all');
  const [consoleEvents, setConsoleEvents] = React.useState<PreviewConsoleEvent[]>([]);
  const [inspectMode, setInspectMode] = React.useState(false);
  const [hoverTarget, setHoverTarget] = React.useState<PreviewElementMetadata | null>(null);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const newSessionDraftOpen = useSessionUIStore((state) => state.newSessionDraft?.open);
  const addInlineCommentDraft = useInlineCommentDraftStore((state) => state.addDraft);
  const addAttachedFile = useInputStore((state) => state.addAttachedFile);

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = rawUrl ? new URL(rawUrl) : null;
  } catch {
    parsedUrl = null;
  }

  const isLoopback = parsedUrl
    ? (parsedUrl.hostname === 'localhost'
        || parsedUrl.hostname === '127.0.0.1'
        || parsedUrl.hostname === '::1'
        || parsedUrl.hostname === '[::1]'
        || parsedUrl.hostname === '0.0.0.0')
    : false;

  const normalizedUrl = parsedUrl
    ? (parsedUrl.hostname === '0.0.0.0'
        ? new URL(parsedUrl.toString().replace('0.0.0.0', '127.0.0.1'))
        : parsedUrl)
    : null;

  const targetKey = normalizedUrl ? normalizedUrl.toString() : '';
  const previewColorScheme = currentTheme.metadata.variant;

  React.useEffect(() => {
    if (!targetKey || !isLoopback) {
      setProxyState({ status: 'idle' });
      return;
    }

    const cached = getCachedProxyTarget(targetKey);
    if (cached) {
      setProxyState({ status: 'ready', proxyBasePath: cached.proxyBasePath, expiresAt: cached.expiresAt });
      return;
    }

    let cancelled = false;
    setProxyState({ status: 'loading' });

    void (async () => {
      try {
        const response = await fetch('/api/preview/targets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ url: targetKey }),
        });

        if (!response.ok) {
          previewProxyTargetCache.delete(targetKey);
          const errorBody = await response.json().catch(() => ({}));
          const message = typeof errorBody?.error === 'string'
            ? errorBody.error
            : `HTTP ${response.status}`;
          if (!cancelled) {
            setProxyState({ status: 'error', message });
          }
          return;
        }

        const body = await response.json() as { proxyBasePath?: unknown; expiresAt?: unknown };
        const proxyBasePath = typeof body.proxyBasePath === 'string' ? body.proxyBasePath : '';
        const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : 0;
        if (!proxyBasePath) {
          previewProxyTargetCache.delete(targetKey);
          if (!cancelled) {
            setProxyState({ status: 'error', message: t('contextPanel.preview.proxyError') });
          }
          return;
        }

        previewProxyTargetCache.set(targetKey, { proxyBasePath, expiresAt });
        if (!cancelled) {
          setProxyState({ status: 'ready', proxyBasePath, expiresAt });
        }
      } catch (error) {
        previewProxyTargetCache.delete(targetKey);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setProxyState({ status: 'error', message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoopback, proxyRegistrationNonce, t, targetKey]);

  const directSrc = normalizedUrl
    && (normalizedUrl.protocol === 'http:' || normalizedUrl.protocol === 'https:')
    ? normalizedUrl.toString()
    : '';

  const proxySrc = isLoopback && proxyState.status === 'ready' && normalizedUrl
    ? (() => {
      const path = normalizedUrl.pathname || '/';
      const searchParams = new URLSearchParams(normalizedUrl.search);
      searchParams.set('ocPreview', String(reloadNonce));
      const search = searchParams.toString();
      const hash = normalizedUrl.hash || '';
      return `${proxyState.proxyBasePath}${path}${search ? `?${search}` : ''}${hash}`;
    })()
    : '';

  const effectiveSrc = isLoopback ? proxySrc : directSrc;
  const headerSrc = resolvePreviewHeaderDisplayUrl({ rawUrl, directSrc, effectiveSrc });
  const showLoading = isLoopback && (proxyState.status === 'loading' || proxyState.status === 'idle');
  const showError = isLoopback && proxyState.status === 'error';

  const attachPreviewAnnotation = React.useCallback((target: PreviewElementMetadata) => {
    const sessionKey = currentSessionId ?? (newSessionDraftOpen ? 'draft' : null);
    if (!sessionKey) {
      toast.error(t('contextPanel.preview.inspect.attachNoSession'));
      return;
    }

    const pageUrl = rawUrl || effectiveSrc || '';
    const viewport = typeof window !== 'undefined'
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 0, height: 0 };
    const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

    void (async () => {
      let attachedScreenshot = false;
      try {
        const iframe = iframeRef.current;
        const screenshot = iframe ? await renderPreviewScreenshot(iframe, target) : null;
        if (screenshot) {
          await addAttachedFile(screenshot);
          attachedScreenshot = true;
        }
      } catch {
        attachedScreenshot = false;
      }

      addInlineCommentDraft({
        sessionKey,
        source: 'preview-annotation',
        fileLabel: pageUrl || 'preview',
        startLine: 1,
        endLine: 1,
        code: formatPreviewAnnotationMarkdown({
          pageUrl,
          viewport,
          devicePixelRatio,
          target,
          screenshotAttached: attachedScreenshot,
          intro: t('contextPanel.preview.inspect.attachAnnotation'),
        }),
        language: 'markdown',
        text: '',
      });
      toast.success(t('contextPanel.preview.inspect.attached'));
    })();
  }, [addAttachedFile, addInlineCommentDraft, currentSessionId, effectiveSrc, newSessionDraftOpen, rawUrl, t]);

  React.useEffect(() => {
    setBridgeReady(false);
    setConsoleEvents([]);
    setConsoleOpen(false);
    setConsoleFilter('all');
    setInspectMode(false);
    setHoverTarget(null);
    nextConsoleEventIdRef.current = 1;
  }, [effectiveSrc]);

  React.useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!bridgeReady || !frameWindow) {
      return;
    }
    frameWindow.postMessage({
      source: 'openchamber-preview-parent',
      version: 1,
      type: 'set-inspect-mode',
      enabled: inspectMode,
    }, window.location.origin);
  }, [bridgeReady, inspectMode]);

  React.useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!bridgeReady || !frameWindow) {
      return;
    }
    frameWindow.postMessage({
      source: 'openchamber-preview-parent',
      version: 1,
      type: 'set-color-scheme',
      scheme: previewColorScheme,
    }, window.location.origin);
  }, [bridgeReady, previewColorScheme]);

  React.useEffect(() => {
    if (!inspectMode || typeof window === 'undefined') return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setInspectMode(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [inspectMode]);

  React.useEffect(() => {
    if (!isLoopback || typeof window === 'undefined') {
      return;
    }

    const stringify = (value: unknown): string => {
      if (typeof value === 'string') return value;
      if (value === null || value === undefined) return '';
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    const pushConsoleEvent = (event: Omit<PreviewConsoleEvent, 'id'>) => {
      const id = nextConsoleEventIdRef.current;
      nextConsoleEventIdRef.current += 1;
      setConsoleEvents((current) => {
        const next = [...current, { ...event, id }];
        return next.length > PREVIEW_CONSOLE_EVENT_LIMIT
          ? next.slice(next.length - PREVIEW_CONSOLE_EVENT_LIMIT)
          : next;
      });
    };

    const handler = (event: MessageEvent<PreviewBridgeMessage>) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      const data = event.data;
      if (!data || data.source !== 'openchamber-preview-bridge' || data.version !== 1) {
        return;
      }

      if (data.type === 'ready') {
        setBridgeReady(true);
        return;
      }

      if (data.type === 'console') {
        const level = data.level === 'error' || data.level === 'warn' || data.level === 'info' || data.level === 'debug'
          ? data.level
          : 'log';
        const args = Array.isArray(data.args) ? data.args.map(stringify).filter(Boolean) : [];
        pushConsoleEvent({
          level,
          message: args.join(' '),
          ts: typeof data.ts === 'number' ? data.ts : Date.now(),
        });
        return;
      }

      if (data.type === 'runtime-error') {
        const filename = stringify(data.filename);
        const line = typeof data.line === 'number' ? data.line : null;
        const column = typeof data.column === 'number' ? data.column : null;
        const location = filename
          ? `${filename}${line !== null ? `:${line}${column !== null ? `:${column}` : ''}` : ''}`
          : '';
        const stack = stringify(data.stack);
        pushConsoleEvent({
          level: 'runtime',
          message: stringify(data.message) || t('contextPanel.preview.console.runtimeError'),
          details: [location, stack].filter(Boolean).join('\n'),
          ts: typeof data.ts === 'number' ? data.ts : Date.now(),
        });
        return;
      }

      if (data.type === 'resource-error') {
        const tag = stringify(data.tag) || 'resource';
        const url = stringify(data.url);
        pushConsoleEvent({
          level: 'resource',
          message: url ? `${tag}: ${url}` : tag,
          details: stringify(data.outerHTML),
          ts: typeof data.ts === 'number' ? data.ts : Date.now(),
        });
        return;
      }

      if (data.type === 'hover') {
        setHoverTarget(isPreviewElementMetadata(data.target) ? data.target : null);
        return;
      }

      if (data.type === 'select' && isPreviewElementMetadata(data.target)) {
        setHoverTarget(data.target);
        setInspectMode(false);
        attachPreviewAnnotation(data.target);
        return;
      }

      if (data.type === 'navigate-preview') {
        const nextUrl = typeof data.url === 'string' ? data.url : '';
        const navigation = data.navigation === 'external' ? 'external' : 'proxy';
        if (nextUrl && navigation === 'external') {
          void openExternalUrl(nextUrl);
          return;
        }
        if (nextUrl) {
          onNavigate(nextUrl);
        }
      }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, [attachPreviewAnnotation, isLoopback, onNavigate, t]);

  const consoleErrorCount = consoleEvents.filter((event) => event.level === 'error' || event.level === 'runtime' || event.level === 'resource').length;
  const filteredConsoleEvents = consoleEvents.filter((event) => getPreviewConsoleFilterMatch(event, consoleFilter));

  const copyConsoleEvents = React.useCallback(() => {
    const header = [
      `Preview URL: ${rawUrl || effectiveSrc || ''}`,
      `Events: ${consoleEvents.length}`,
      '',
    ].join('\n');
    const text = consoleEvents.map((event) => {
      const timestamp = new Date(event.ts).toISOString();
      const details = event.details ? `\n${event.details}` : '';
      return `[${timestamp}] [${event.level}] ${event.message}${details}`;
    }).join('\n');

    void copyTextToClipboard(`${header}${text}`).then((result) => {
      if (result.ok) {
        toast.success(t('contextPanel.preview.console.copied'));
      } else {
        toast.error(t('contextPanel.preview.console.copyFailed'));
      }
    });
  }, [consoleEvents, effectiveSrc, rawUrl, t]);

  const attachConsoleEvents = React.useCallback(() => {
    const sessionKey = currentSessionId ?? (newSessionDraftOpen ? 'draft' : null);
    if (!sessionKey) {
      toast.error(t('contextPanel.preview.console.attachNoSession'));
      return;
    }

    const header = [
      `Preview URL: ${rawUrl || effectiveSrc || ''}`,
      `Events: ${consoleEvents.length}`,
      '',
    ].join('\n');
    const text = consoleEvents.map((event) => {
      const timestamp = new Date(event.ts).toISOString();
      const details = event.details ? `\n${event.details}` : '';
      return `[${timestamp}] [${event.level}] ${event.message}${details}`;
    }).join('\n');

    addInlineCommentDraft({
      sessionKey,
      source: 'preview-console',
      fileLabel: rawUrl || effectiveSrc || 'preview',
      startLine: 1,
      endLine: Math.max(1, consoleEvents.length),
      code: `${header}${text}`,
      language: 'text',
      text: t('contextPanel.preview.console.attachAnnotation'),
    });
    toast.success(t('contextPanel.preview.console.attached'));
  }, [addInlineCommentDraft, consoleEvents, currentSessionId, effectiveSrc, newSessionDraftOpen, rawUrl, t]);

  // Out-of-band upstream probe: iframes don't expose HTTP status to the parent,
  // so when the proxy returns a 502 (upstream dev server is offline) the iframe
  // would just render the raw JSON error body. Probe the proxy URL with a HEAD
  // request and surface a friendly overlay when the upstream is unreachable.
  type UpstreamState = 'unknown' | 'starting' | 'reachable' | 'unreachable';
  const [upstreamState, setUpstreamState] = React.useState<UpstreamState>('unknown');
  const upstreamProbeStartedAtRef = React.useRef<number>(0);
  const upstreamProbeAttemptRef = React.useRef<number>(0);
  const PREVIEW_STARTUP_GRACE_MS = 15_000;

  React.useEffect(() => {
    if (!proxySrc) {
      setUpstreamState('unknown');
      upstreamProbeStartedAtRef.current = 0;
      upstreamProbeAttemptRef.current = 0;
      return;
    }

    let cancelled = false;
    if (!upstreamProbeStartedAtRef.current) {
      upstreamProbeStartedAtRef.current = Date.now();
      upstreamProbeAttemptRef.current = 0;
    }
    setUpstreamState('unknown');

    void (async () => {
      const probe = async (): Promise<Response | null> => {
        try {
          return await fetch(proxySrc, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            redirect: 'manual',
          });
        } catch {
          return null;
        }
      };

      const response = await probe();

      if (cancelled) return;

      if (!response) {
        // Network-level failure (e.g. server itself is down) — treat as unreachable.
        setUpstreamState('unreachable');
        return;
      }

      if (response.status === 403 || response.status === 404) {
        previewProxyTargetCache.delete(targetKey);
        setProxyState({ status: 'loading' });
        bumpProxyRegistration();
        return;
      }

      // The proxy emits 502 when the upstream is unreachable. Anything else
      // (including 4xx from the upstream) means the upstream answered.
      if (response.status !== 502) {
        setUpstreamState('reachable');
        return;
      }

      const startedAt = upstreamProbeStartedAtRef.current || Date.now();
      const elapsed = Date.now() - startedAt;
      if (elapsed < PREVIEW_STARTUP_GRACE_MS) {
        // Dev servers can take a moment to bind. During the grace window,
        // keep retrying and show a softer "starting" state.
        setUpstreamState('starting');
        upstreamProbeAttemptRef.current += 1;
        const attempt = upstreamProbeAttemptRef.current;
        const delay = Math.min(2000, 250 * Math.pow(2, Math.min(4, attempt)));
        setTimeout(() => {
          if (!cancelled) {
            bumpReload();
          }
        }, delay).unref?.();
        return;
      }

      setUpstreamState('unreachable');
    })();

    return () => {
      cancelled = true;
    };
  }, [proxySrc, reloadNonce, targetKey]);

  const showUpstreamStarting = isLoopback
    && proxyState.status === 'ready'
    && (upstreamState === 'unknown' || upstreamState === 'starting');

  const showUpstreamUnreachable = isLoopback
    && proxyState.status === 'ready'
    && upstreamState === 'unreachable';

  const handlePreviewFrameLoad = React.useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
    if (!isLoopback || proxyState.status !== 'ready') {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }

    const frameWindow = event.currentTarget.contentWindow;
    if (!frameWindow) {
      return;
    }

    try {
      const location = frameWindow.location;
      if (location.origin !== window.location.origin) {
        return;
      }
      if (location.pathname.startsWith(proxyState.proxyBasePath)) {
        return;
      }

      const nextPath = `${proxyState.proxyBasePath}${location.pathname}${location.search}${location.hash}`;
      frameWindow.location.replace(nextPath);
    } catch {
      // Cross-origin frames are expected for non-loopback/direct previews.
    }
  }, [isLoopback, proxyState]);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center gap-1 border-b border-border/40 bg-[var(--surface-background)] px-2 py-1">
        <div className="min-w-0 flex-1 truncate typography-micro text-muted-foreground" title={headerSrc || rawUrl}>
          {headerSrc || rawUrl || t('contextPanel.preview.empty')}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => bumpReload()}
          title={t('contextPanel.preview.actions.reload')}
          aria-label={t('contextPanel.preview.actions.reload')}
          disabled={!effectiveSrc}
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => {
            if (!directSrc) return;
            void openExternalUrl(directSrc);
          }}
          title={t('contextPanel.preview.actions.openExternal')}
          aria-label={t('contextPanel.preview.actions.openExternal')}
          disabled={!directSrc}
        >
          <Icon name="external-link" className="h-3.5 w-3.5" />
        </Button>
        {isLoopback ? (
          <Button
            type="button"
            size="sm"
            variant={inspectMode ? 'secondary' : 'ghost'}
            className="h-7 gap-1 px-2"
            onClick={() => setInspectMode((value) => !value)}
            title={t('contextPanel.preview.inspect.toggle')}
            aria-label={t('contextPanel.preview.inspect.toggle')}
            disabled={!bridgeReady}
          >
            <Icon name="cursor" className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {isLoopback ? (
          <Button
            type="button"
            size="sm"
            variant={consoleOpen ? 'secondary' : 'ghost'}
            className="h-7 gap-1 px-2"
            onClick={() => setConsoleOpen((value) => !value)}
            title={bridgeReady ? t('contextPanel.preview.console.open') : t('contextPanel.preview.console.waiting')}
            aria-label={bridgeReady ? t('contextPanel.preview.console.open') : t('contextPanel.preview.console.waiting')}
            disabled={!bridgeReady && consoleEvents.length === 0}
          >
            <Icon name="terminal-box" className="h-3.5 w-3.5" />
            {consoleErrorCount > 0 ? (
              <span className="typography-micro text-status-error">{consoleErrorCount}</span>
            ) : null}
          </Button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 bg-background">
        {showUpstreamStarting ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
            <div>{t('contextPanel.preview.startingServer')}</div>
            <div className="text-xs opacity-70">{t('contextPanel.preview.startingServerHint')}</div>
          </div>
        ) : showUpstreamUnreachable ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
            <div>{t('contextPanel.preview.upstreamUnreachable')}</div>
            <div className="text-xs opacity-70">{t('contextPanel.preview.upstreamUnreachableHint')}</div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => bumpReload()}
            >
              {t('contextPanel.preview.actions.retry')}
            </Button>
          </div>
        ) : effectiveSrc && (!isLoopback || upstreamState === 'reachable') ? (
          <div className="relative h-full w-full">
            <iframe
              ref={iframeRef}
              key={`${effectiveSrc}:${reloadNonce}`}
              src={effectiveSrc}
              title={t('contextPanel.preview.iframeTitle')}
              className="h-full w-full border-0"
              style={{ colorScheme: previewColorScheme }}
              onLoad={handlePreviewFrameLoad}
              sandbox={isLoopback
                ? 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'
                : 'allow-scripts allow-forms'}
            />
            {inspectMode && hoverTarget ? (
              <div
                className="pointer-events-none absolute rounded-sm border-2 border-[var(--interactive-focus-ring)] bg-[var(--interactive-focus-ring)]/35"
                style={{
                  left: hoverTarget.bounds.x,
                  top: hoverTarget.bounds.y,
                  width: hoverTarget.bounds.width,
                  height: hoverTarget.bounds.height,
                }}
              >
                <div className="absolute -top-6 left-0 max-w-64 truncate rounded bg-[var(--surface-elevated)] px-2 py-0.5 typography-micro text-foreground shadow">
                  {hoverTarget.tag}{hoverTarget.text ? ` · ${hoverTarget.text}` : ''}
                </div>
              </div>
            ) : null}
          </div>
        ) : showLoading ? (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
            {t('contextPanel.preview.loading')}
          </div>
        ) : showError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-sm text-muted-foreground">
            <div>{t('contextPanel.preview.proxyError')}</div>
            {proxyState.status === 'error' ? (
              <div className="text-center text-xs opacity-70">{proxyState.message}</div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
            {t('contextPanel.preview.invalidUrl')}
          </div>
        )}
        {consoleOpen ? (
          <div className="absolute inset-x-3 bottom-3 z-10 max-h-[45%] overflow-hidden rounded-xl border border-border/70 bg-[var(--surface-elevated)] shadow-lg">
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
              <div className="typography-ui-label text-foreground">{t('contextPanel.preview.console.title')}</div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={attachConsoleEvents}
                  disabled={consoleEvents.length === 0}
                >
                  {t('contextPanel.preview.console.attach')}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={copyConsoleEvents}
                  disabled={consoleEvents.length === 0}
                >
                  {t('contextPanel.preview.console.copy')}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => setConsoleEvents([])}
                  disabled={consoleEvents.length === 0}
                >
                  {t('contextPanel.preview.console.clear')}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-1 border-b border-border/30 px-3 py-1.5">
              {(['all', 'errors', 'warnings', 'logs'] as const).map((filter) => (
                <Button
                  key={filter}
                  type="button"
                  size="xs"
                  variant={consoleFilter === filter ? 'secondary' : 'ghost'}
                  onClick={() => setConsoleFilter(filter)}
                >
                  {filter === 'all'
                    ? t('contextPanel.preview.console.filter.all')
                    : filter === 'errors'
                      ? t('contextPanel.preview.console.filter.errors')
                      : filter === 'warnings'
                        ? t('contextPanel.preview.console.filter.warnings')
                        : t('contextPanel.preview.console.filter.logs')}
                </Button>
              ))}
            </div>
            <div className="max-h-64 overflow-auto p-2 typography-code text-xs">
              {consoleEvents.length === 0 ? (
                <div className="px-2 py-3 text-muted-foreground">{t('contextPanel.preview.console.empty')}</div>
              ) : filteredConsoleEvents.length === 0 ? (
                <div className="px-2 py-3 text-muted-foreground">{t('contextPanel.preview.console.noFilteredEvents')}</div>
              ) : filteredConsoleEvents.map((event) => (
                <div key={event.id} className="border-b border-border/30 px-2 py-1 last:border-b-0">
                  <div className="flex gap-2">
                    <span className={cn(
                      'shrink-0 uppercase',
                      event.level === 'error' || event.level === 'runtime' || event.level === 'resource'
                        ? 'text-status-error'
                        : event.level === 'warn'
                          ? 'text-status-warning'
                          : 'text-muted-foreground'
                    )}>
                      {event.level}
                    </span>
                    <span className="min-w-0 break-words text-foreground">{event.message}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

type DesktopBrowserPaneProps = {
  initialUrl: string;
  directory: string;
  tabID: string;
  serverId: string;
  controllerActive: boolean;
};

const DesktopBrowserPane: React.FC<DesktopBrowserPaneProps> = ({
  initialUrl,
  directory,
  tabID,
  serverId,
  controllerActive,
}) => {
  const { t } = useI18n();
  const webviewRef = React.useRef<WebviewElement | null>(null);
  const viewportHostRef = React.useRef<HTMLDivElement | null>(null);
  const setContextPanelTabTargetPath = useUIStore((state) => state.setContextPanelTabTargetPath);
  const normalized = normalizeBrowserUrl(initialUrl);
  const startUrl = normalized !== 'about:blank' ? normalized : '';
  const initialWebviewSrcRef = React.useRef(normalized);
  const [urlInput, setUrlInput] = React.useState(startUrl);
  const [currentUrl, setCurrentUrl] = React.useState(startUrl);
  const [isInspecting, setIsInspecting] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [viewport, setViewport] = React.useState<BrowserViewport>(FILL_VIEWPORT);
  const viewportRef = React.useRef<BrowserViewport>(FILL_VIEWPORT);
  const [viewportArea, setViewportArea] = React.useState({ width: 0, height: 0 });
  const loadingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLoading = isLoading;
  const viewportLayout = viewportArea.width > 0 && viewportArea.height > 0
    ? fitViewport(viewport, viewportArea)
    : null;
  const applyViewport = React.useCallback((next: BrowserViewport) => {
    viewportRef.current = next;
    setViewport(next);
  }, []);

  React.useLayoutEffect(() => {
    const host = viewportHostRef.current;
    if (!host) return;
    const update = () => {
      const rect = host.getBoundingClientRect();
      setViewportArea((previous) => {
        const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
        return previous.width === next.width && previous.height === next.height ? previous : next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const persistUrl = React.useCallback((url: string) => {
    if (!url || url === 'about:blank' || !directory || !tabID) return;
    setContextPanelTabTargetPath(directory, tabID, url);
  }, [directory, tabID, setContextPanelTabTargetPath]);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const newSessionDraftOpen = useSessionUIStore((state) => state.newSessionDraft?.open);
  const addInlineCommentDraft = useInlineCommentDraftStore((state) => state.addDraft);
  const addAttachedFile = useInputStore((state) => state.addAttachedFile);

  // Listen to webview navigation events
  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const syncUrl = () => {
      try {
        const url = webview.getURL();
        if (url && url !== 'about:blank') {
          setCurrentUrl(url);
          setUrlInput(url);
          persistUrl(url);
        }
      } catch { /* webview not ready */ }
    };

    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ url: string }>).detail;
      if (typeof detail?.url === 'string' && detail.url) {
        setCurrentUrl(detail.url);
        setUrlInput(detail.url);
        persistUrl(detail.url);
      }
    };

    const onStartLoading = () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = setTimeout(() => setIsLoading(true), 200);
    };
    const onStopLoading = () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      setIsLoading(false);
      syncUrl();
    };

    const onNewWindow = (event: Event) => {
      const detail = (event as CustomEvent<{ url: string; disposition: string }>).detail;
      if (detail?.disposition === 'new-window' || detail?.disposition === 'foreground-tab' || detail?.disposition === 'background-tab') {
        event.preventDefault();
        const w = webviewRef.current;
        if (typeof w?.loadURL === 'function' && detail.url) {
          w.loadURL(detail.url);
        }
      }
    };

    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('new-window', onNewWindow);

    // Check current loading state imperatively — we may have missed the event
    try {
      if (!webview.isLoading()) {
        setIsLoading(false);
        syncUrl();
      }
    } catch { /* webview not ready */ }

    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
      webview.removeEventListener('did-start-loading', onStartLoading);
      webview.removeEventListener('did-stop-loading', onStopLoading);
      webview.removeEventListener('new-window', onNewWindow);
    };
  }, [persistUrl]);

  // Safety timeout: hide loading overlay after 30s even if events fire late
  React.useEffect(() => {
    const safety = setTimeout(() => setIsLoading(false), 30_000);
    return () => clearTimeout(safety);
  }, []);

  // Escape key cancels inspect mode
  React.useEffect(() => {
    if (!isInspecting) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setIsInspecting(false);
      const webview = webviewRef.current;
      try { webview?.executeJavaScript?.(DESKTOP_BROWSER_CANCEL_INSPECT_SCRIPT).catch(() => {}); } catch { /* webview not ready */ }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isInspecting]);

  // Cancel inspect on unmount
  React.useEffect(() => {
    const webview = webviewRef.current;
    return () => {
      try {
        const url = webview?.getURL?.();
        if (url && url !== 'about:blank') {
          setContextPanelTabTargetPath(directory, tabID, url);
        }
      } catch { /* webview not ready */ }
      try { webview?.executeJavaScript?.(DESKTOP_BROWSER_CANCEL_INSPECT_SCRIPT).catch(() => {}); } catch { /* webview not ready */ }
    };
  }, [directory, tabID, setContextPanelTabTargetPath]);

  const loadUrl = React.useCallback((value: string) => {
    const webview = webviewRef.current;
    if (typeof webview?.loadURL !== 'function') return;
    const nextUrl = normalizeBrowserUrl(value);
    try { webview.loadURL(nextUrl); } catch { /* webview may not be ready */ }
  }, []);

  const waitForIdle = React.useCallback(async (timeoutMs = 8_000): Promise<boolean> => {
    const startedAt = Date.now();
    for (;;) {
      const webview = webviewRef.current;
      if (!webview) return false;
      try {
        if (!webview.isLoading()) return true;
      } catch {
        return false;
      }
      if (Date.now() - startedAt >= timeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }, []);

  const runControlAction = React.useCallback(async (
    action: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> => {
    const webview = webviewRef.current;
    if (!webview) throw new Error('The browser panel is not ready');

    if (action === 'browser.open') {
      const requestedUrl = typeof parameters.url === 'string' ? parameters.url : '';
      const nextUrl = normalizeBrowserUrl(requestedUrl);
      if (nextUrl === 'about:blank') throw new Error('A valid absolute HTTP(S) URL is required');
      const requestedViewport = isViewportMode(parameters.viewport)
        ? viewportForMode(parameters.viewport)
        : viewportRef.current;
      if (isViewportMode(parameters.viewport)) applyViewport(requestedViewport);
      loadUrl(nextUrl);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const settled = await waitForIdle(25_000);
      return {
        url: webview.getURL() || nextUrl,
        title: webview.getTitle() || '',
        opened: true,
        settled,
        viewport: viewportSummary(requestedViewport),
      };
    }

    if (action === 'browser.back' || action === 'browser.forward') {
      const goingBack = action === 'browser.back';
      if (goingBack ? !webview.canGoBack() : !webview.canGoForward()) {
        throw new Error(goingBack
          ? 'There is nothing to go back to in this tab'
          : 'There is nothing to go forward to in this tab');
      }
      if (goingBack) webview.goBack();
      else webview.goForward();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitForIdle();
      return { url: webview.getURL(), title: webview.getTitle() || '' };
    }

    if (action === 'browser.capture') {
      await waitForIdle();
      const webContentsId = webview.getWebContentsId();
      if (!Number.isFinite(webContentsId)) throw new Error('The browser page cannot be captured');
      const capture = await invokeDesktopCommand<{ mime: string; base64: string; width: number; height: number }>(
        'desktop_browser_capture_page',
        { webContentsId },
      );
      return {
        ...capture,
        url: webview.getURL(),
        title: webview.getTitle() || '',
        viewport: viewportSummary(viewportRef.current),
      };
    }

    if (action === 'browser.resize') {
      if (!isViewportMode(parameters.viewport)) throw new Error('viewport is required');
      const nextViewport = viewportForMode(parameters.viewport);
      applyViewport(nextViewport);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await waitForIdle();
      return { viewport: viewportSummary(nextViewport) };
    }

    await waitForIdle();
    const optionalString = (value: unknown): string | undefined => (
      typeof value === 'string' && value.length > 0 ? value : undefined
    );
    let script: string | null = null;
    if (action === 'browser.snapshot') {
      script = buildSnapshotScript({ selector: optionalString(parameters.selector) });
    } else if (action === 'browser.click') {
      script = buildClickScript({
        selector: optionalString(parameters.selector),
        text: optionalString(parameters.text),
      });
    } else if (action === 'browser.type') {
      script = buildTypeScript({
        selector: String(parameters.selector ?? ''),
        value: String(parameters.value ?? ''),
        submit: parameters.submit === true,
      });
    } else if (action === 'browser.scroll') {
      script = buildScrollScript({
        selector: optionalString(parameters.selector),
        direction: optionalString(parameters.direction),
      });
    } else if (action === 'browser.inspect') {
      script = buildInspectScript({ selector: String(parameters.selector ?? '') });
    }
    if (!script) throw new Error(`Unsupported browser action: ${action}`);

    const result = await webview.executeJavaScript(script, true);
    if (!result || typeof result !== 'object') throw new Error('The page returned no result');
    const record = result as Record<string, unknown>;
    if (record.ok !== true) {
      throw new Error(typeof record.error === 'string' && record.error ? record.error : 'Browser action failed');
    }
    if (action === 'browser.snapshot') {
      return { ...record, viewport: viewportSummary(viewportRef.current) };
    }
    if (action === 'browser.click' || (action === 'browser.type' && parameters.submit === true)) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitForIdle();
    }
    return record;
  }, [applyViewport, loadUrl, waitForIdle]);

  React.useEffect(() => {
    if (!controllerActive || serverId === UNRESOLVED_SERVER_ID) return;
    return registerBrowserController(serverId, { run: runControlAction });
  }, [controllerActive, runControlAction, serverId]);

  const handleInspect = React.useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    if (isInspecting) {
      setIsInspecting(false);
      try { webview.executeJavaScript?.(DESKTOP_BROWSER_CANCEL_INSPECT_SCRIPT).catch(() => {}); } catch { /* webview not ready */ }
      return;
    }

    setIsInspecting(true);
    webview.executeJavaScript?.(DESKTOP_BROWSER_INSPECT_SCRIPT, true)
      .then(async (target: unknown) => {
        setIsInspecting(false);
        if (!target || !isPreviewElementMetadata(target)) return;

        const sessionKey = currentSessionId ?? (newSessionDraftOpen ? 'draft' : null);
        if (!sessionKey) {
          toast.error(t('contextPanel.preview.inspect.attachNoSession'));
          return;
        }

        const wcId = typeof webview.getWebContentsId === 'function' ? webview.getWebContentsId() : null;
        if (wcId === null || wcId === undefined) return;

        const capture = await invokeDesktopCommand<{ mime: string; base64: string; width: number; height: number }>(
          'desktop_browser_capture_page', { webContentsId: wcId }
        );

        const cssViewport = await webview.executeJavaScript?.(
          '({ width: window.innerWidth, height: window.innerHeight })', true
        ).catch(() => null) as { width: number; height: number } | null | undefined;

        const cssWidth = Number.isFinite(cssViewport?.width) ? (cssViewport as { width: number }).width : capture.width;
        const cssHeight = Number.isFinite(cssViewport?.height) ? (cssViewport as { height: number }).height : capture.height;

        const file = await desktopAnnotationToFile(capture.base64, capture.width, capture.height, cssWidth, cssHeight, target);
        const screenshotAttached = Boolean(file);
        if (file) {
          await addAttachedFile(file);
        }

        addInlineCommentDraft({
          sessionKey,
          source: 'preview-annotation',
          fileLabel: currentUrl || 'browser',
          startLine: 1,
          endLine: 1,
          code: formatPreviewAnnotationMarkdown({
            pageUrl: currentUrl,
            viewport: { width: cssWidth, height: cssHeight },
            devicePixelRatio: window.devicePixelRatio || 1,
            target,
            screenshotAttached,
            intro: t('contextPanel.preview.inspect.attachAnnotationWithScreenshot'),
          }),
          language: 'markdown',
          text: '',
        });
        toast.success(t('contextPanel.preview.inspect.attached'));
      })
      .catch(() => setIsInspecting(false));
  }, [addAttachedFile, addInlineCommentDraft, currentSessionId, currentUrl, isInspecting, newSessionDraftOpen, t]);

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <div className="flex items-center gap-1 border-b border-border/40 bg-[var(--surface-background)] px-2 py-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { try { webviewRef.current?.goBack?.(); } catch { /* webview not ready */ } }}>
          <Icon name="arrow-left" className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { try { webviewRef.current?.goForward?.(); } catch { /* webview not ready */ } }}>
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { try { webviewRef.current?.reload?.(); } catch { /* webview not ready */ } }}>
          <Icon name="refresh" className="h-3.5 w-3.5" />
        </Button>
        <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); loadUrl(urlInput); }}>
          <input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            className="h-7 w-full rounded-md border border-border/50 bg-[var(--surface-elevated)] px-2 typography-micro text-foreground outline-none focus:border-[var(--interactive-focus-ring)]"
            aria-label={t('contextPanel.browser.addressAria')}
          />
        </form>
        <Button
          type="button"
          variant={isInspecting ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleInspect}
          title={t('contextPanel.preview.inspect.toggle')}
          aria-label={t('contextPanel.preview.inspect.toggle')}
        >
          <Icon name="cursor" className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => void openExternalUrl(currentUrl)}>
          <Icon name="external-link" className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div ref={viewportHostRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background">
        <div
          className="shrink-0 overflow-hidden bg-background"
          style={viewportLayout
            ? {
              width: viewportLayout.width,
              height: viewportLayout.height,
              transform: `scale(${viewportLayout.scale})`,
              transformOrigin: 'center center',
            }
            : { width: '100%', height: '100%' }}
        >
          <webview
            ref={webviewRef}
            src={initialWebviewSrcRef.current}
            partition="persist:openchamber-browser"
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        </div>
        {viewportLayout ? (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-[var(--surface-elevated)]/90 px-2 py-1 typography-micro tabular-nums text-muted-foreground shadow-sm">
            {viewportLayout.width} x {viewportLayout.height} @ {Math.round(viewportLayout.scale * 100)}%
          </div>
        ) : null}
        {(!currentUrl || currentUrl === 'about:blank') && !isLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-background p-6 text-center">
            <OpenChamberLogo width={140} height={140} className="opacity-20" />
            <span className="typography-ui-header text-muted-foreground">{t('contextPanel.browser.empty')}</span>
          </div>
        ) : null}
        {showLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 typography-micro text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : null}
      </div>
    </div>
  );
};


const ContextPanelTabContent: React.FC<{
  tab: ContextPanelTabLike;
  active: boolean;
  directory: string;
  effectiveDirectory: string;
  serverId: string;
  controllerActive: boolean;
  postEmbeddedVisibilityToChats: () => void;
  postChatSettingsSyncToEmbeddedChats: () => void;
  postThemeSyncToEmbeddedChat: () => void;
  setChatFrameRef: (tabID: string, node: HTMLIFrameElement | null) => void;
}> = ({
  tab,
  active,
  directory,
  effectiveDirectory,
  serverId,
  controllerActive,
  postEmbeddedVisibilityToChats,
  postChatSettingsSyncToEmbeddedChats,
  postThemeSyncToEmbeddedChat,
  setChatFrameRef,
}) => {
  const { t } = useI18n();

  if (tab.mode === 'file') {
    return <FilesView mode="editor-only" active={active} />;
  }

  if (tab.mode === 'chat') {
    if (!active) return null;
    const sessionID = getSessionIDFromDedupeKey(tab.dedupeKey);
    const src = sessionID ? buildEmbeddedSessionChatURL(sessionID, directory || null, tab.readOnly) : '';
    if (!sessionID || !src) {
      return null;
    }

    return (
      <iframe
        ref={(node) => setChatFrameRef(tab.id, node)}
        src={src}
        title={t('contextPanel.iframe.sessionChatTitle', { sessionID })}
        className={cn('h-full w-full border-0 bg-background', active ? 'block' : 'hidden')}
        onLoad={() => {
          postThemeSyncToEmbeddedChat();
          postChatSettingsSyncToEmbeddedChats();
          postEmbeddedVisibilityToChats();
        }}
      />
    );
  }

  if (tab.mode === 'diff') {
    return <DiffView hideStackedFileSidebar stackedDefaultCollapsedAll hideFileSelector pinSelectedFileHeaderToTopOnNavigate showOpenInEditorAction />;
  }

  if (tab.mode === 'walkthrough') {
    return <WalkthroughView directory={effectiveDirectory} />;
  }

  if (tab.mode === 'git') {
    return <GitView />;
  }

  if (tab.mode === 'pr') {
    return <PullRequestView />;
  }

  if (tab.mode === 'notes') {
    return <ProjectContextPanel />;
  }

  if (tab.mode === 'context') {
    return <ContextPanelContent />;
  }

  if (tab.mode === 'plan') {
    return <PlanView targetPath={tab.targetPath} />;
  }

  if (tab.mode === 'preview') {
    return (
      <ErrorBoundary
        fallback={(
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background px-6 text-center text-sm text-muted-foreground">
            <div>{t('contextPanel.preview.proxyError')}</div>
            <div className="text-xs opacity-70">{tab.targetPath ?? ''}</div>
          </div>
        )}
      >
        <PreviewPane
          key={tab.targetPath ?? 'preview'}
          rawUrl={tab.targetPath ?? ''}
          onNavigate={(url) => useUIStore.getState().openContextPreview(effectiveDirectory, url)}
        />
      </ErrorBoundary>
    );
  }

  if (tab.mode === 'terminal') {
    return (
      <React.Suspense fallback={null}>
        <TerminalView />
      </React.Suspense>
    );
  }

  if (tab.mode === 'browser') {
    return (
      <DesktopBrowserPane
        initialUrl={tab.targetPath ?? ''}
        directory={directory}
        tabID={tab.id}
        serverId={serverId}
        controllerActive={controllerActive}
      />
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon name="global" className="h-12 w-12 text-muted-foreground/50"  />
      <div className="typography-ui-header text-foreground">{t('contextPanel.preview.title')}</div>
      <div className="max-w-sm typography-micro text-muted-foreground">{t('contextPanel.preview.description')}</div>    </div>
  );
};

export const ContextPanel: React.FC = () => {
  const { t } = useI18n();
  const effectiveDirectory = useEffectiveDirectory() ?? '';
  const activeServerId = useActiveServerId();
  const directoryKey = React.useMemo(() => normalizeDirectoryKey(effectiveDirectory), [effectiveDirectory]);

  const panelState = useUIStore((state) => (directoryKey ? state.contextPanelByDirectory[directoryKey] : undefined));
  const closeContextPanel = useUIStore((state) => state.closeContextPanel);
  const openContextBrowser = useUIStore((state) => state.openContextBrowser);
  const closeContextPanelTab = useUIStore((state) => state.closeContextPanelTab);
  const toggleContextPanelExpanded = useUIStore((state) => state.toggleContextPanelExpanded);
  const setContextPanelWidth = useUIStore((state) => state.setContextPanelWidth);
  const setActiveContextPanelTab = useUIStore((state) => state.setActiveContextPanelTab);
  const reorderContextPanelTabs = useUIStore((state) => state.reorderContextPanelTabs);
  const setContextPanelSplit = useUIStore((state) => state.setContextPanelSplit);
  const setContextPanelSplitRatio = useUIStore((state) => state.setContextPanelSplitRatio);
  const setPendingDiffFile = useUIStore((state) => state.setPendingDiffFile);
  const allowPromptingSubagentSessions = useUIStore((state) => state.allowPromptingSubagentSessions);
  const setSelectedFilePath = useFilesViewTabsStore((state) => state.setSelectedPath);
  const { themeMode, lightThemeId, darkThemeId, currentTheme } = useThemeSystem();

  const tabs = React.useMemo(() => normalizeContextPanelTabsForRender(panelState?.tabs), [panelState?.tabs]);
  const activeTab = tabs.find((tab) => tab.id === panelState?.activeTabId) ?? tabs[tabs.length - 1] ?? null;
  const splitTab = panelState?.splitTabId ? (tabs.find((tab) => tab.id === panelState.splitTabId) ?? null) : null;
  const splitRatio = panelState?.splitRatio ?? 0.5;
  const hasSplit = Boolean(splitTab && activeTab && splitTab.id !== activeTab.id);
  const isOpen = Boolean(panelState?.isOpen && activeTab);
  const isExpanded = Boolean(isOpen && panelState?.expanded);
  const [availablePanelAreaWidth, setAvailablePanelAreaWidth] = React.useState<number | null>(null);
  const activeModeForWidth = activeTab?.mode ?? null;
  const manualWidth = activeModeForWidth ? panelState?.widthByMode?.[activeModeForWidth] : undefined;
  const widthFraction = activeModeForWidth ? getContextSurfaceWidthFraction(activeModeForWidth) : 0.5;
  const widthFallbackBase = availablePanelAreaWidth
    ?? (typeof window !== 'undefined' ? window.innerWidth : CONTEXT_PANEL_DEFAULT_WIDTH * 2);
  const width = clampWidth(manualWidth ?? Math.round(widthFraction * widthFallbackBase));

  const [isResizing, setIsResizing] = React.useState(false);
  const isResizingRef = React.useRef(false);
  const [suppressWidthTransition, setSuppressWidthTransition] = React.useState(false);
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(width);
  const resizingWidthRef = React.useRef<number | null>(null);
  const activeResizePointerIDRef = React.useRef<number | null>(null);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const contentAreaRef = React.useRef<HTMLDivElement | null>(null);
  const splitOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const splitOverlayLabelRef = React.useRef<HTMLDivElement | null>(null);
  const draggedTabIDRef = React.useRef<string | null>(null);
  const splitDropZoneRef = React.useRef<SplitDropZone | null>(null);
  const isSplitResizingRef = React.useRef(false);
  const splitResizeStartYRef = React.useRef(0);
  const splitResizeStartRatioRef = React.useRef(splitRatio);
  const splitResizeHeightRef = React.useRef(0);
  const chatFrameRefs = React.useRef<Map<string, HTMLIFrameElement>>(new Map());
  const wasOpenRef = React.useRef(false);
  const previousIsOpenRef = React.useRef(isOpen);
  const suppressWidthTransitionFrameRef = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const update = () => setAvailablePanelAreaWidth(getAvailablePanelWidth(panelRef.current));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const suppressWidthTransitionForFrame = React.useCallback(() => {
    setSuppressWidthTransition(true);
    if (suppressWidthTransitionFrameRef.current !== null) {
      window.cancelAnimationFrame(suppressWidthTransitionFrameRef.current);
    }
    suppressWidthTransitionFrameRef.current = window.requestAnimationFrame(() => {
      suppressWidthTransitionFrameRef.current = null;
      setSuppressWidthTransition(false);
    });
  }, []);

  React.useEffect(() => () => {
    if (suppressWidthTransitionFrameRef.current !== null) {
      window.cancelAnimationFrame(suppressWidthTransitionFrameRef.current);
    }
  }, []);

  React.useLayoutEffect(() => {
    const wasOpen = previousIsOpenRef.current;
    previousIsOpenRef.current = isOpen;

    if (!isOpen) {
      setSuppressWidthTransition(false);
      return;
    }

    if (wasOpen) {
      return;
    }

    suppressWidthTransitionForFrame();
  }, [isOpen, suppressWidthTransitionForFrame]);

  React.useEffect(() => {
    if (!isOpen || wasOpenRef.current) {
      wasOpenRef.current = isOpen;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });

    wasOpenRef.current = true;
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const applyLiveWidth = React.useCallback((nextWidth: number) => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    panel.style.setProperty('--oc-context-panel-width', `${clampWidthToAvailableSpace(nextWidth, panel)}px`);
  }, []);

  const handleResizeStart = React.useCallback((event: React.PointerEvent) => {
    if (!isOpen || isExpanded || !directoryKey) {
      return;
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore; fallback listeners still handle drag
    }

    activeResizePointerIDRef.current = event.pointerId;
    isResizingRef.current = true;
    setIsResizing(true);
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    resizingWidthRef.current = width;
    applyLiveWidth(width);
    event.preventDefault();
  }, [applyLiveWidth, directoryKey, isExpanded, isOpen, width]);

  const handleResizeMove = React.useCallback((event: React.PointerEvent) => {
    if (!isResizingRef.current || activeResizePointerIDRef.current !== event.pointerId) {
      return;
    }

    const delta = startXRef.current - event.clientX;
    const nextWidth = clampWidthToAvailableSpace(startWidthRef.current + delta, panelRef.current);
    if (resizingWidthRef.current === nextWidth) {
      return;
    }

    resizingWidthRef.current = nextWidth;
    applyLiveWidth(nextWidth);
  }, [applyLiveWidth]);

  const handleResizeEnd = React.useCallback((event: React.PointerEvent) => {
    if (activeResizePointerIDRef.current !== event.pointerId || !directoryKey || !activeModeForWidth) {
      return;
    }

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    const finalWidth = clampWidthToAvailableSpace(resizingWidthRef.current ?? width, panelRef.current);
    suppressWidthTransitionForFrame();
    applyLiveWidth(finalWidth);
    resizingWidthRef.current = finalWidth;
    setContextPanelWidth(directoryKey, activeModeForWidth, finalWidth);
    isResizingRef.current = false;
    setIsResizing(false);
    activeResizePointerIDRef.current = null;
  }, [activeModeForWidth, applyLiveWidth, directoryKey, setContextPanelWidth, suppressWidthTransitionForFrame, width]);

  React.useEffect(() => {
    if (!isResizing) {
      resizingWidthRef.current = null;
    }
  }, [isResizing]);

  React.useEffect(() => {
    if (!directoryKey || !panelState?.splitTabId) {
      return;
    }

    if (!tabs.some((tab) => tab.id === panelState.splitTabId) || panelState.splitTabId === activeTab?.id) {
      setContextPanelSplit(directoryKey, null);
    }
  }, [activeTab?.id, directoryKey, panelState?.splitTabId, setContextPanelSplit, tabs]);

  const hideSplitOverlay = React.useCallback(() => {
    const overlay = splitOverlayRef.current;
    if (overlay) {
      overlay.classList.add('hidden');
    }
    splitDropZoneRef.current = null;
  }, []);

  const showSplitOverlay = React.useCallback((zone: SplitDropZone) => {
    const overlay = splitOverlayRef.current;
    const label = splitOverlayLabelRef.current;
    if (!overlay || !label) {
      return;
    }

    const top = zone === 'bottom' ? '60%' : '0%';
    const height = zone === 'middle' ? '100%' : '40%';
    overlay.style.top = top;
    overlay.style.height = height;
    label.textContent = zone === 'top'
      ? t('contextPanel.split.dropTopHint')
      : zone === 'bottom'
        ? t('contextPanel.split.dropBottomHint')
        : '';
    overlay.classList.toggle('items-start', zone === 'top');
    overlay.classList.toggle('items-end', zone === 'bottom');
    overlay.classList.toggle('items-center', zone === 'middle');
    overlay.classList.toggle('hidden', zone === 'middle');
  }, [t]);

  const updateSplitDropZone = React.useCallback((clientY: number) => {
    const area = contentAreaRef.current;
    const draggedTabID = draggedTabIDRef.current;
    if (!area || !draggedTabID) {
      hideSplitOverlay();
      return;
    }

    const rect = area.getBoundingClientRect();
    if (rect.height <= 0 || clientY < rect.top || clientY > rect.bottom) {
      hideSplitOverlay();
      return;
    }

    const ratio = (clientY - rect.top) / rect.height;
    const zone: SplitDropZone = ratio < 0.4 ? 'top' : ratio > 0.6 ? 'bottom' : 'middle';
    splitDropZoneRef.current = zone;
    showSplitOverlay(zone);
  }, [hideSplitOverlay, showSplitOverlay]);

  const handleClose = React.useCallback(() => {
    if (!directoryKey) {
      return;
    }
    closeContextPanel(directoryKey);
  }, [closeContextPanel, directoryKey]);

  const handleToggleExpanded = React.useCallback(() => {
    if (!directoryKey) {
      return;
    }
    toggleContextPanelExpanded(directoryKey);
  }, [directoryKey, toggleContextPanelExpanded]);

  const handlePanelKeyDownCapture = React.useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') {
      return;
    }

    const target = event.target;
    if (target instanceof Element && Boolean(
      target.closest('.terminal-viewport-container')
      || target.getAttribute('data-terminal-hidden-input') === 'true'
    )) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleClose();
  }, [handleClose]);

  const handleContextTabDragStart = React.useCallback((tabID: string) => {
    draggedTabIDRef.current = tabID;
    splitDropZoneRef.current = null;
  }, []);

  const handleContextTabDragMove = React.useCallback((tabID: string, event: { activatorEvent: Event; delta: { x: number; y: number } }) => {
    draggedTabIDRef.current = tabID;
    const activator = event.activatorEvent;
    if (!(activator instanceof PointerEvent)) {
      hideSplitOverlay();
      return;
    }
    updateSplitDropZone(activator.clientY + event.delta.y);
  }, [hideSplitOverlay, updateSplitDropZone]);

  const handleContextTabDragCancel = React.useCallback(() => {
    draggedTabIDRef.current = null;
    hideSplitOverlay();
  }, [hideSplitOverlay]);

  const handleContextTabDragEnd = React.useCallback((tabID: string) => {
    const zone = splitDropZoneRef.current;
    draggedTabIDRef.current = null;
    hideSplitOverlay();

    if (!directoryKey || !zone || zone === 'middle') {
      return;
    }

    if (zone === 'top') {
      if (tabID === splitTab?.id) {
        setContextPanelSplit(directoryKey, null);
      }
      setActiveContextPanelTab(directoryKey, tabID);
      return;
    }

    if (tabID === activeTab?.id) {
      return;
    }

    setContextPanelSplit(directoryKey, tabID);
  }, [activeTab?.id, directoryKey, hideSplitOverlay, setActiveContextPanelTab, setContextPanelSplit, splitTab?.id]);

  const handleSplitResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!directoryKey || !hasSplit) {
      return;
    }

    const area = contentAreaRef.current;
    const height = area?.getBoundingClientRect().height ?? 0;
    if (height <= CONTEXT_PANEL_SPLIT_HANDLE_HEIGHT) {
      return;
    }

    isSplitResizingRef.current = true;
    splitResizeStartYRef.current = event.clientY;
    splitResizeStartRatioRef.current = splitRatio;
    splitResizeHeightRef.current = height;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    event.preventDefault();
  }, [directoryKey, hasSplit, splitRatio]);

  const handleSplitResizeMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!directoryKey || !isSplitResizingRef.current) {
      return;
    }

    const availableHeight = Math.max(1, splitResizeHeightRef.current - CONTEXT_PANEL_SPLIT_HANDLE_HEIGHT);
    const delta = event.clientY - splitResizeStartYRef.current;
    const nextRatio = splitResizeStartRatioRef.current + (delta / availableHeight);
    setContextPanelSplitRatio(directoryKey, nextRatio);
  }, [directoryKey, setContextPanelSplitRatio]);

  const handleSplitResizeEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isSplitResizingRef.current) {
      return;
    }

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    isSplitResizingRef.current = false;
  }, []);

  const setChatFrameRef = React.useCallback((tabID: string, node: HTMLIFrameElement | null) => {
    if (!node) {
      chatFrameRefs.current.delete(tabID);
      return;
    }
    chatFrameRefs.current.set(tabID, node);
  }, []);

  const handleCloseSplit = React.useCallback(() => {
    if (!directoryKey) {
      return;
    }
    setContextPanelSplit(directoryKey, null);
  }, [directoryKey, setContextPanelSplit]);

  React.useEffect(() => {
    if (!directoryKey || !activeTab) {
      return;
    }

    if (activeTab.mode === 'file' && activeTab.targetPath) {
      setSelectedFilePath(directoryKey, activeTab.targetPath);
      return;
    }

    if (activeTab.mode === 'diff' && activeTab.targetPath) {
      setPendingDiffFile(activeTab.targetPath);
    }
  }, [activeTab, directoryKey, setPendingDiffFile, setSelectedFilePath]);

  const activeChatTabID = isOpen && activeTab?.mode === 'chat' ? activeTab.id : null;
  const activeChatTab = React.useMemo(
    () => getActiveEmbeddedSessionChatTab(tabs.filter((tab) => tab.mode === 'chat'), activeChatTabID),
    [activeChatTabID, tabs],
  );
  const splitChatTabID = hasSplit && splitTab?.mode === 'chat' ? splitTab.id : null;
  const viewedChatSessionIDs = React.useMemo(() => {
    const sessionIDs = [
      activeTab?.mode === 'chat' ? getSessionIDFromDedupeKey(activeTab.dedupeKey) : null,
      hasSplit && splitTab?.mode === 'chat' ? getSessionIDFromDedupeKey(splitTab.dedupeKey) : null,
    ].filter((sessionID): sessionID is string => Boolean(sessionID));
    return Array.from(new Set(sessionIDs));
  }, [activeTab, hasSplit, splitTab]);

  React.useEffect(() => {
    if (!isOpen || !directoryKey || viewedChatSessionIDs.length === 0 || typeof window === 'undefined') {
      return;
    }

    const setViewed = (viewed: boolean) => {
      for (const sessionID of viewedChatSessionIDs) {
        setExternallyViewedSession(directoryKey, sessionID, viewed);
      }
    };
    const syncViewedState = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) {
        setViewed(false);
        return;
      }

      for (const sessionID of viewedChatSessionIDs) {
        markSessionViewed(sessionID);
      }
      setViewed(true);
    };

    syncViewedState();
    const interval = window.setInterval(syncViewedState, 10_000);
    window.addEventListener('focus', syncViewedState);
    window.addEventListener('blur', syncViewedState);
    document.addEventListener('visibilitychange', syncViewedState);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', syncViewedState);
      window.removeEventListener('blur', syncViewedState);
      document.removeEventListener('visibilitychange', syncViewedState);
      setViewed(false);
    };
  }, [directoryKey, isOpen, viewedChatSessionIDs]);

  const postThemeSyncToEmbeddedChat = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const payload = {
      themeMode,
      lightThemeId,
      darkThemeId,
      currentTheme,
    };

    for (const frame of chatFrameRefs.current.values()) {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        continue;
      }

      const directThemeSync = (frameWindow as unknown as {
        __openchamberApplyThemeSync?: (themePayload: typeof payload) => void;
      }).__openchamberApplyThemeSync;

      if (typeof directThemeSync === 'function') {
        try {
          directThemeSync(payload);
          continue;
        } catch {
          // fallback to postMessage below
        }
      }

      frameWindow.postMessage(
        {
          type: 'openchamber:theme-sync',
          payload,
        },
        window.location.origin,
      );
    }
  }, [currentTheme, darkThemeId, lightThemeId, themeMode]);

  const postEmbeddedVisibilityToChats = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    for (const [tabID, frame] of chatFrameRefs.current.entries()) {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        continue;
      }

      const payload = { visible: activeChatTabID === tabID || splitChatTabID === tabID };
      const directVisibilitySync = (frameWindow as unknown as {
        __openchamberSetEmbeddedVisibility?: (visibilityPayload: typeof payload) => void;
      }).__openchamberSetEmbeddedVisibility;

      if (typeof directVisibilitySync === 'function') {
        try {
          directVisibilitySync(payload);
          continue;
        } catch {
          // fallback to postMessage below
        }
      }

      frameWindow.postMessage(
        {
          type: 'openchamber:embedded-visibility',
          payload,
        },
        window.location.origin,
      );
    }
  }, [activeChatTabID, splitChatTabID]);

  const postChatSettingsSyncToEmbeddedChats = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const payload = { allowPromptingSubagentSessions };
    for (const frame of chatFrameRefs.current.values()) {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        continue;
      }

      const directSettingsSync = (frameWindow as unknown as {
        __openchamberApplyChatSettingsSync?: (settingsPayload: typeof payload) => void;
      }).__openchamberApplyChatSettingsSync;

      if (typeof directSettingsSync === 'function') {
        try {
          directSettingsSync(payload);
          continue;
        } catch {
          // Cross-context frames fall back to the postMessage bridge below.
        }
      }

      frameWindow.postMessage(
        {
          type: 'openchamber:chat-settings-sync',
          payload,
        },
        window.location.origin,
      );
    }
  }, [allowPromptingSubagentSessions]);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleChatSettingsRequest = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as { type?: unknown };
      if (data?.type !== 'openchamber:chat-settings-request') {
        return;
      }
      const isKnownChatFrame = Array.from(chatFrameRefs.current.values())
        .some((frame) => frame.contentWindow === event.source);
      if (!isKnownChatFrame) {
        return;
      }
      postChatSettingsSyncToEmbeddedChats();
    };

    window.addEventListener('message', handleChatSettingsRequest);
    return () => window.removeEventListener('message', handleChatSettingsRequest);
  }, [postChatSettingsSyncToEmbeddedChats]);

  React.useLayoutEffect(() => {
    const hasAnyChatTab = tabs.some((tab) => tab.mode === 'chat');
    if (!hasAnyChatTab) {
      return;
    }

    postThemeSyncToEmbeddedChat();
    postChatSettingsSyncToEmbeddedChats();
    postEmbeddedVisibilityToChats();
  }, [darkThemeId, lightThemeId, postChatSettingsSyncToEmbeddedChats, postEmbeddedVisibilityToChats, postThemeSyncToEmbeddedChat, tabs, themeMode]);

  React.useEffect(() => {
    if (!directoryKey || activeServerId === UNRESOLVED_SERVER_ID) return;
    return registerBrowserOpener(activeServerId, (url) => openContextBrowser(directoryKey, url));
  }, [activeServerId, directoryKey, openContextBrowser]);

  const renderTabPaneContent = React.useCallback((
    tab: ContextPanelTabLike,
    active: boolean,
    controllerActive = active,
  ) => (
    <ContextPanelTabContent
      tab={tab}
      active={active}
      directory={directoryKey}
      effectiveDirectory={effectiveDirectory}
      serverId={activeServerId}
      controllerActive={controllerActive}
      postEmbeddedVisibilityToChats={postEmbeddedVisibilityToChats}
      postChatSettingsSyncToEmbeddedChats={postChatSettingsSyncToEmbeddedChats}
      postThemeSyncToEmbeddedChat={postThemeSyncToEmbeddedChat}
      setChatFrameRef={setChatFrameRef}
    />
  ), [activeServerId, directoryKey, effectiveDirectory, postChatSettingsSyncToEmbeddedChats, postEmbeddedVisibilityToChats, postThemeSyncToEmbeddedChat, setChatFrameRef]);

  const tabItems = React.useMemo(() => tabs.map((tab) => {
    const rawLabel = getTabLabel(tab, t);
    const label = truncateTabLabel(rawLabel, CONTEXT_TAB_LABEL_MAX_CHARS);
    const tabPathLabel = getRelativePathLabel(tab.targetPath, effectiveDirectory);
    return {
      id: tab.id,
      label,
      icon: getTabIcon(tab),
      title: tabPathLabel ? `${rawLabel}: ${tabPathLabel}` : rawLabel,
      closeLabel: t('contextPanel.tab.closeTabAria', { label }),
    };
  }), [effectiveDirectory, t, tabs]);

  const hasFileTabs = React.useMemo(
    () => tabs.some((tab) => tab.mode === 'file'),
    [tabs],
  );

  const isFileTabActive = activeTab?.mode === 'file';

  const header = (
    <header className="flex h-10 items-stretch border-b border-transparent">
      <SortableTabsStrip
        items={tabItems}
        activeId={activeTab?.id ?? null}
        onSelect={(tabID) => {
          if (!directoryKey) {
            return;
          }
          setActiveContextPanelTab(directoryKey, tabID);
        }}
        onClose={(tabID) => {
          if (!directoryKey) {
            return;
          }
          if (tabID === panelState?.splitTabId) {
            setContextPanelSplit(directoryKey, null);
          }
          closeContextPanelTab(directoryKey, tabID);
        }}
        onReorder={(activeTabID, overTabID) => {
          if (!directoryKey) {
            return;
          }
          reorderContextPanelTabs(directoryKey, activeTabID, overTabID);
        }}
        layoutMode="scrollable"
        variant="default"
        onDragStart={handleContextTabDragStart}
        onDragMove={handleContextTabDragMove}
        onDragCancel={handleContextTabDragCancel}
        onDragEnd={handleContextTabDragEnd}
      />
      <div className="flex items-center gap-1 px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleToggleExpanded}
          className="h-7 w-7 p-0"
          title={isExpanded ? t('contextPanel.actions.collapsePanel') : t('contextPanel.actions.expandPanel')}
          aria-label={isExpanded ? t('contextPanel.actions.collapsePanel') : t('contextPanel.actions.expandPanel')}
        >
          {isExpanded ? <Icon name="fullscreen-exit" className="h-3.5 w-3.5" /> : <Icon name="fullscreen" className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="h-7 w-7 p-0"
          title={t('contextPanel.actions.closePanel')}
          aria-label={t('contextPanel.actions.closePanel')}
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </Button>
      </div>
    </header>
  );

  const panelStyle: React.CSSProperties = !isOpen
    ? {
        ['--oc-context-panel-width' as string]: `${isResizing ? (resizingWidthRef.current ?? width) : width}px`,
        width: 0,
        minWidth: 0,
        maxWidth: 0,
        opacity: 0,
        overflow: 'hidden',
        visibility: 'hidden',
      }
    : isExpanded
      ? {
          ['--oc-context-panel-width' as string]: '100%',
          width: '100%',
          minWidth: '100%',
          maxWidth: '100%',
        }
      : {
          width: 'min(var(--oc-context-panel-width), 100%)',
          minWidth: `min(${CONTEXT_PANEL_MIN_WIDTH}px, 100%)`,
          maxWidth: '100%',
          ['--oc-context-panel-width' as string]: `${isResizing ? (resizingWidthRef.current ?? width) : width}px`,
        };

  return (
    <aside
      ref={panelRef}
      data-context-panel="true"
      tabIndex={-1}
      inert={!isOpen || undefined}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden bg-background max-sm:hidden',
        !isExpanded && 'border-l border-border/40',
        isExpanded
          ? 'absolute inset-0 z-20 min-w-0'
          : 'relative h-full flex-shrink-0',
        !isOpen && 'pointer-events-none',
        isResizing || !isOpen || suppressWidthTransition ? 'transition-none' : 'transition-[width] duration-200 ease-in-out'
      )}
      onKeyDownCapture={handlePanelKeyDownCapture}
      style={panelStyle}
    >
      {!isExpanded && (
        <div
          className={cn(
            'absolute left-0 top-0 z-20 h-full w-[3px] cursor-col-resize transition-colors hover:bg-[var(--interactive-border)]/80',
            isResizing && 'bg-[var(--interactive-border)]'
          )}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('contextPanel.actions.resizePanelAria')}
        />
      )}
      {header}
      <div ref={contentAreaRef} className={cn('relative min-h-0 flex-1 overflow-hidden', isResizing && 'pointer-events-none')}>
        {hasSplit && activeTab && splitTab ? (
          <div className="absolute inset-0 flex min-h-0 flex-col">
            <div className="relative min-h-0 overflow-hidden" style={{ height: `calc((100% - ${CONTEXT_PANEL_SPLIT_HANDLE_HEIGHT}px) * ${splitRatio})` }}>
              <div className="absolute inset-0">{renderTabPaneContent(activeTab, isOpen, true)}</div>
            </div>
            <div
              className="flex h-[3px] shrink-0 cursor-row-resize items-center justify-end bg-[var(--interactive-border)]/60 transition-colors hover:bg-[var(--interactive-border)]"
              onPointerDown={handleSplitResizeStart}
              onPointerMove={handleSplitResizeMove}
              onPointerUp={handleSplitResizeEnd}
              onPointerCancel={handleSplitResizeEnd}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t('contextPanel.split.resizeAria')}
            >
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="mr-1 h-5 w-5 p-0"
                onClick={(event) => {
                  event.stopPropagation();
                  handleCloseSplit();
                }}
                title={t('contextPanel.split.closeSplitAria')}
                aria-label={t('contextPanel.split.closeSplitAria')}
              >
                <Icon name="close" className="h-3 w-3"  />
              </Button>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div className="absolute inset-0">{renderTabPaneContent(splitTab, isOpen, false)}</div>
            </div>
          </div>
        ) : (
          <>
            {hasFileTabs ? (
              <div className={cn('absolute inset-0', isFileTabActive ? 'block' : 'hidden')}>
                <FilesView mode="editor-only" active={isOpen && isFileTabActive} />
              </div>
            ) : null}
            {activeChatTab ? (
              <div key={activeChatTab.id} className="absolute inset-0">
                {renderTabPaneContent(activeChatTab, true)}
              </div>
            ) : null}
            {activeTab && activeTab.mode !== 'chat' && !isFileTabActive ? (
              <div className="absolute inset-0">{renderTabPaneContent(activeTab, true)}</div>
            ) : null}
          </>
        )}
        <div
          ref={splitOverlayRef}
          className="pointer-events-none absolute inset-x-0 z-30 hidden justify-center border-y border-[var(--interactive-focus-ring)] bg-[var(--interactive-focus-ring)]/25 p-3 text-[var(--surface-foreground)] shadow-[inset_0_0_0_1px_var(--interactive-focus-ring)]"
          aria-hidden
        >
          <div ref={splitOverlayLabelRef} className="rounded-md bg-[var(--surface-elevated)] px-2 py-1 typography-micro shadow" />
        </div>
      </div>
    </aside>
  );
};

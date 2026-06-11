import React from 'react';
import 'katex/dist/katex.min.css';
import { renderMermaidASCII, renderMermaidSVG } from 'beautiful-mermaid';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { marked, type Tokens } from 'marked';
import remend from 'remend';
import { FadeInOnReveal } from './message/FadeInOnReveal';
import type { Part } from '@opencode-ai/sdk/v2';
import { cn } from '@/lib/utils';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { toast } from '@/components/ui';
import { Icon } from "@/components/icon/Icon";
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';

import { getExternalFaviconUrl, isExternalHttpUrl, isLoopbackHttpUrl, openExternalUrl } from '@/lib/url';
import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';
import { getDefaultTheme } from '@/lib/theme/themes';
import { generateSyntaxTheme } from '@/lib/theme/syntaxThemeGenerator';
import type { ToolPopupContent } from './message/types';
import { useUIStore } from '@/stores/useUIStore';
import { useDeviceInfo } from '@/lib/device';
import { useMessageDirectory } from '@/hooks/useMessageDirectory';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { loadCjkMonoFont } from '@/lib/fontLoader';
import type { EditorAPI } from '@/lib/api/types';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { getDirectoryForFilePath } from '@/lib/path-utils';
import { CODE_SHARED_STYLE, MARKDOWN_CODE_BODY_CLASSNAME } from './markdownCodeStyle';
import { getTableCopyContent, tableToCSV, tableToMarkdown, type TableCopyFormat, type TableData } from './markdownTableExport';
import {
  getFileNameFromPath,
  getResolvedReference,
  isAbsolutePath,
  isLikelyFilePath,
  isLikelyFilePathValue,
  isLikelyImageFilePath,
  normalizeMarkdownImageSource,
  normalizePath,
  parseFileReference,
  toAbsolutePath,
} from './markdownFileReferences';

const useCurrentMermaidTheme = () => {
  const themeSystem = useOptionalThemeSystem();
  const fallbackLight = getDefaultTheme(false);
  const fallbackDark = getDefaultTheme(true);

  return themeSystem?.currentTheme
    ?? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? fallbackDark
      : fallbackLight);
};

const useExternalLinkInteractions = ({
  containerRef,
  enabled,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled?: boolean;
}) => {
  React.useEffect(() => {
    if (enabled === false) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.getAttribute('data-openchamber-file-link') === 'true') {
        return;
      }

      const href = anchor.getAttribute('href') ?? '';
      if (!isExternalHttpUrl(href)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void openExternalUrl(href);
    };

    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [containerRef, enabled]);
};

const ExternalLinkFavicon: React.FC<{ href: string }> = ({ href }) => {
  const [failed, setFailed] = React.useState(false);
  const faviconUrl = React.useMemo(() => getExternalFaviconUrl(href), [href]);

  if (!faviconUrl || failed) {
    return null;
  }

  return (
    <span className="mr-1 inline-flex size-[18px] items-center justify-center rounded border border-[var(--border)] bg-[var(--interactive-hover)] align-middle">
      <img
        src={faviconUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="size-3.5 rounded-sm"
        onError={() => setFailed(true)}
      />
    </span>
  );
};

// Table utility functions
const extractTableData = (tableEl: HTMLTableElement): TableData => {
  const headers: string[] = [];
  const rows: string[][] = [];
  
  const thead = tableEl.querySelector('thead');
  if (thead) {
    const headerCells = thead.querySelectorAll('th');
    headerCells.forEach(cell => headers.push(cell.innerText.trim()));
  }
  
  const tbody = tableEl.querySelector('tbody');
  if (tbody) {
    const rowEls = tbody.querySelectorAll('tr');
    rowEls.forEach(row => {
      const cells = row.querySelectorAll('td');
      const rowData: string[] = [];
      cells.forEach(cell => rowData.push(cell.innerText.trim()));
      rows.push(rowData);
    });
  }
  
  return { headers, rows };
};

const downloadFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Table copy button with dropdown
const TableCopyButton: React.FC<{ tableRef: React.RefObject<HTMLDivElement | null> }> = ({ tableRef }) => {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const [showMenu, setShowMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopy = async (format: TableCopyFormat) => {
    const tableEl = tableRef.current?.querySelector('table');
    if (!tableEl) return;
    
    const data = extractTableData(tableEl);
    const content = getTableCopyContent(data, format);

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([content], { type: 'text/plain' }),
          'text/html': new Blob([tableEl.outerHTML], { type: 'text/html' }),
        }),
      ]);
      setCopied(true);
      setShowMenu(false);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      const fallbackResult = await copyTextToClipboard(content);
      if (fallbackResult.ok) {
        setCopied(true);
        setShowMenu(false);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
      console.error('Failed to copy table:', err);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="grid size-6 place-items-center rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
        title={t('markdownRenderer.table.actions.copyTitle')}
      >
        {copied ? <Icon name="check" className="size-3.5" /> : <Icon name="file-copy" className="size-3.5" />}
      </button>
      {showMenu && (
        <div className="absolute top-full right-0 z-10 mt-1 min-w-[92px] overflow-hidden rounded-md border border-border bg-background shadow-none">
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-interactive-hover/40"
            onClick={() => handleCopy('csv')}
          >
            CSV
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-interactive-hover/40"
            onClick={() => handleCopy('tsv')}
          >
            TSV
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-interactive-hover/40"
            onClick={() => handleCopy('markdown')}
          >
            Markdown
          </button>
        </div>
      )}
    </div>
  );
};

// Table download button with dropdown
const TableDownloadButton: React.FC<{ tableRef: React.RefObject<HTMLDivElement | null> }> = ({ tableRef }) => {
  const { t } = useI18n();
  const [showMenu, setShowMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

   const handleDownload = (format: 'csv' | 'markdown') => {
      const tableEl = tableRef.current?.querySelector('table');
      if (!tableEl) return;

      const data = extractTableData(tableEl);
      const content = format === 'csv' ? tableToCSV(data) : tableToMarkdown(data);
      const filename = format === 'csv' ? 'table.csv' : 'table.md';
      const mimeType = format === 'csv' ? 'text/csv' : 'text/markdown';
      downloadFile(filename, content, mimeType);
      setShowMenu(false);
      toast.success(t('markdownRenderer.table.toast.downloadedAsFormat', { format: format.toUpperCase() }));
    };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="grid size-6 place-items-center rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
        title={t('markdownRenderer.table.actions.downloadTitle')}
      >
        <Icon name="download" className="size-3.5" />
      </button>
      {showMenu && (
        <div className="absolute top-full right-0 z-10 mt-1 min-w-[92px] overflow-hidden rounded-md border border-border bg-background shadow-none">
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-interactive-hover/40"
            onClick={() => handleDownload('csv')}
          >
            CSV
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-interactive-hover/40"
            onClick={() => handleDownload('markdown')}
          >
            Markdown
          </button>
        </div>
      )}
    </div>
  );
};

// Table wrapper with custom controls
const TableWrapper: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className }) => {
  const tableRef = React.useRef<HTMLDivElement>(null);
  const { isMobile, isTablet } = useDeviceInfo();
  const alwaysShowActions = isMobile || isTablet;

  return (
    <div className="group my-3 flex flex-col gap-1" data-markdown="table-wrapper" ref={tableRef}>
      <div className={cn(
        "flex items-center justify-end gap-0.5 transition-opacity",
        alwaysShowActions ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}>
        <TableCopyButton tableRef={tableRef} />
        <TableDownloadButton tableRef={tableRef} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-[var(--surface-elevated)]">
        <table className={cn('w-full border-collapse text-sm', className)} data-markdown="table">
          {children}
        </table>
      </div>
    </div>
  );
};

const MermaidBlock: React.FC<{ source: string; mode: 'svg' | 'ascii' }> = ({ source, mode }) => {
  const { t } = useI18n();
  const currentTheme = useCurrentMermaidTheme();
  const { isMobile, isTablet } = useDeviceInfo();
  const [copied, setCopied] = React.useState(false);
  const [downloaded, setDownloaded] = React.useState(false);

  React.useEffect(() => {
    if (mode === 'ascii') {
      void loadCjkMonoFont();
    }
  }, [mode]);

  const svg = React.useMemo(() => {
    if (mode !== 'svg') return '';
    try {
      return renderMermaidSVG(source, {
        bg: currentTheme.colors.surface.elevated,
        fg: currentTheme.colors.surface.foreground,
        line: currentTheme.colors.interactive.border,
        accent: currentTheme.colors.primary.base,
        muted: currentTheme.colors.surface.mutedForeground,
        surface: currentTheme.colors.surface.muted,
        border: currentTheme.colors.interactive.border,
        transparent: true,
        font: 'IBM Plex Sans, sans-serif',
      });
    } catch {
      return '';
    }
  }, [currentTheme, mode, source]);

  const ascii = React.useMemo(() => {
    if (mode !== 'ascii') return '';
    try {
      return renderMermaidASCII(source);
    } catch {
      return '';
    }
  }, [mode, source]);

  const copyVisibilityClass = isMobile || isTablet ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';

  const handleCopyAscii = async (asciiText: string) => {
    if (!asciiText) return;
    const result = await copyTextToClipboard(asciiText);
    if (result.ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyMermaidSource = async () => {
    if (!source) return;
    const result = await copyTextToClipboard(source);
    if (result.ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadSvg = () => {
    if (!svg) return;
    try {
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `diagram-${Date.now()}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch {
      toast.error(t('markdownRenderer.mermaid.toast.downloadFailed'));
    }
  };

  if (mode === 'ascii') {
    const asciiText = ascii || source;

    return (
      <div data-markdown="mermaid-block" className="group">
        <div data-markdown="mermaid-scroll">
          <pre data-markdown="mermaid-ascii">{asciiText}</pre>
        </div>
        <div
          className={cn(
            'absolute top-1 right-2 transition-opacity',
            copyVisibilityClass,
          )}
        >
          <button
            onClick={() => handleCopyAscii(asciiText)}
            className="p-1 rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
            title={t('markdownRenderer.mermaid.actions.copyTitle')}
          >
            {copied ? <Icon name="check" className="size-3.5" /> : <Icon name="file-copy" className="size-3.5" />}
          </button>
        </div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div data-markdown="mermaid-block" className="group">
        <div data-markdown="mermaid-scroll">
          <pre data-markdown="mermaid-ascii">{source}</pre>
        </div>
        <div
          className={cn(
            'absolute top-1 right-2 transition-opacity',
            copyVisibilityClass,
          )}
        >
          <button
            onClick={() => handleCopyAscii(source)}
            className="p-1 rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
            title={t('markdownRenderer.mermaid.actions.copyTitle')}
          >
            {copied ? <Icon name="check" className="size-3.5" /> : <Icon name="file-copy" className="size-3.5" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-markdown="mermaid-block" className="group">
      <div data-markdown="mermaid-scroll">
        <div data-markdown="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <div
        className={cn(
          'absolute top-1 right-2 flex items-center gap-1 transition-opacity',
          copyVisibilityClass,
        )}
      >
        <button
          onClick={handleCopyMermaidSource}
          className="p-1 rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
          title={t('markdownRenderer.mermaid.actions.copySourceTitle')}
        >
          {copied ? <Icon name="check" className="size-3.5" /> : <Icon name="file-copy" className="size-3.5" />}
        </button>
        <button
          onClick={handleDownloadSvg}
          className="p-1 rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
          title={t('markdownRenderer.mermaid.actions.downloadSvgTitle')}
        >
          {downloaded ? <Icon name="check" className="size-3.5" /> : <Icon name="download" className="size-3.5" />}
        </button>
      </div>
    </div>
  );
};

type MermaidControlOptions = {
  download: boolean;
  copy: boolean;
  fullscreen: boolean;
  panZoom: boolean;
};

const extractMermaidBlocks = (markdown: string): string[] => {
  if (!markdown.includes('mermaid')) return [];
  const blocks: string[] = [];
  const regex = /(?:^|\r?\n)(`{3,}|~{3,})mermaid[^\n\r]*\r?\n([\s\S]*?)\r?\n\1(?=\r?\n|$)/gi;
  let match: RegExpExecArray | null = regex.exec(markdown);

  while (match) {
    const block = (match[2] ?? '').replace(/\s+$/, '');
    blocks.push(block);
    match = regex.exec(markdown);
  }

  return blocks;
};

const stripLeadingFrontmatter = (markdown: string): string => {
  const frontmatterMatch = markdown.match(
    /^(?:\uFEFF)?(---|\+\+\+)[^\S\r\n]*\r?\n[\s\S]*?\r?\n\1[^\S\r\n]*(?:\r?\n|$)/,
  );

  if (!frontmatterMatch) {
    return markdown;
  }

  return markdown.slice(frontmatterMatch[0].length);
};

export type MarkdownVariant = 'assistant' | 'tool' | 'reasoning';

type MarkdownStreamBlock = {
  key: string;
  raw: string;
  src: string;
  mode: 'full' | 'live';
};

const hasReferenceDefinitions = (text: string): boolean => {
  return /^\[[^\]]+\]:\s+\S+/m.test(text) || /^\[\^[^\]]+\]:\s+/m.test(text);
};

const hasOpenFence = (raw: string): boolean => {
  const match = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
  if (!match) return false;
  const marker = match[1];
  if (!marker) return false;
  const char = marker[0];
  const size = marker.length;
  const last = raw.trimEnd().split('\n').at(-1)?.trim() ?? '';
  return !new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(last);
};

const healMarkdown = (text: string): string => {
  return remend(text, { linkMode: 'text-only' });
};

const fnv1a32 = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16);
};

const buildMarkdownCacheKey = (baseKey: string, raw: string, index: number, mode: 'full' | 'live'): string => {
  const sample = raw.length > 400 ? `${raw.slice(0, 200)}${raw.slice(-200)}` : raw;
  return `${baseKey}:${index}:${mode}:${raw.length}:${fnv1a32(sample)}`;
};

const streamMarkdownBlocks = (text: string, live: boolean, baseKey: string): MarkdownStreamBlock[] => {
  if (!live) {
    return [{
      key: buildMarkdownCacheKey(baseKey, text, 0, 'full'),
      raw: text,
      src: text,
      mode: 'full',
    }];
  }

  const healed = healMarkdown(text);
  if (hasReferenceDefinitions(text)) {
    return [{
      key: buildMarkdownCacheKey(baseKey, text, 0, 'live'),
      raw: text,
      src: healed,
      mode: 'live',
    }];
  }

  const tokens = marked.lexer(text);
  const blocks: MarkdownStreamBlock[] = [];
  let blockIndex = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Tokens.Generic;
    if (token.type === 'space') {
      continue;
    }

    const raw = token.raw ?? '';
    const isLast = index === tokens.length - 1 || tokens.slice(index + 1).every((nextToken) => nextToken.type === 'space');
    const mode: 'full' | 'live' = isLast ? 'live' : 'full';
    const src = isLast && token.type === 'code' && hasOpenFence(raw)
      ? raw
      : healMarkdown(raw);

    blocks.push({
      key: buildMarkdownCacheKey(baseKey, raw, blockIndex, mode),
      raw,
      src,
      mode,
    });
    blockIndex += 1;
  }

  if (blocks.length === 0) {
    return [{
      key: buildMarkdownCacheKey(baseKey, text, 0, 'live'),
      raw: text,
      src: healed,
      mode: 'live',
    }];
  }

  return blocks;
};

const useStableMarkdownBlocks = (text: string, live: boolean, baseKey: string): MarkdownStreamBlock[] => {
  const previousRef = React.useRef<MarkdownStreamBlock[]>([]);

  return React.useMemo(() => {
    const nextBlocks = streamMarkdownBlocks(text, live, baseKey);
    const previousBlocks = previousRef.current;
    const stabilized = nextBlocks.map((block, index) => {
      const previous = previousBlocks[index];
      if (previous && previous.key === block.key && previous.src === block.src) {
        return previous;
      }
      return block;
    });

    const unchanged = stabilized.length === previousBlocks.length
      && stabilized.every((block, index) => block === previousBlocks[index]);

    if (unchanged) {
      return previousBlocks;
    }

    previousRef.current = stabilized;
    return stabilized;
  }, [baseKey, live, text]);
};

const extractCodeText = (children: React.ReactNode): string => {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    return children.map((child) => extractCodeText(child)).join('');
  }
  if (React.isValidElement(children)) {
    return extractCodeText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
};

const getCodeLanguage = (className: string | undefined): string => {
  const match = className?.match(/language-([\w-]+)/);
  return match?.[1]?.toLowerCase() ?? 'text';
};

const decodeHtmlEntities = (value: string): string => {
  let decoded = value;
  for (let i = 0; i < 3; i += 1) {
    const next = decoded
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    if (next === decoded) {
      return decoded;
    }
    decoded = next;
  }
  return decoded;
};

const normalizeCodeBlockText = (code: string, language: string): string => {
  if (!['json', 'jsonc', 'json5'].includes(language)) {
    return code;
  }
  if (!/&(quot|#34|amp;quot|lt|gt|amp|apos|#39);/.test(code)) {
    return code;
  }
  return decodeHtmlEntities(code);
};

const CODE_HIGHLIGHT_SETTLE_MS = 300;
const CODE_HIGHLIGHT_LINE_LIMIT = 1200;
const VSCODE_CODE_HIGHLIGHT_LINE_LIMIT = 200;
const MARKDOWN_RENDERER_VERSION = 'terminal-cells-debug-v2';
const exceedsLineLimit = (value: string, limit: number): boolean => {
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      lineCount += 1;
      if (lineCount > limit) {
        return true;
      }
    }
  }
  return false;
};

const getCodeHighlightLineLimit = (): number => (
  isVSCodeRuntime() ? VSCODE_CODE_HIGHLIGHT_LINE_LIMIT : CODE_HIGHLIGHT_LINE_LIMIT
);

const BLOCK_CODE_MARKER_PATTERN = /```|~~~|<pre\b/i;

const useCjkMonoFontForBlockCode = (content: string) => {
  const hasBlockCode = React.useMemo(() => BLOCK_CODE_MARKER_PATTERN.test(content), [content]);

  React.useEffect(() => {
    if (!hasBlockCode) {
      return;
    }

    void loadCjkMonoFont();
  }, [hasBlockCode]);
};

const EMOJI_PRESENTATION_PATTERN = /\p{Emoji_Presentation}/u;
const COMBINING_MARK_PATTERN = /^\p{Mark}+$/u;
const TERMINAL_CELL_RENDER_LIMIT = 20000;

type GraphemeSegmenter = {
  segment(value: string): Iterable<{ segment: string }>;
};

const getGraphemeSegments = (value: string): string[] => {
  const segmenterCtor = (Intl as typeof Intl & {
    Segmenter?: new (locale: string | undefined, options: { granularity: 'grapheme' }) => GraphemeSegmenter;
  }).Segmenter;

  if (segmenterCtor) {
    return Array.from(new segmenterCtor(undefined, { granularity: 'grapheme' }).segment(value), (part) => part.segment);
  }

  return Array.from(value);
};

const isWideEmojiSegment = (segment: string): boolean => EMOJI_PRESENTATION_PATTERN.test(segment);

const isWideCodePoint = (codePoint: number): boolean => (
  (codePoint >= 0x1100 && codePoint <= 0x115f) ||
  codePoint === 0x2329 ||
  codePoint === 0x232a ||
  (codePoint >= 0x2460 && codePoint <= 0x24ff) ||
  (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
  (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
  (codePoint >= 0xff00 && codePoint <= 0xff60) ||
  (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
  (codePoint >= 0x1f300 && codePoint <= 0x1faff)
);

const getTerminalCellWidth = (segment: string): 0 | 1 | 2 => {
  if (!segment) return 0;
  if (isWideEmojiSegment(segment)) return 2;
  if (COMBINING_MARK_PATTERN.test(segment)) return 0;

  const codePoint = segment.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
};

const renderMonospaceTextCode = (value: string): React.ReactNode[] => {
  const segments = getGraphemeSegments(value);
  if (segments.length > TERMINAL_CELL_RENDER_LIMIT) {
    return [value];
  }

  const nodes: React.ReactNode[] = [];

  segments.forEach((segment, index) => {
    if (segment === '\n') {
      nodes.push(segment);
      return;
    }

    const width = getTerminalCellWidth(segment);
    const emoji = isWideEmojiSegment(segment);
    nodes.push(
      <span
        key={`cell-${index}`}
        data-openchamber-code-cell={width}
        data-openchamber-code-renderer="terminal-cell"
      >
        {emoji ? (
          <span data-openchamber-code-wide-emoji="true">{segment}</span>
        ) : segment}
      </span>
    );
  });

  return nodes;
};

const shouldRenderCodeAsPlainText = (language: string): boolean => (
  language === 'text' || language === 'txt' || language === 'plain' || language === 'plaintext'
);

const downloadTextFile = (content: string, filename: string, mimeType: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    // Best-effort; callers can optionally toast.
  }
};

const MarkdownCodeBlock: React.FC<{
  code: string;
  language: string;
  syntaxTheme: { [key: string]: React.CSSProperties };
}> = ({ code, language, syntaxTheme }) => {
  const [copied, setCopied] = React.useState(false);
  const [highlight, setHighlight] = React.useState(true);
  const [viewMode, setViewMode] = React.useState<'code' | 'preview'>('code');
  const prevCodeRef = React.useRef<string>(code);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isMobile, isTablet } = useDeviceInfo();
  const skipHighlight = exceedsLineLimit(code, getCodeHighlightLineLimit());

  const canPreview = language === 'html' || language === 'htm';
  const renderAsPlainText = shouldRenderCodeAsPlainText(language);

  React.useEffect(() => {
    void loadCjkMonoFont();
  }, []);

  React.useEffect(() => {
    if (!canPreview && viewMode !== 'code') {
      setViewMode('code');
    }
  }, [canPreview, viewMode]);

  // Defer Prism highlighting while code is actively streaming.
  // Initial mount renders highlighted immediately (plays nice with finalized blocks).
  React.useEffect(() => {
    if (prevCodeRef.current === code) return;
    prevCodeRef.current = code;

    if (timerRef.current) clearTimeout(timerRef.current);
    setHighlight(false);
    timerRef.current = setTimeout(() => {
      setHighlight(true);
      timerRef.current = null;
    }, CODE_HIGHLIGHT_SETTLE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [code]);

  const handleCopy = React.useCallback(async () => {
    const result = await copyTextToClipboard(code);
    if (!result.ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleDownload = React.useCallback(() => {
    if (!canPreview) {
      return;
    }

    const safeSuffix = Date.now().toString(36);
    downloadTextFile(code, `preview-${safeSuffix}.html`, 'text/html;charset=utf-8');
  }, [canPreview, code]);

  return (
    <div data-component="markdown-code" className="my-3 group overflow-hidden rounded-lg border border-border/70 bg-[var(--surface-elevated)]">
      <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1">
        <span className="font-mono text-[12px] text-muted-foreground">{language}</span>
        <div className={cn(
          "flex items-center gap-1 transition-opacity",
          isMobile || isTablet ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
        )}>
          {canPreview ? (
            <button
              type="button"
              onClick={() => setViewMode((mode) => (mode === 'preview' ? 'code' : 'preview'))}
              className="grid size-6 place-items-center rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
              title={viewMode === 'preview' ? 'Show code' : 'Preview'}
              aria-pressed={viewMode === 'preview'}
              aria-label={viewMode === 'preview' ? 'Show code' : 'Preview HTML'}
            >
              {viewMode === 'preview' ? <Icon name="code" className="size-3.5" /> : <Icon name="eye" className="size-3.5" />}
            </button>
          ) : null}
          {canPreview ? (
            <button
              type="button"
              onClick={handleDownload}
              className="grid size-6 place-items-center rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
              title="Download HTML"
              aria-label="Download HTML"
            >
              <Icon name="download" className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => { void handleCopy(); }}
            className="grid size-6 place-items-center rounded hover:bg-interactive-hover/60 text-muted-foreground hover:text-foreground transition-colors"
            title={copied ? 'Copied' : 'Copy code'}
            aria-label={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? <Icon name="check" className="size-3.5" /> : <Icon name="file-copy" className="size-3.5" />}
          </button>
        </div>
      </div>
      {canPreview && viewMode === 'preview' ? (
        <div className="h-[320px] md:h-[420px] bg-background">
          <iframe
            srcDoc={code}
            title="HTML preview"
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
          />
        </div>
      ) : (
        <div data-component="markdown-code-body" className={MARKDOWN_CODE_BODY_CLASSNAME}>
          {highlight && !skipHighlight && !renderAsPlainText ? (
            <SyntaxHighlighter
              language={language}
              style={syntaxTheme}
              customStyle={CODE_SHARED_STYLE}
              codeTagProps={{ style: CODE_SHARED_STYLE }}
              PreTag="pre"
            >
              {code}
            </SyntaxHighlighter>
          ) : (
            <pre
              style={CODE_SHARED_STYLE}
              data-openchamber-code-renderer={renderAsPlainText ? 'terminal-cell' : 'plain'}
              data-openchamber-code-language={language}
            >
              <code
                style={CODE_SHARED_STYLE}
                data-openchamber-code-renderer={renderAsPlainText ? 'terminal-cell' : 'plain'}
                data-openchamber-code-language={language}
              >
                {renderAsPlainText ? renderMonospaceTextCode(code) : code}
              </code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

const buildMarkdownComponents = ({
  syntaxTheme,
  onPreviewLoopback,
  previewLabel,
  previewTitle,
  localImageContext,
  onShowPopup,
}: {
  syntaxTheme: { [key: string]: React.CSSProperties };
  onPreviewLoopback?: (url: string) => void;
  previewLabel?: string;
  previewTitle?: string;
  localImageContext?: {
    effectiveDirectory: string;
    fileReferenceBaseUrl?: string;
  };
  onShowPopup?: (content: ToolPopupContent) => void;
}): Components => ({
  table({ children, ...props }) {
    return <TableWrapper className={props.className}>{children}</TableWrapper>;
  },
  h1({ children, ...props }) {
    return <h1 {...props} className={cn('typography-markdown-h1 mt-4 mb-2 text-[var(--markdown-heading1,var(--primary))] font-semibold', props.className)}>{children}</h1>;
  },
  h2({ children, ...props }) {
    return <h2 {...props} className={cn('typography-markdown-h2 mt-3.5 mb-1.5 text-[var(--markdown-heading2,var(--primary))] font-semibold', props.className)}>{children}</h2>;
  },
  h3({ children, ...props }) {
    return <h3 {...props} className={cn('typography-markdown-h3 mt-3 mb-1 text-[var(--markdown-heading3,var(--primary))] font-semibold', props.className)}>{children}</h3>;
  },
  h4({ children, ...props }) {
    return <h4 {...props} className={cn('typography-markdown-h4 mt-2.5 mb-1 text-[var(--markdown-heading4,var(--foreground))] font-semibold', props.className)}>{children}</h4>;
  },
  h5({ children, ...props }) {
    return <h5 {...props} className={cn('typography-markdown-h4 mt-2.5 mb-1 text-[var(--markdown-heading4,var(--foreground))] font-semibold', props.className)}>{children}</h5>;
  },
  h6({ children, ...props }) {
    return <h6 {...props} className={cn('typography-markdown-h4 mt-2.5 mb-1 text-[var(--markdown-heading4,var(--foreground))] font-semibold', props.className)}>{children}</h6>;
  },
  p({ children, ...props }) {
    return <p {...props} className={cn('typography-markdown-body my-2 text-foreground/90', props.className)}>{children}</p>;
  },
  thead({ children, ...props }) {
    return <thead {...props} className={cn('[&_tr]:border-b [&_tr]:border-border/80', props.className)}>{children}</thead>;
  },
  tbody({ children, ...props }) {
    return <tbody {...props} className={cn('[&_tr:last-child]:border-0', props.className)}>{children}</tbody>;
  },
  tr({ children, ...props }) {
    return <tr {...props} className={cn('border-b border-border/60', props.className)}>{children}</tr>;
  },
  th({ children, ...props }) {
    return <th {...props} className={cn('border-r border-border/60 px-3 py-2 text-left align-middle font-semibold text-foreground last:border-r-0', props.className)}>{children}</th>;
  },
  td({ children, ...props }) {
    return <td {...props} className={cn('border-r border-border/60 px-3 py-2 align-middle text-foreground/90 last:border-r-0', props.className)}>{children}</td>;
  },
  ul({ children, ...props }) {
    return <ul {...props} className={cn('typography-markdown-body my-2', props.className)}>{children}</ul>;
  },
  ol({ children, ...props }) {
    return <ol {...props} className={cn('typography-markdown-body my-2', props.className)}>{children}</ol>;
  },
  li({ children, ...props }) {
    return <li {...props} className={cn('typography-markdown-body my-0.5 text-foreground/90', props.className)}>{children}</li>;
  },
  blockquote({ children, ...props }) {
    return <blockquote {...props} className={cn('my-3 border-l-2 border-[var(--markdown-blockquote-border,var(--border))] pl-4 typography-markdown-body text-[var(--markdown-blockquote,var(--muted-foreground))]', props.className)}>{children}</blockquote>;
  },
  pre({ children, ...props }) {
    const child = React.Children.only(children) as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
    const className = child.props.className;
    const language = getCodeLanguage(className);
    const code = normalizeCodeBlockText(extractCodeText(child.props.children).replace(/\n$/, ''), language);
    if (language === 'mermaid') {
      return <MermaidBlock source={code} mode={useUIStore.getState().mermaidRenderingMode} />;
    }
    return <MarkdownCodeBlock code={code} language={language} syntaxTheme={syntaxTheme} {...props} />;
  },
  code({ className, children, ...props }) {
    return (
      <code
        {...props}
        className={cn('rounded bg-[var(--surface-elevated)] px-1 py-0.5 font-mono text-[0.95em]', className)}
        data-markdown="inline-code"
      >
        {children}
      </code>
    );
  },
  img({ src, alt, ...props }) {
    const rawSrc = typeof src === 'string' ? src : '';
    const localImage = localImageContext
      ? resolveMarkdownImageReference(rawSrc, localImageContext.effectiveDirectory, localImageContext.fileReferenceBaseUrl)
      : null;
    const hasLocalImagePreview = Boolean(localImage && onShowPopup);
    const imageFilename = localImage
      ? getFileNameFromPath(localImage.resolvedPath) || (typeof alt === 'string' && alt.trim() ? alt.trim() : 'Image')
      : '';
    const imageActionLabel = hasLocalImagePreview ? 'Preview image' : 'Open image file';
    const title = typeof props.title === 'string' && props.title.trim()
      ? `${props.title.trim()} - ${imageActionLabel}`
      : imageActionLabel;
    const accessibleName = typeof alt === 'string' && alt.trim()
      ? `${imageActionLabel}: ${alt.trim()}`
      : imageActionLabel;
    const localImageProps = localImage
      ? {
          role: 'button' as const,
          tabIndex: 0,
          title,
          'aria-label': accessibleName,
          'data-openchamber-file-link': 'true',
          'data-openchamber-file-ref': localImage.source,
          'data-openchamber-file-path': localImage.resolvedPath,
          'data-openchamber-file-status': 'pending',
          ...(hasLocalImagePreview
            ? {
                'data-openchamber-image-preview': 'true',
                'data-openchamber-image-url': localImage.rawUrl,
                'data-openchamber-image-filename': imageFilename,
                'data-openchamber-image-directory': getContextDirectory(localImageContext?.effectiveDirectory ?? '', localImage.resolvedPath),
              }
            : {}),
        }
      : {};

    return (
      <span data-openchamber-markdown-image-frame="true">
        <img
          {...props}
          {...localImageProps}
          src={localImage?.rawUrl ?? rawSrc}
          alt={alt ?? ''}
          loading={props.loading ?? 'lazy'}
          decoding={props.decoding ?? 'async'}
          data-openchamber-markdown-image="true"
          className={cn(
            'box-border h-auto w-auto rounded-md border border-border/40 bg-[var(--surface-elevated)] object-contain',
            localImage && 'transition-[border-color] hover:border-[var(--interactive-border)]',
            localImage && (hasLocalImagePreview ? 'cursor-zoom-in' : 'cursor-pointer'),
            props.className,
          )}
        />
      </span>
    );
  },
  a({ href, children, ...props }) {
    const targetHref = href ?? '';
    const isExternal = isExternalHttpUrl(targetHref);
    const isLoopback = onPreviewLoopback ? isLoopbackHttpUrl(targetHref) : false;
    return (
      <>
        <a
          {...props}
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
        >
          {isExternal ? <ExternalLinkFavicon href={targetHref} /> : null}
          {children}
        </a>
        {isLoopback && onPreviewLoopback ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPreviewLoopback(targetHref);
            }}
            className="ml-1 inline-flex h-5 items-center gap-0.5 rounded border border-[var(--border)] bg-[var(--surface-background)] px-1.5 align-middle text-[11px] leading-none text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            aria-label={previewTitle ?? previewLabel ?? 'Open preview pane'}
            title={previewTitle ?? previewLabel ?? 'Open preview pane'}
            data-loopback-preview-trigger="true"
          >
            <Icon name="eye" className="size-3"  aria-hidden="true"/>
            <span className="font-medium">{previewLabel ?? 'Preview'}</span>
          </button>
        ) : null}
      </>
    );
  },
});

const MarkdownBlockView: React.FC<{
  block: MarkdownStreamBlock;
  components: Components;
}> = React.memo(({ block, components }) => {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: 'var(--destructive)' }]]} components={components}>
      {block.src}
    </ReactMarkdown>
  );
}, (prev, next) => prev.block === next.block && prev.components === next.components);

MarkdownBlockView.displayName = 'MarkdownBlockView';

interface MarkdownRendererProps {
  content: string;
  sessionId?: string;
  part?: Part;
  messageId: string;
  isAnimated?: boolean;
  skipFadeIn?: boolean;
  className?: string;
  isStreaming?: boolean;
  disableStreamAnimation?: boolean;
  variant?: MarkdownVariant;
  onShowPopup?: (content: ToolPopupContent) => void;
  enableFileReferences?: boolean;
}

const MERMAID_BLOCK_SELECTOR = '[data-markdown="mermaid-block"]';
const FILE_LINK_SELECTOR = '[data-openchamber-file-link="true"]';
const FILE_REFERENCE_SELECTOR = '[data-openchamber-file-link="true"], [data-openchamber-file-status], [data-openchamber-original-href]';
const IMAGE_PREVIEW_SELECTOR = '[data-openchamber-image-preview="true"]';
const ORIGINAL_HREF_ATTRIBUTE = 'data-openchamber-original-href';
const FILE_REFERENCE_STAT_CACHE_MAX = 1000;
const VSCODE_FILE_REFERENCE_STAT_CACHE_MAX = 200;
const FILE_REFERENCE_LINK_LIMIT = 200;
const VSCODE_FILE_REFERENCE_LINK_LIMIT = 40;
const FILE_REFERENCE_STAT_CACHE = new Map<string, Promise<boolean | null>>();

const getFileReferenceStatCacheMax = (): number => (
  isVSCodeRuntime() ? VSCODE_FILE_REFERENCE_STAT_CACHE_MAX : FILE_REFERENCE_STAT_CACHE_MAX
);

const getFileReferenceLinkLimit = (): number => (
  isVSCodeRuntime() ? VSCODE_FILE_REFERENCE_LINK_LIMIT : FILE_REFERENCE_LINK_LIMIT
);

const resolveRemoteServerIdForDirectory = (directory: string): string | undefined => {
  const normalizedDirectory = normalizePath(directory);
  if (!normalizedDirectory) {
    return undefined;
  }

  let best: { serverId: string; length: number } | null = null;
  const projects = useProjectsStore.getState().projects;
  for (const project of projects) {
    const serverId = typeof project.serverId === 'string' ? project.serverId.trim() : '';
    if (!serverId || serverId === DEFAULT_SERVER_ID) {
      continue;
    }

    const projectPath = normalizePath(project.path);
    if (!projectPath) {
      continue;
    }

    if (normalizedDirectory !== projectPath && !normalizedDirectory.startsWith(`${projectPath}/`)) {
      continue;
    }

    if (!best || projectPath.length > best.length) {
      best = { serverId, length: projectPath.length };
    }
  }

  return best?.serverId;
};

const resolveFileReferenceBaseUrl = (sessionId?: string | null, directory?: string): string => {
  const sessionServerId = sessionId ? serverRegistry.getServerForSession(sessionId) : undefined;
  const serverId = sessionServerId && sessionServerId !== DEFAULT_SERVER_ID
    ? sessionServerId
    : directory
      ? resolveRemoteServerIdForDirectory(directory)
      : undefined;

  if (!serverId || serverId === DEFAULT_SERVER_ID) {
    return '';
  }

  return serverRegistry.get(serverId)?.config.baseUrl ?? `/api/remote/${encodeURIComponent(serverId)}`;
};

const extractPathCandidateFromElement = (element: HTMLElement): string => {
  if (element.tagName.toLowerCase() === 'a') {
    const originalHref = element.getAttribute(ORIGINAL_HREF_ATTRIBUTE)?.trim();
    if (originalHref && isLikelyFilePath(originalHref)) {
      return originalHref;
    }

    const href = element.getAttribute('href')?.trim();
    if (href && isLikelyFilePath(href)) {
      return href;
    }
  }

  return (element.textContent || '').trim();
};

const toComparableReferencePath = (value: string): string => {
  return /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
};

const isResolvedPathWithinDirectory = (resolvedPath: string, directory: string): boolean => {
  const normalizedPath = normalizePath(resolvedPath);
  const normalizedDirectory = normalizePath(directory);
  if (!normalizedPath || !normalizedDirectory) {
    return false;
  }

  const comparablePath = toComparableReferencePath(normalizedPath);
  const comparableDirectory = toComparableReferencePath(normalizedDirectory);
  return comparablePath === comparableDirectory || comparablePath.startsWith(`${comparableDirectory}/`);
};

const buildFileRawUrl = (resolvedPath: string, effectiveDirectory: string, fileReferenceBaseUrl?: string): string => {
  const normalizedDirectory = normalizePath(effectiveDirectory);
  const params = new URLSearchParams({ path: resolvedPath });
  if (normalizedDirectory && isResolvedPathWithinDirectory(resolvedPath, normalizedDirectory)) {
    params.set('directory', normalizedDirectory);
  } else {
    params.set('allowOutsideWorkspace', 'true');
  }
  return `${resolveApiUrl('/api/fs/raw', fileReferenceBaseUrl)}?${params.toString()}`;
};

const resolveMarkdownImageReference = (
  rawSrc: string,
  effectiveDirectory: string,
  fileReferenceBaseUrl?: string,
): { source: string; resolvedPath: string; rawUrl: string } | null => {
  const source = normalizeMarkdownImageSource(rawSrc);
  if (!source || isExternalHttpUrl(source) || source.startsWith('data:') || source.startsWith('blob:')) {
    return null;
  }

  const parsed = parseFileReference(source);
  if (!parsed || !isLikelyFilePathValue(parsed.path) || !isLikelyImageFilePath(parsed.path)) {
    return null;
  }

  const normalizedDirectory = normalizePath(effectiveDirectory);
  if (!isAbsolutePath(parsed.path) && !normalizedDirectory) {
    return null;
  }

  const resolvedPath = isAbsolutePath(parsed.path)
    ? normalizePath(parsed.path)
    : toAbsolutePath(normalizedDirectory, parsed.path);
  if (!resolvedPath || !isAbsolutePath(resolvedPath)) {
    return null;
  }

  return {
    source,
    resolvedPath,
    rawUrl: buildFileRawUrl(resolvedPath, normalizedDirectory, fileReferenceBaseUrl),
  };
};

const getContextDirectory = (effectiveDirectory: string, resolvedPath: string): string => {
  return getDirectoryForFilePath(effectiveDirectory, resolvedPath);
};

const fileReferenceExists = (path: string, fileReferenceBaseUrl?: string): Promise<boolean | null> => {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) {
    return Promise.resolve(false);
  }

  const cacheKey = `${fileReferenceBaseUrl ?? ''}\n${normalizedPath}`;
  const cached = FILE_REFERENCE_STAT_CACHE.get(cacheKey);
  if (cached) {
    FILE_REFERENCE_STAT_CACHE.delete(cacheKey);
    FILE_REFERENCE_STAT_CACHE.set(cacheKey, cached);
    return cached;
  }

  const request = (async () => {
    try {
      const params = new URLSearchParams({
        path: normalizedPath,
        allowOutsideWorkspace: 'true',
      });
      const res = await fetch(`${resolveApiUrl('/api/fs/stat', fileReferenceBaseUrl)}?${params.toString()}`);
      return res.ok;
    } catch {
      return null;
    }
  })();

  const maxCacheEntries = getFileReferenceStatCacheMax();
  while (FILE_REFERENCE_STAT_CACHE.size >= maxCacheEntries) {
    const oldest = FILE_REFERENCE_STAT_CACHE.keys().next().value;
    if (typeof oldest !== 'string') {
      break;
    }
    FILE_REFERENCE_STAT_CACHE.delete(oldest);
  }
  FILE_REFERENCE_STAT_CACHE.set(cacheKey, request);
  return request;
};

const useFileReferenceInteractions = ({
  containerRef,
  effectiveDirectory,
  fileReferenceBaseUrl,
  editor,
  preferRuntimeEditor,
  enabled,
  onShowPopup,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  effectiveDirectory: string;
  fileReferenceBaseUrl?: string;
  editor?: EditorAPI;
  preferRuntimeEditor?: boolean;
  enabled: boolean;
  onShowPopup?: (content: ToolPopupContent) => void;
}) => {
  const { t } = useI18n();
  const tRef = React.useRef(t);
  tRef.current = t;
  const annotationDebounceRef = React.useRef<number | null>(null);
  const validationResultsRef = React.useRef<Map<string, boolean>>(new Map());
  const validationContextRef = React.useRef('');
  const validateDebounceRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const fileReferenceLinkLimit = getFileReferenceLinkLimit();

    const validationContext = `${fileReferenceBaseUrl ?? ''}|${effectiveDirectory}`;
    if (validationContextRef.current !== validationContext) {
      validationResultsRef.current.clear();
      validationContextRef.current = validationContext;
    }

    const removeMissingBadge = (candidate: HTMLElement) => {
      const nextSibling = candidate.nextElementSibling;
      if (nextSibling?.classList.contains('oc-file-missing-badge')) {
        nextSibling.remove();
      }
    };

    const clearFileLinkAttributes = (candidate: HTMLElement) => {
      const originalHref = candidate.getAttribute(ORIGINAL_HREF_ATTRIBUTE);
      if (candidate instanceof HTMLAnchorElement && originalHref !== null) {
        candidate.setAttribute('href', originalHref);
      }
      candidate.removeAttribute(ORIGINAL_HREF_ATTRIBUTE);
      candidate.removeAttribute('data-openchamber-file-link');
      candidate.removeAttribute('data-openchamber-file-ref');
      candidate.removeAttribute('data-openchamber-file-path');
      candidate.removeAttribute('data-openchamber-file-status');
      candidate.removeAttribute('data-openchamber-image-preview');
      candidate.removeAttribute('data-openchamber-image-url');
      candidate.removeAttribute('data-openchamber-image-filename');
      candidate.removeAttribute('data-openchamber-image-directory');
      candidate.removeAttribute('aria-disabled');
      if (candidate.getAttribute('title') === 'Open file') {
        candidate.removeAttribute('title');
      }
      candidate.removeAttribute('role');
      candidate.removeAttribute('tabindex');
    };

    const disableAnchorNavigation = (candidate: HTMLElement) => {
      if (!(candidate instanceof HTMLAnchorElement)) {
        return;
      }

      const href = candidate.getAttribute('href');
      if (href !== null && candidate.getAttribute(ORIGINAL_HREF_ATTRIBUTE) === null) {
        candidate.setAttribute(ORIGINAL_HREF_ATTRIBUTE, href);
      }
      candidate.removeAttribute('href');
      candidate.setAttribute('aria-disabled', 'true');
    };

    const ensureMissingBadge = (candidate: HTMLElement, note: string) => {
      const nextSibling = candidate.nextElementSibling;
      if (nextSibling?.classList.contains('oc-file-missing-badge')) {
        return;
      }

      const badge = document.createElement('span');
      badge.className = 'oc-file-missing-badge';
      badge.setAttribute('aria-label', note);
      badge.textContent = '✗';
      candidate.insertAdjacentElement('afterend', badge);
    };

    const demoteMissingFileReference = (candidate: HTMLElement, rawCandidate: string, resolvedPath: string, note: string) => {
      const alreadyDemoted = candidate.getAttribute('data-openchamber-file-status') === 'missing'
        && candidate.getAttribute('data-openchamber-file-link') !== 'true'
        && candidate.getAttribute('data-openchamber-file-ref') === rawCandidate
        && candidate.getAttribute('data-openchamber-file-path') === resolvedPath;

      if (!alreadyDemoted) {
        candidate.removeAttribute('data-openchamber-file-link');
        candidate.setAttribute('data-openchamber-file-ref', rawCandidate);
        candidate.setAttribute('data-openchamber-file-path', resolvedPath);
        candidate.setAttribute('data-openchamber-file-status', 'missing');
        candidate.removeAttribute('data-openchamber-image-preview');
        candidate.removeAttribute('data-openchamber-image-url');
        candidate.removeAttribute('data-openchamber-image-filename');
        candidate.removeAttribute('data-openchamber-image-directory');
        if (candidate.getAttribute('title') === 'Open file') {
          candidate.removeAttribute('title');
        }
        candidate.removeAttribute('role');
        candidate.removeAttribute('tabindex');
        disableAnchorNavigation(candidate);
      }
      ensureMissingBadge(candidate, note);
    };

    const openImagePreview = (sourceElement: HTMLElement): boolean => {
      if (!onShowPopup || sourceElement.getAttribute('data-openchamber-image-preview') !== 'true') {
        return false;
      }

      const imageUrl = sourceElement.getAttribute('data-openchamber-image-url');
      const filePath = sourceElement.getAttribute('data-openchamber-file-path');
      if (!imageUrl || !filePath) {
        return false;
      }

      const galleryElements = Array
        .from(container.querySelectorAll<HTMLElement>(`${FILE_LINK_SELECTOR}${IMAGE_PREVIEW_SELECTOR}`))
        .filter((element) => element.getAttribute('data-openchamber-file-status') !== 'missing');
      const gallery = galleryElements.flatMap((element) => {
        const url = element.getAttribute('data-openchamber-image-url');
        const path = element.getAttribute('data-openchamber-file-path');
        if (!url || !path) {
          return [];
        }

        const directory = element.getAttribute('data-openchamber-image-directory')
          || getContextDirectory(effectiveDirectory, path);
        return [{
          url,
          filename: element.getAttribute('data-openchamber-image-filename') || getFileNameFromPath(path) || 'Image',
          filePath: path,
          directory,
        }];
      });
      const sourceIndex = galleryElements.indexOf(sourceElement);
      const galleryIndex = sourceIndex >= 0 ? sourceIndex : 0;
      const filename = sourceElement.getAttribute('data-openchamber-image-filename') || getFileNameFromPath(filePath) || 'Image';
      const directory = sourceElement.getAttribute('data-openchamber-image-directory')
        || getContextDirectory(effectiveDirectory, filePath);

      onShowPopup({
        open: true,
        title: filename,
        content: '',
        metadata: {
          tool: 'image-preview',
          filename,
          filePath,
          directory,
        },
        image: {
          url: imageUrl,
          filename,
          filePath,
          directory,
          gallery,
          index: galleryIndex,
        },
      });
      return true;
    };

    const clearAnnotatedFileLinks = () => {
      const annotated = container.querySelectorAll<HTMLElement>(FILE_REFERENCE_SELECTOR);
      for (const candidate of Array.from(annotated)) {
        clearFileLinkAttributes(candidate);
        removeMissingBadge(candidate);
      }
    };

    if (!enabled) {
      clearAnnotatedFileLinks();
      return;
    }

    const annotateFileLinks = () => {
      const candidates = container.querySelectorAll<HTMLElement>('[data-markdown="inline-code"], a');
      let linkedCount = 0;
      const note = tRef.current('chat.file.notFound');

      for (const candidate of Array.from(candidates)) {
        const rawCandidate = extractPathCandidateFromElement(candidate);
        const resolved = getResolvedReference(rawCandidate, effectiveDirectory);
        const knownValidation = resolved
          ? validationResultsRef.current.get(resolved.resolvedPath)
          : undefined;
        if (
          resolved
          && knownValidation === false
          && candidate.getAttribute('data-openchamber-file-status') === 'missing'
          && candidate.getAttribute('data-openchamber-file-link') !== 'true'
        ) {
          ensureMissingBadge(candidate, note);
          continue;
        }

        candidate.removeAttribute('data-openchamber-file-status');
        clearFileLinkAttributes(candidate);

        if (!resolved) {
          removeMissingBadge(candidate);
          continue;
        }

        if (knownValidation === false) {
          demoteMissingFileReference(candidate, rawCandidate, resolved.resolvedPath, note);
          continue;
        }

        if (linkedCount >= fileReferenceLinkLimit) {
          removeMissingBadge(candidate);
          continue;
        }

        linkedCount += 1;
        candidate.setAttribute('data-openchamber-file-link', 'true');
        candidate.setAttribute('data-openchamber-file-ref', rawCandidate);
        candidate.setAttribute('data-openchamber-file-path', resolved.resolvedPath);
        candidate.setAttribute('data-openchamber-file-status', knownValidation === true ? 'valid' : 'pending');
        candidate.setAttribute('title', 'Open file');
        if (candidate.tagName.toLowerCase() !== 'a') {
          candidate.setAttribute('role', 'button');
          candidate.setAttribute('tabindex', '0');
        }
      }
    };

    const validateFileLinks = async () => {
      const container = containerRef.current;
      if (!container) return;

      const pending = container.querySelectorAll<HTMLElement>('[data-openchamber-file-status="pending"]');
      if (pending.length === 0) return;

      const pathsToCheck = new Map<string, HTMLElement[]>();
      const note = tRef.current('chat.file.notFound');
      for (const el of pending) {
        if (!el.isConnected) continue;
        const path = el.getAttribute('data-openchamber-file-path');
        if (!path) continue;
        const knownValidation = validationResultsRef.current.get(path);
        if (knownValidation === true) {
          el.setAttribute('data-openchamber-file-status', 'valid');
          removeMissingBadge(el);
          continue;
        }
        if (knownValidation === false) {
          demoteMissingFileReference(
            el,
            el.getAttribute('data-openchamber-file-ref') || extractPathCandidateFromElement(el),
            path,
            note,
          );
          continue;
        }
        if (!pathsToCheck.has(path)) pathsToCheck.set(path, []);
        pathsToCheck.get(path)!.push(el);
      }

      if (pathsToCheck.size === 0) return;

      const results = await Promise.allSettled(
        Array.from(pathsToCheck.keys()).map(async (path) => {
          const ok = await fileReferenceExists(path, fileReferenceBaseUrl);
          return { path, ok };
        })
      );

      for (const result of results) {
        if (result.status === 'rejected') continue;
        const { path, ok } = result.value;

        if (ok === null) {
          continue;
        }

        const elements = pathsToCheck.get(path) || [];
        validationResultsRef.current.set(path, ok);

        for (const el of elements) {
          if (!el.isConnected) continue;
          if (ok) {
            el.setAttribute('data-openchamber-file-status', 'valid');
            removeMissingBadge(el);
          } else {
            demoteMissingFileReference(
              el,
              el.getAttribute('data-openchamber-file-ref') || extractPathCandidateFromElement(el),
              path,
              note,
            );
          }
        }
      }
    };

    const openFileReference = (sourceElement: HTMLElement) => {
      const raw = sourceElement.getAttribute('data-openchamber-file-ref') || extractPathCandidateFromElement(sourceElement);
      const resolved = getResolvedReference(raw, effectiveDirectory);
      if (!resolved) {
        return;
      }

      const contextDirectory = getContextDirectory(effectiveDirectory, resolved.resolvedPath);
      if (preferRuntimeEditor && editor) {
        void editor.openFile(
          resolved.resolvedPath,
          Number.isFinite(resolved.line ?? Number.NaN)
            ? Math.max(1, Math.trunc(resolved.line as number))
            : undefined,
          Number.isFinite(resolved.column ?? Number.NaN)
            ? Math.max(1, Math.trunc(resolved.column as number))
            : undefined,
        );
        return;
      }

      const uiStore = useUIStore.getState();
      if (Number.isFinite(resolved.line ?? Number.NaN)) {
        uiStore.openContextPanelTab(contextDirectory, { mode: 'file', targetPath: resolved.resolvedPath });
        uiStore.setPendingFileFocusPath(null);
        uiStore.setPendingFileNavigation({
          path: resolved.resolvedPath,
          line: Math.max(1, Math.trunc(resolved.line as number)),
          column: Number.isFinite(resolved.column ?? Number.NaN)
            ? Math.max(1, Math.trunc(resolved.column as number))
            : 1,
        });
      } else {
        uiStore.openContextPanelTab(contextDirectory, { mode: 'file', targetPath: resolved.resolvedPath });
        uiStore.setPendingFileFocusPath(resolved.resolvedPath);
        uiStore.setPendingFileNavigation(null);
      }
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const fileRefElement = target.closest(FILE_LINK_SELECTOR);
      if (!(fileRefElement instanceof HTMLElement)) {
        return;
      }

      if (fileRefElement.getAttribute('data-openchamber-file-status') === 'missing') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (openImagePreview(fileRefElement)) {
        return;
      }

      openFileReference(fileRefElement);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement) || target.getAttribute('data-openchamber-file-link') !== 'true') {
        return;
      }

      if (target.getAttribute('data-openchamber-file-status') === 'missing') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (openImagePreview(target)) {
        return;
      }

      openFileReference(target);
    };

    const scheduleValidate = () => {
      if (validateDebounceRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(validateDebounceRef.current);
      }
      if (typeof window === 'undefined') {
        void validateFileLinks();
        return;
      }
      validateDebounceRef.current = window.setTimeout(() => {
        validateDebounceRef.current = null;
        void validateFileLinks();
      }, 80);
    };

    annotateFileLinks();
    scheduleValidate();

    const observer = new MutationObserver(() => {
      if (annotationDebounceRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(annotationDebounceRef.current);
      }
      if (typeof window === 'undefined') {
        annotateFileLinks();
        scheduleValidate();
        return;
      }
      annotationDebounceRef.current = window.setTimeout(() => {
        annotationDebounceRef.current = null;
        annotateFileLinks();
        scheduleValidate();
      }, 120);
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    container.addEventListener('click', handleClick);
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      if (annotationDebounceRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(annotationDebounceRef.current);
      }
      if (validateDebounceRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(validateDebounceRef.current);
      }
      annotationDebounceRef.current = null;
      validateDebounceRef.current = null;
      observer.disconnect();
      container.removeEventListener('click', handleClick);
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, editor, effectiveDirectory, fileReferenceBaseUrl, onShowPopup, preferRuntimeEditor, enabled]);
};

const useMermaidInlineInteractions = ({
  containerRef,
  mermaidBlocks,
  onShowPopup,
  allowWheelZoom,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  mermaidBlocks: string[];
  onShowPopup?: (content: ToolPopupContent) => void;
  allowWheelZoom?: boolean;
}) => {
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleMermaidClick = (event: MouseEvent) => {
      if (!onShowPopup) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest('button, a, [role="button"]')) {
        return;
      }

      const block = target.closest(MERMAID_BLOCK_SELECTOR);
      if (!block) {
        return;
      }

      const renderedBlocks = Array.from(container.querySelectorAll(MERMAID_BLOCK_SELECTOR));
      const blockIndex = renderedBlocks.indexOf(block);
      if (blockIndex < 0) {
        return;
      }

      const source = mermaidBlocks[blockIndex];
      if (!source || source.trim().length === 0) {
        return;
      }

      const filename = `Diagram ${blockIndex + 1}`;
      onShowPopup({
        open: true,
        title: filename,
        content: '',
        metadata: {
          tool: 'mermaid-preview',
          filename,
        },
        mermaid: {
          url: `data:text/plain;charset=utf-8,${encodeURIComponent(source)}`,
          source,
          filename,
        },
      });
    };

    const handleInlineWheel = (event: WheelEvent) => {
      if (allowWheelZoom) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const block = target.closest(MERMAID_BLOCK_SELECTOR);
      if (!block) {
        return;
      }

      // Keep regular page scroll while preventing Streamdown inline wheel-zoom handlers.
      event.stopPropagation();
    };

    container.addEventListener('click', handleMermaidClick);
    container.addEventListener('wheel', handleInlineWheel, { capture: true, passive: true });

    return () => {
      container.removeEventListener('click', handleMermaidClick);
      container.removeEventListener('wheel', handleInlineWheel, true);
    };
  }, [allowWheelZoom, containerRef, mermaidBlocks, onShowPopup]);
};

const MarkdownRendererImpl: React.FC<MarkdownRendererProps> = ({
  content,
  sessionId,
  part,
  messageId,
  isAnimated = true,
  skipFadeIn = false,
  className,
  isStreaming = false,
  disableStreamAnimation = false,
  variant = 'assistant',
  onShowPopup,
  enableFileReferences = true,
}) => {
  const currentTheme = useCurrentMermaidTheme();
  const { editor, runtime } = useRuntimeAPIs();
  const containerRef = React.useRef<HTMLDivElement>(null);
  useCjkMonoFontForBlockCode(content);
  const effectiveDirectory = useMessageDirectory(sessionId);
  const fileReferenceBaseUrl = React.useMemo(
    () => resolveFileReferenceBaseUrl(sessionId, effectiveDirectory),
    [effectiveDirectory, sessionId],
  );
  const mermaidBlocks = React.useMemo(() => extractMermaidBlocks(content), [content]);
  useMermaidInlineInteractions({ containerRef, mermaidBlocks, onShowPopup });
  const fileReferencesEnabled = enableFileReferences && !isStreaming;
  useFileReferenceInteractions({
    containerRef,
    effectiveDirectory,
    fileReferenceBaseUrl,
    editor,
    preferRuntimeEditor: runtime.isVSCode,
    enabled: fileReferencesEnabled,
    onShowPopup,
  });
  useExternalLinkInteractions({ containerRef });
  const openContextPreview = useUIStore((state) => state.openContextPreview);
  const { t } = useI18n();
  const handlePreviewLoopback = React.useCallback((url: string) => {
    if (!effectiveDirectory) return;
    openContextPreview(effectiveDirectory, url);
  }, [effectiveDirectory, openContextPreview]);
  const previewLabel = t('terminalView.preview.open');
  const previewTitle = t('terminalView.preview.openTitle');
  const syntaxTheme = React.useMemo(() => generateSyntaxTheme(currentTheme), [currentTheme]);
  const markdownComponents = React.useMemo(
    () => buildMarkdownComponents({
      syntaxTheme,
      onPreviewLoopback: effectiveDirectory ? handlePreviewLoopback : undefined,
      previewLabel,
      previewTitle,
      localImageContext: fileReferencesEnabled
        ? {
            effectiveDirectory,
            fileReferenceBaseUrl,
          }
        : undefined,
      onShowPopup,
    }),
    [syntaxTheme, effectiveDirectory, fileReferenceBaseUrl, fileReferencesEnabled, handlePreviewLoopback, onShowPopup, previewLabel, previewTitle],
  );
  const componentKey = `markdown-${MARKDOWN_RENDERER_VERSION}-${part?.id ? `part-${part.id}` : `message-${messageId}`}`;
  const markdownBlocks = useStableMarkdownBlocks(content, isStreaming && !disableStreamAnimation, componentKey);

  const markdownClassName = variant === 'tool'
    ? 'markdown-content markdown-tool'
    : variant === 'reasoning'
      ? 'markdown-content markdown-reasoning'
      : 'markdown-content leading-snug';

  const markdownContent = (
    <div className={cn('break-words w-full min-w-0', className)} ref={containerRef}>
      <div className={markdownClassName}>
        {markdownBlocks.map((block) => (
          <MarkdownBlockView key={block.key} block={block} components={markdownComponents} />
        ))}
      </div>
    </div>
  );

  if (isAnimated) {
    return (
      <FadeInOnReveal key={componentKey} skipAnimation={skipFadeIn}>
        {markdownContent}
      </FadeInOnReveal>
    );
  }

  return markdownContent;
};

export const MarkdownRenderer = React.memo(MarkdownRendererImpl, (prev, next) => {
  return prev.content === next.content
    && prev.isStreaming === next.isStreaming
    && prev.disableStreamAnimation === next.disableStreamAnimation
    && prev.variant === next.variant
    && prev.isAnimated === next.isAnimated
    && prev.skipFadeIn === next.skipFadeIn
    && prev.className === next.className
    && prev.sessionId === next.sessionId
	    && prev.messageId === next.messageId
	    && prev.onShowPopup === next.onShowPopup
	    && prev.enableFileReferences === next.enableFileReferences
    && prev.part?.id === next.part?.id;
});

const SimpleMarkdownRendererImpl: React.FC<{
  content: string;
  className?: string;
  variant?: MarkdownVariant;
  disableLinkSafety?: boolean;
  stripFrontmatter?: boolean;
  onShowPopup?: (content: ToolPopupContent) => void;
  mermaidControls?: MermaidControlOptions;
  allowMermaidWheelZoom?: boolean;
  enableFileReferences?: boolean;
  sessionId?: string;
}> = ({
  content,
  sessionId,
  className,
  variant = 'assistant',
  disableLinkSafety,
  stripFrontmatter = false,
  onShowPopup,
  allowMermaidWheelZoom = false,
  enableFileReferences = true,
}) => {
  const { editor, runtime } = useRuntimeAPIs();
  const renderedContent = React.useMemo(
    () => (stripFrontmatter ? stripLeadingFrontmatter(content) : content),
    [content, stripFrontmatter],
  );
  const currentTheme = useCurrentMermaidTheme();
  const containerRef = React.useRef<HTMLDivElement>(null);
  useCjkMonoFontForBlockCode(renderedContent);
  const effectiveDirectory = useMessageDirectory(sessionId);
  const fileReferenceBaseUrl = React.useMemo(
    () => resolveFileReferenceBaseUrl(sessionId, effectiveDirectory),
    [effectiveDirectory, sessionId],
  );
  const mermaidBlocks = React.useMemo(() => extractMermaidBlocks(renderedContent), [renderedContent]);
  useMermaidInlineInteractions({
    containerRef,
    mermaidBlocks,
    onShowPopup,
    allowWheelZoom: allowMermaidWheelZoom,
  });
  useFileReferenceInteractions({
    containerRef,
    effectiveDirectory,
    fileReferenceBaseUrl,
    editor,
    preferRuntimeEditor: runtime.isVSCode,
    enabled: enableFileReferences,
    onShowPopup,
  });
  useExternalLinkInteractions({ containerRef, enabled: !disableLinkSafety });
  const syntaxTheme = React.useMemo(() => generateSyntaxTheme(currentTheme), [currentTheme]);
  const markdownComponents = React.useMemo(
    () => buildMarkdownComponents({
      syntaxTheme,
      localImageContext: enableFileReferences
        ? {
            effectiveDirectory,
            fileReferenceBaseUrl,
          }
        : undefined,
      onShowPopup,
    }),
    [effectiveDirectory, enableFileReferences, fileReferenceBaseUrl, onShowPopup, syntaxTheme],
  );
  const markdownBlocks = useStableMarkdownBlocks(renderedContent, false, `simple:${MARKDOWN_RENDERER_VERSION}:${variant}`);

  const markdownClassName = variant === 'tool'
    ? 'markdown-content markdown-tool'
    : variant === 'reasoning'
      ? 'markdown-content markdown-reasoning'
      : 'markdown-content leading-snug';

  return (
    <div className={cn('break-words w-full min-w-0', className)} ref={containerRef}>
      <div className={markdownClassName}>
        {markdownBlocks.map((block) => (
          <MarkdownBlockView key={block.key} block={block} components={markdownComponents} />
        ))}
      </div>
    </div>
  );
};

export const SimpleMarkdownRenderer = React.memo(SimpleMarkdownRendererImpl, (prev, next) => {
  return prev.content === next.content
    && prev.variant === next.variant
    && prev.className === next.className
    && prev.disableLinkSafety === next.disableLinkSafety
    && prev.stripFrontmatter === next.stripFrontmatter
    && prev.sessionId === next.sessionId
    && prev.onShowPopup === next.onShowPopup
    && prev.allowMermaidWheelZoom === next.allowMermaidWheelZoom
    && prev.enableFileReferences === next.enableFileReferences;
});

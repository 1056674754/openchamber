import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { subscribeRuntimeUrlAuthToken } from '@/lib/runtime-auth';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import type { ToolPopupContent } from './message/types';
import {
  extractMarkdownImageCandidates,
  isLocalMarkdownImageSource,
  prepareLocalMarkdownImages,
  prepareVSCodeMarkdownImages,
  resolveMarkdownImageSource,
  type PreparedMarkdownImage,
} from './markdownImageAssets';

const MAX_MARKDOWN_IMAGE_COUNT = 12;

const fileNameFromSource = (source: string, alt: string): string => {
  const clean = source.split(/[?#]/, 1)[0] ?? '';
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // Keep the raw source when it contains malformed escapes.
  }
  const name = decoded.split(/[\\/]/).filter(Boolean).pop();
  return name || alt || 'Image';
};

const LazyThumbnail: React.FC<{
  url: string | null;
  filename: string;
  onOpen: () => void;
}> = ({ url, filename, onOpen }) => {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [load, setLoad] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      disabled={!load || !url || failed}
      className="group relative size-[100px] max-sm:size-[88px] shrink-0 overflow-hidden rounded-md border border-border/60 bg-[var(--surface-elevated)] text-left disabled:cursor-default"
      aria-label={`Preview image: ${filename}`}
    >
      {load && url && !failed ? (
        <img
          src={url}
          alt={filename}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover transition-transform group-hover:scale-[1.03]"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <Icon name="image-download" className="size-5" />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-1.5 py-1 typography-micro text-foreground backdrop-blur-sm">
        {filename}
      </span>
    </button>
  );
};

export const MarkdownImageGallery: React.FC<{
  sessionId: string;
  messageId: string;
  directory: string;
  contents: readonly string[];
  onShowPopup?: (content: ToolPopupContent) => void;
}> = ({ sessionId, messageId, directory, contents, onShowPopup }) => {
  const runtimeAPIs = getRegisteredRuntimeAPIs();
  const isVSCode = runtimeAPIs?.runtime.isVSCode === true;
  const files = runtimeAPIs?.files;
  const galleryRef = React.useRef<HTMLDivElement>(null);
  const [shouldPrepare, setShouldPrepare] = React.useState(false);
  const [prepared, setPrepared] = React.useState<Map<string, PreparedMarkdownImage> | null>(null);
  const [prepareEpoch, setPrepareEpoch] = React.useState(0);
  const [authNonce, setAuthNonce] = React.useState(0);
  const candidates = React.useMemo(
    () => extractMarkdownImageCandidates(contents, MAX_MARKDOWN_IMAGE_COUNT),
    [contents],
  );
  const localSources = React.useMemo(
    () => candidates.filter((candidate) => isLocalMarkdownImageSource(candidate.source)).map((candidate) => candidate.source),
    [candidates],
  );

  React.useEffect(() => subscribeRuntimeUrlAuthToken(() => setAuthNonce((value) => value + 1)), []);

  React.useEffect(() => {
    if (localSources.length === 0 || shouldPrepare) return;
    const element = galleryRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setShouldPrepare(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldPrepare(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [localSources.length, shouldPrepare]);

  React.useEffect(() => {
    if (!shouldPrepare || localSources.length === 0) return;
    const controller = new AbortController();
    let request: Promise<Map<string, PreparedMarkdownImage>>;
    if (isVSCode) {
      request = files
        ? prepareVSCodeMarkdownImages({ sources: localSources, directory, files })
        : Promise.reject(new Error('VS Code Files API is unavailable'));
    } else {
      request = prepareLocalMarkdownImages({
        sources: localSources,
        directory,
        sessionId,
        messageId,
        signal: controller.signal,
      });
    }
    void request
      .then((result) => {
        if (!controller.signal.aborted) setPrepared(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPrepared(new Map(localSources.map((source) => [source, { status: 'error' } as const])));
        }
      });
    return () => controller.abort();
  }, [directory, files, isVSCode, localSources, messageId, prepareEpoch, sessionId, shouldPrepare]);

  React.useEffect(() => {
    const expiries = Array.from(prepared?.values() ?? [])
      .filter((entry): entry is Extract<PreparedMarkdownImage, { status: 'ready' }> => entry.status === 'ready')
      .map((entry) => entry.expiresAt)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (expiries.length === 0) return;
    const delay = Math.max(1000, Math.min(...expiries) - Date.now() - 5000);
    const timer = window.setTimeout(() => setPrepareEpoch((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [prepared]);

  const items = React.useMemo(() => {
    void authNonce;
    return candidates.flatMap((candidate) => {
      try {
        const preparedImage = prepared?.get(candidate.source);
        if (isLocalMarkdownImageSource(candidate.source) && preparedImage?.status !== 'ready') return [];
        return [{
          source: candidate.source,
          url: resolveMarkdownImageSource(candidate.source, preparedImage, directory),
          filename: fileNameFromSource(candidate.source, candidate.alt),
          filePath: preparedImage?.status === 'ready' ? preparedImage.path : undefined,
        }];
      } catch {
        return [];
      }
    });
  }, [authNonce, candidates, directory, prepared]);

  if (candidates.length === 0) return null;

  return (
    <div ref={galleryRef} className="mt-3 flex max-w-full flex-wrap gap-2" data-openchamber-markdown-gallery="true">
      {candidates.map((candidate) => {
        const item = items.find((entry) => entry.source === candidate.source) ?? null;
        const filename = item?.filename ?? fileNameFromSource(candidate.source, candidate.alt);
        const index = item ? items.indexOf(item) : 0;
        return (
        <LazyThumbnail
          key={candidate.source}
          url={item?.url ?? null}
          filename={filename}
          onOpen={() => {
            if (!onShowPopup || !item) return;
            const gallery = items.map((entry) => ({
              url: entry.url,
              filename: entry.filename,
              filePath: entry.filePath,
              directory,
            }));
            onShowPopup({
              open: true,
              title: item.filename,
              content: '',
              metadata: { tool: 'image-preview', filename: item.filename, filePath: item.filePath, directory },
              image: { url: item.url, filename: item.filename, filePath: item.filePath, directory, gallery, index },
            });
          }}
        />
        );
      })}
    </div>
  );
};

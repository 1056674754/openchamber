import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import {
  resolveMarkdownImageReference,
} from '@/components/chat/markdownFileReferences';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { cn } from '@/lib/utils';

import type { ToolPopupContent } from '../types';
import type { ToolInputMedia, ToolInputPresentation } from './toolInputPresentation';

interface ToolInputPreviewProps {
  currentDirectory: string;
  onShowPopup?: (content: ToolPopupContent) => void;
  onOpenSubagent?: () => void;
  onToggleResult?: () => void;
  presentation: ToolInputPresentation;
  resultExpanded?: boolean;
  resultLabel?: string;
  resultSummary?: string;
  sessionId?: string;
  subagentLabel?: string;
}

interface ResolvedToolMedia extends ToolInputMedia {
  filePath?: string;
  url?: string;
}

const resolveFileReferenceBaseUrl = (sessionId?: string): string => {
  const serverId = sessionId ? serverRegistry.getServerForSession(sessionId) : undefined;
  if (!serverId || serverId === DEFAULT_SERVER_ID) return '';
  return serverRegistry.get(serverId)?.config.baseUrl ?? `/api/remote/${encodeURIComponent(serverId)}`;
};

const resolveToolMedia = (
  media: ToolInputMedia,
  currentDirectory: string,
  fileReferenceBaseUrl: string,
): ResolvedToolMedia => {
  const source = media.source.trim();
  if (/^(?:https?:|blob:|data:image\/)/i.test(source)) {
    return { ...media, url: source };
  }

  const reference = resolveMarkdownImageReference(source, currentDirectory, fileReferenceBaseUrl);
  if (!reference) return media;
  return { ...media, filePath: reference.resolvedPath, url: reference.rawUrl };
};

const ToolMediaThumbnail: React.FC<{
  allMedia: ResolvedToolMedia[];
  currentDirectory: string;
  media: ResolvedToolMedia;
  onShowPopup?: (content: ToolPopupContent) => void;
}> = React.memo(({ allMedia, currentDirectory, media, onShowPopup }) => {
  const [failed, setFailed] = React.useState(false);
  const canPreview = Boolean(media.url) && !failed;

  const openPreview = React.useCallback(() => {
    if (!media.url || !onShowPopup) return;
    const gallery = allMedia
      .filter((item): item is ResolvedToolMedia & { url: string } => Boolean(item.url))
      .map((item) => ({
        url: item.url,
        filename: item.label,
        filePath: item.filePath,
        directory: currentDirectory,
      }));
    const index = gallery.findIndex((item) => item.url === media.url);

    onShowPopup({
      open: true,
      title: media.label,
      content: '',
      image: {
        url: media.url,
        filename: media.label,
        filePath: media.filePath,
        directory: currentDirectory,
        gallery,
        index: Math.max(0, index),
      },
    });
  }, [allMedia, currentDirectory, media, onShowPopup]);

  if (!canPreview) {
    return (
      <div
        className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-subtle)] text-muted-foreground"
        title={`${media.label}: Preview unavailable`}
      >
        <Icon name="file-image" className="size-4" />
      </div>
    );
  }

  const image = (
    <img
      src={media.url}
      alt={media.label}
      width={160}
      height={112}
      loading="lazy"
      decoding="async"
      className="h-full w-full bg-[var(--surface-subtle)] object-cover"
      onError={() => setFailed(true)}
    />
  );

  if (!onShowPopup) {
    return (
      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--interactive-border)]" title={media.label}>
        {image}
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--interactive-border)] p-0 normal-case hover:border-[var(--interactive-border-hover)]"
      aria-label={`Open image preview: ${media.label}`}
      title={media.label}
      onClick={openPreview}
    >
      {image}
      {allMedia.length > 1 ? (
        <span className="absolute bottom-1 right-1 rounded bg-[var(--surface-overlay)] px-1 py-0.5 typography-micro text-foreground shadow-sm">
          +{allMedia.length - 1}
        </span>
      ) : null}
    </Button>
  );
});

ToolMediaThumbnail.displayName = 'ToolMediaThumbnail';

export const ToolInputPreview: React.FC<ToolInputPreviewProps> = React.memo(({
  currentDirectory,
  onOpenSubagent,
  onShowPopup,
  onToggleResult,
  presentation,
  resultExpanded = false,
  resultLabel = 'Output',
  resultSummary,
  sessionId,
  subagentLabel = 'Open subagent',
}) => {
  const fileReferenceBaseUrl = React.useMemo(
    () => resolveFileReferenceBaseUrl(sessionId),
    [sessionId],
  );
  const resolvedMedia = React.useMemo(
    () => presentation.media.map((media) => resolveToolMedia(media, currentDirectory, fileReferenceBaseUrl)),
    [currentDirectory, fileReferenceBaseUrl, presentation.media],
  );

  if (presentation.fields.length === 0 && presentation.media.length === 0) return null;

  if (resolvedMedia.length > 0) {
    const primaryMedia = resolvedMedia[0];

    return (
      <div className="flex min-w-0 items-center gap-2 py-0.5">
        <ToolMediaThumbnail
          allMedia={resolvedMedia}
          currentDirectory={currentDirectory}
          media={primaryMedia}
          onShowPopup={onShowPopup}
        />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="typography-micro shrink-0 font-medium text-muted-foreground">
              {presentation.summaryLabel || 'Prompt'}
            </span>
            <span className="typography-meta min-w-0 truncate text-foreground" title={presentation.summary}>
              {presentation.summary}
            </span>
          </div>

          {resultSummary || onOpenSubagent ? (
            <div className="flex min-w-0 items-center gap-1.5">
              {resultSummary ? (
                onToggleResult ? (
                  <button
                    type="button"
                    className="group/result flex min-w-0 flex-1 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-expanded={resultExpanded}
                    onClick={onToggleResult}
                    title={resultSummary}
                  >
                    <Icon
                      name={resultExpanded ? 'arrow-down-s' : 'arrow-right-s'}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="typography-micro shrink-0 font-medium text-muted-foreground">{resultLabel}</span>
                    <span className="typography-meta min-w-0 truncate text-muted-foreground group-hover/result:text-foreground">
                      {resultSummary}
                    </span>
                  </button>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5" title={resultSummary}>
                    <span className="typography-micro shrink-0 font-medium text-muted-foreground">{resultLabel}</span>
                    <span className="typography-meta min-w-0 truncate text-muted-foreground">{resultSummary}</span>
                  </div>
                )
              ) : <span className="min-w-0 flex-1" />}

              {onOpenSubagent ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-5 shrink-0 gap-1 px-1.5 normal-case text-primary hover:text-primary"
                  aria-label={subagentLabel}
                  onClick={onOpenSubagent}
                >
                  <Icon name="external-link" className="size-3" />
                  <span className="hidden sm:inline">{subagentLabel}</span>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const visibleFields = presentation.fields.slice(0, 3);

  return (
    <dl className="min-w-0 space-y-1 py-0.5">
      {visibleFields.map((field) => (
        <div key={field.key} className="flex min-w-0 items-center gap-1.5">
          <dt className="typography-micro shrink-0 font-medium text-muted-foreground">{field.label}</dt>
          <dd
            className={cn(
              'typography-meta min-w-0 truncate text-foreground',
              field.kind !== 'text' && 'font-mono',
            )}
            title={field.value}
          >
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
});

ToolInputPreview.displayName = 'ToolInputPreview';

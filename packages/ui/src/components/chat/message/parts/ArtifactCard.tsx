import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { cn } from '@/lib/utils';

import { formatArtifactSize, type OpenChamberArtifact } from './artifactMetadata';

type ArtifactCardProps = {
  readonly artifact: OpenChamberArtifact;
  readonly sessionId?: string;
};

const SAFE_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const SAFE_OPEN_MIME_TYPES = new Set([
  ...SAFE_IMAGE_MIME_TYPES,
  'application/pdf',
  'text/plain',
]);

function resolveArtifactUrl(artifact: OpenChamberArtifact, sessionId: string | undefined): string {
  const connection = sessionId
    ? serverRegistry.getClientForSession(sessionId)
    : serverRegistry.getDefault();
  return resolveApiUrl(`/api/artifacts/${artifact.id}/content`, connection?.config.baseUrl);
}

const ArtifactCard: React.FC<ArtifactCardProps> = React.memo(({ artifact, sessionId }) => {
  const contentUrl = resolveArtifactUrl(artifact, sessionId);
  const title = artifact.title ?? artifact.name;
  const canPreviewImage = SAFE_IMAGE_MIME_TYPES.has(artifact.mime);
  const canOpen = SAFE_OPEN_MIME_TYPES.has(artifact.mime);
  const detail = `${formatArtifactSize(artifact.size)} · ${artifact.mime}`;

  return (
    <article
      className={cn(
        'mx-3 mb-2 flex min-w-0 items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2',
        'bg-[var(--surface-elevated)] text-foreground',
      )}
      aria-label={`Artifact: ${title}`}
      title={artifact.description}
    >
      {canPreviewImage ? (
        <a
          href={contentUrl}
          target="_blank"
          rel="noreferrer"
          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-border)]"
          aria-label={`Open ${title}`}
        >
          <img
            src={contentUrl}
            alt={title}
            width={40}
            height={40}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </a>
      ) : (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-[var(--surface-muted)] text-muted-foreground"
          aria-hidden="true"
        >
          <Icon name="file-text" className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate typography-meta font-medium text-foreground" title={title}>
          {title}
        </div>
        <div className="mt-0.5 truncate typography-micro text-muted-foreground" title={detail}>
          {detail}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {canOpen && !canPreviewImage ? (
          <a
            href={contentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--surface-muted)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-border)]"
            aria-label={`Open ${title}`}
            title="Open"
          >
            <Icon name="external-link" className="h-4 w-4" />
          </a>
        ) : null}
        <a
          href={`${contentUrl}?download=true`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--surface-muted)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-border)]"
          aria-label={`Download ${title}`}
          title="Download"
        >
          <Icon name="download" className="h-4 w-4" />
        </a>
      </div>
    </article>
  );
});

ArtifactCard.displayName = 'ArtifactCard';

export { ArtifactCard };

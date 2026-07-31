import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { useI18n } from '@/lib/i18n';
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
  'image/svg+xml',
  'image/webp',
]);

const SAFE_OPEN_MIME_TYPES = new Set([
  ...SAFE_IMAGE_MIME_TYPES,
  'application/pdf',
  'application/json',
  'application/xml',
  'application/yaml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/xml',
]);

function resolveArtifactUrl(artifact: OpenChamberArtifact, sessionId: string | undefined): string {
  const connection = sessionId
    ? serverRegistry.getClientForSession(sessionId)
    : serverRegistry.getDefault();
  return resolveApiUrl(
    `/api/artifacts/${artifact.id}/content?sha=${artifact.sha256}`,
    connection?.config.baseUrl,
  );
}

const ArtifactCard: React.FC<ArtifactCardProps> = React.memo(({ artifact, sessionId }) => {
  const { t } = useI18n();
  const contentUrl = resolveArtifactUrl(artifact, sessionId);
  const title = artifact.title ?? artifact.name;
  const canPreviewImage = SAFE_IMAGE_MIME_TYPES.has(artifact.mime);
  const canOpen = SAFE_OPEN_MIME_TYPES.has(artifact.mime);
  const detail = `${formatArtifactSize(artifact.size)} · ${artifact.mime}`;
  const previewLabel = `${t('chat.messageBody.actions.openPreviewAria')}: ${title}`;
  const summary = (
    <>
      {canPreviewImage ? (
        <img
          src={contentUrl}
          alt={title}
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-lg border border-border/50 bg-[var(--surface-muted)] object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-[var(--surface-muted)] text-muted-foreground"
          aria-hidden="true"
        >
          <Icon name="file-text" className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div
          className="truncate typography-meta font-medium text-foreground group-hover/artifact-preview:underline"
          title={title}
        >
          {title}
        </div>
        <div className="mt-0.5 truncate typography-micro text-muted-foreground" title={detail}>
          {detail}
        </div>
      </div>
    </>
  );

  return (
    <article
      className={cn(
        'mx-3 mb-2 flex min-w-0 items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2',
        'bg-[var(--surface-elevated)] text-foreground',
      )}
      aria-label={`Artifact: ${title}`}
      title={artifact.description}
    >
      {canOpen ? (
        <a
          href={contentUrl}
          target="_blank"
          rel="noreferrer"
          className="group/artifact-preview flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-border)]"
          aria-label={previewLabel}
        >
          {summary}
        </a>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{summary}</div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {canOpen ? (
          <a
            href={contentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--surface-muted)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-border)]"
            aria-label={previewLabel}
            title={t('chat.messageBody.actions.openPreview')}
          >
            <Icon name="external-link" className="h-4 w-4" />
          </a>
        ) : null}
        <a
          href={`${contentUrl}&download=true`}
          download={artifact.name}
          target="_blank"
          rel="noreferrer"
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

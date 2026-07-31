import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { I18nProvider } from '@/lib/i18n';

import { ArtifactCard } from './ArtifactCard';
import { parseOpenChamberArtifact } from './artifactMetadata';

const renderArtifactCard = (
  artifact: NonNullable<ReturnType<typeof parseOpenChamberArtifact>>,
): string => renderToStaticMarkup(
  <I18nProvider>
    <ArtifactCard artifact={artifact} sessionId="session-1" />
  </I18nProvider>,
);

describe('ArtifactCard', () => {
  test('renders image preview and durable download actions', () => {
    // Given
    const artifact = parseOpenChamberArtifact({
      openchamberArtifact: {
        version: 1,
        id: 'a'.repeat(64),
        name: 'review.png',
        title: 'Review screenshot',
        description: 'Submitted queue after verification',
        mime: 'image/png',
        size: 1024,
        sha256: 'b'.repeat(64),
        kind: 'image',
        sessionID: 'session-1',
        messageID: 'message-1',
        createdAt: '2026-07-23T10:00:00.000Z',
      },
    });
    if (!artifact) throw new Error('Artifact fixture is invalid');

    // When
    const markup = renderArtifactCard(artifact);

    // Then
    expect(markup).toContain(`src="/api/artifacts/${artifact.id}/content?sha=${artifact.sha256}"`);
    expect(markup).toContain(
      `href="/api/artifacts/${artifact.id}/content?sha=${artifact.sha256}&amp;download=true"`,
    );
    expect(markup).toContain(`download="${artifact.name}"`);
    expect(markup.match(/target="_blank"/g)).toHaveLength(3);
    expect(markup).toContain('Review screenshot');
    expect(markup).toContain('Submitted queue after verification');
    expect(markup).toContain('h-10 w-10');
  });

  test('offers preview and download actions for published HTML', () => {
    const artifact = parseOpenChamberArtifact({
      openchamberArtifact: {
        version: 1,
        id: 'e'.repeat(64),
        name: 'artifact.html',
        title: 'Interactive report',
        mime: 'text/html',
        size: 4096,
        sha256: 'f'.repeat(64),
        kind: 'document',
        sessionID: 'session-1',
        messageID: 'message-3',
        createdAt: '2026-07-23T10:00:00.000Z',
      },
    });
    if (!artifact) throw new Error('Artifact fixture is invalid');

    const markup = renderArtifactCard(artifact);

    expect(markup).toContain(
      `href="/api/artifacts/${artifact.id}/content?sha=${artifact.sha256}"`,
    );
    expect(markup).toContain(
      `href="/api/artifacts/${artifact.id}/content?sha=${artifact.sha256}&amp;download=true"`,
    );
    expect(markup.match(/target="_blank"/g)).toHaveLength(3);
  });

  test('keeps long MIME metadata on one truncatable line', () => {
    // Given
    const artifact = parseOpenChamberArtifact({
      openchamberArtifact: {
        version: 1,
        id: 'c'.repeat(64),
        name: 'export.bin',
        title: 'Export bundle',
        mime: 'application/vnd.openchamber.review-export-with-a-very-long-vendor-subtype',
        size: 2048,
        sha256: 'd'.repeat(64),
        kind: 'file',
        sessionID: 'session-1',
        messageID: 'message-2',
        createdAt: '2026-07-23T10:00:00.000Z',
      },
    });
    if (!artifact) throw new Error('Artifact fixture is invalid');

    // When
    const markup = renderArtifactCard(artifact);

    // Then
    expect(markup).toContain('truncate typography-micro');
    expect(markup).toContain(artifact.mime);
    expect(markup.match(/target="_blank"/g)).toHaveLength(1);
  });
});

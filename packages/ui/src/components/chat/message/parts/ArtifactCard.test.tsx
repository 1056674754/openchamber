import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArtifactCard } from './ArtifactCard';
import { parseOpenChamberArtifact } from './artifactMetadata';

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
    const markup = renderToStaticMarkup(<ArtifactCard artifact={artifact} sessionId="session-1" />);

    // Then
    expect(markup).toContain(`src="/api/artifacts/${artifact.id}/content"`);
    expect(markup).toContain(`href="/api/artifacts/${artifact.id}/content?download=true"`);
    expect(markup).toContain('Review screenshot');
    expect(markup).toContain('Submitted queue after verification');
    expect(markup).toContain('h-10 w-10');
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
    const markup = renderToStaticMarkup(<ArtifactCard artifact={artifact} sessionId="session-1" />);

    // Then
    expect(markup).toContain('truncate typography-micro');
    expect(markup).toContain(artifact.mime);
  });
});

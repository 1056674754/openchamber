import { describe, expect, test } from 'bun:test';

import { parseOpenChamberArtifact, parsePublishedArtifactToolPart } from './artifactMetadata';

describe('OpenChamber artifact metadata', () => {
  test('parses a valid completed tool marker', () => {
    // Given
    const metadata = {
      openchamberArtifact: {
        version: 1,
        id: 'a'.repeat(64),
        name: 'review.png',
        title: 'Review screenshot',
        mime: 'image/png',
        size: 1024,
        sha256: 'b'.repeat(64),
        kind: 'image',
        sessionID: 'session-1',
        messageID: 'message-1',
        createdAt: '2026-07-23T10:00:00.000Z',
      },
    };

    // When
    const artifact = parseOpenChamberArtifact(metadata);

    // Then
    expect(artifact && {
      id: artifact.id,
      name: artifact.name,
      title: artifact.title,
      kind: artifact.kind,
    }).toEqual({
      id: 'a'.repeat(64),
      name: 'review.png',
      title: 'Review screenshot',
      kind: 'image',
    });
  });

  test('ignores malformed or unversioned markers', () => {
    // Given
    const malformed = {
      openchamberArtifact: {
        id: '../../secret',
        name: 'secret',
      },
    };

    // When
    const artifact = parseOpenChamberArtifact(malformed);

    // Then
    expect(artifact).toBeNull();
  });

  test('only promotes metadata emitted by publish_artifact', () => {
    const metadata = {
      openchamberArtifact: {
        version: 1,
        id: 'a'.repeat(64),
        name: 'review.png',
        mime: 'image/png',
        size: 1024,
        sha256: 'b'.repeat(64),
        kind: 'image',
        sessionID: 'session-1',
        messageID: 'message-1',
        createdAt: '2026-07-23T10:00:00.000Z',
      },
    };

    expect(parsePublishedArtifactToolPart({
      type: 'tool',
      tool: 'write',
      state: { metadata },
    })).toBeNull();
    expect(parsePublishedArtifactToolPart({
      type: 'tool',
      tool: 'publish_artifact',
      state: { metadata },
    })?.name).toBe('review.png');
  });
});

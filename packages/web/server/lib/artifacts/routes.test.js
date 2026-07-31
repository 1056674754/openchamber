import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { registerArtifactRoutes } from './routes.js';

const tempRoots = [];

const makeTempDir = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-routes-'));
  tempRoots.push(directory);
  return directory;
};

const createApp = (openchamberDataDir) => {
  const app = express();
  registerArtifactRoutes(app, { fsPromises: fs, path, openchamberDataDir });
  return app;
};

const writeArtifact = async (openchamberDataDir, manifest, content) => {
  const artifactDirectory = path.join(openchamberDataDir, 'artifacts', manifest.id);
  await fs.mkdir(artifactDirectory, { recursive: true });
  await fs.writeFile(path.join(artifactDirectory, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(artifactDirectory, 'content'), content);
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('artifact routes', () => {
  it('streams a persisted artifact by its id', async () => {
    // Given
    const openchamberDataDir = await makeTempDir();
    const id = 'a'.repeat(64);
    await writeArtifact(openchamberDataDir, {
      version: 1,
      id,
      name: 'review.png',
      mime: 'image/png',
      size: 7,
      sha256: 'b'.repeat(64),
      kind: 'image',
      sessionID: 'session-1',
      messageID: 'message-1',
      createdAt: '2026-07-23T10:00:00.000Z',
    }, Buffer.from('preview'));
    const app = createApp(openchamberDataDir);

    // When
    const response = await request(app).get(`/api/artifacts/${id}/content`);

    // Then
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.body).toEqual(Buffer.from('preview'));
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('streams artifacts when the data directory has a dot-prefixed ancestor', async () => {
    // Given
    const tempRoot = await makeTempDir();
    const openchamberDataDir = path.join(tempRoot, '.config', 'openchamber');
    const id = 'e'.repeat(64);
    await writeArtifact(openchamberDataDir, {
      version: 1,
      id,
      name: 'preview.png',
      mime: 'image/png',
      size: 7,
      sha256: 'f'.repeat(64),
      kind: 'image',
      sessionID: 'session-1',
      messageID: 'message-1',
      createdAt: '2026-07-23T10:00:00.000Z',
    }, Buffer.from('preview'));
    const app = createApp(openchamberDataDir);

    // When
    const response = await request(app).get(`/api/artifacts/${id}/content`);

    // Then
    expect(response.status).toBe(200);
    expect(response.body).toEqual(Buffer.from('preview'));
  });

  it('uses an attachment disposition only for downloads', async () => {
    // Given
    const openchamberDataDir = await makeTempDir();
    const id = 'c'.repeat(64);
    await writeArtifact(openchamberDataDir, {
      version: 1,
      id,
      name: '报告.txt',
      mime: 'text/plain',
      size: 4,
      sha256: 'd'.repeat(64),
      kind: 'document',
      sessionID: 'session-1',
      messageID: 'message-1',
      createdAt: '2026-07-23T10:00:00.000Z',
    }, 'done');
    const app = createApp(openchamberDataDir);

    // When
    const inlineResponse = await request(app).get(`/api/artifacts/${id}/content`);
    const downloadResponse = await request(app).get(`/api/artifacts/${id}/content?download=true`);

    // Then
    expect(inlineResponse.headers['content-disposition']).toBeUndefined();
    expect(downloadResponse.headers['content-disposition']).toContain('attachment');
    expect(downloadResponse.headers['content-disposition']).toContain("filename*=UTF-8''");
  });

  it('serves HTML inline in an active-content sandbox', async () => {
    const openchamberDataDir = await makeTempDir();
    const id = '1'.repeat(64);
    const content = '<!doctype html><title>Artifact preview</title><script>document.body.dataset.ready = "yes"</script>';
    await writeArtifact(openchamberDataDir, {
      version: 1,
      id,
      name: 'preview.html',
      mime: 'text/html',
      size: Buffer.byteLength(content),
      sha256: '2'.repeat(64),
      kind: 'document',
      sessionID: 'session-1',
      messageID: 'message-1',
      createdAt: '2026-07-23T10:00:00.000Z',
    }, content);
    const app = createApp(openchamberDataDir);

    const response = await request(app).get(`/api/artifacts/${id}/content`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain('sandbox allow-forms allow-scripts');
    expect(response.headers['content-security-policy']).not.toContain('allow-same-origin');
  });

  it('continues to force unknown binary artifacts to download', async () => {
    const openchamberDataDir = await makeTempDir();
    const id = '3'.repeat(64);
    await writeArtifact(openchamberDataDir, {
      version: 1,
      id,
      name: 'bundle.bin',
      mime: 'application/octet-stream',
      size: 4,
      sha256: '4'.repeat(64),
      kind: 'file',
      sessionID: 'session-1',
      messageID: 'message-1',
      createdAt: '2026-07-23T10:00:00.000Z',
    }, Buffer.from('data'));
    const app = createApp(openchamberDataDir);

    const response = await request(app).get(`/api/artifacts/${id}/content`);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
  });

  it('rejects artifact ids that could escape the store', async () => {
    // Given
    const openchamberDataDir = await makeTempDir();
    const app = createApp(openchamberDataDir);

    // When
    const response = await request(app).get('/api/artifacts/not-an-id/content');

    // Then
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid artifact id' });
  });
});

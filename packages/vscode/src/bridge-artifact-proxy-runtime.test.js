import { afterEach, describe, expect, mock, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

mock.module('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
  },
}));

const { tryHandleLocalFsProxy } = await import('./bridge-localfs-proxy-runtime');

const temporaryDirectories = [];
const originalDataDirectory = process.env.OPENCHAMBER_DATA_DIR;

afterEach(async () => {
  if (originalDataDirectory === undefined) {
    delete process.env.OPENCHAMBER_DATA_DIR;
  } else {
    process.env.OPENCHAMBER_DATA_DIR = originalDataDirectory;
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('VS Code artifact proxy', () => {
  test('serves a published artifact through the webview API bridge', async () => {
    // Given
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-vscode-artifacts-'));
    temporaryDirectories.push(dataDirectory);
    process.env.OPENCHAMBER_DATA_DIR = dataDirectory;
    const id = 'e'.repeat(64);
    const artifactDirectory = path.join(dataDirectory, 'artifacts', id);
    const content = Buffer.from('preview');
    await fs.mkdir(artifactDirectory, { recursive: true });
    await fs.writeFile(path.join(artifactDirectory, 'content'), content);
    await fs.writeFile(path.join(artifactDirectory, 'manifest.json'), JSON.stringify({
      version: 1,
      id,
      name: 'preview.png',
      mime: 'image/png',
      size: content.length,
      sha256: 'f'.repeat(64),
      kind: 'image',
      sessionID: 'session-1',
      messageID: 'message-1',
      createdAt: '2026-07-23T10:00:00.000Z',
    }));

    // When
    const response = await tryHandleLocalFsProxy('GET', `/api/artifacts/${id}/content`);

    // Then
    expect(response?.status).toBe(200);
    expect(response?.headers['content-type']).toBe('image/png');
    expect(response?.headers['x-content-type-options']).toBe('nosniff');
    expect(response?.bodyBase64).toBe(content.toString('base64'));
  });
});

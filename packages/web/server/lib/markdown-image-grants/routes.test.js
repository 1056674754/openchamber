import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownImageSources, registerMarkdownImageGrantRoutes } from './routes.js';

const tempRoots = [];
const makeTempDir = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-gallery-'));
  tempRoots.push(directory);
  return directory;
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('Markdown image grants', () => {
  it('extracts image syntax outside code fences from assistant text parts', () => {
    const sources = markdownImageSources({
      parts: [{ type: 'text', text: '![one](one.png)\n```md\n![hidden](hidden.png)\n```\n[two]: two.webp\n![two][two]' }],
    });
    expect(Array.from(sources)).toEqual(['one.png', 'two.webp']);
  });

  it('grants only a referenced, validated image under the approved temp root', async () => {
    const workspace = await makeTempDir();
    const approvedTempRoot = await makeTempDir();
    const imagePath = path.join(approvedTempRoot, 'image.png');
    await fs.writeFile(imagePath, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      info: { id: 'msg_1', role: 'assistant' },
      parts: [{ type: 'text', text: `![result](${imagePath})` }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const app = express();
    registerMarkdownImageGrantRoutes(app, {
      fsPromises: fs,
      path,
      os,
      crypto,
      approvedTempRoot,
      validateDirectoryPath: async () => ({ ok: true, directory: workspace }),
      buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      fetchImpl: fetchMock,
    });

    const response = await request(app)
      .post('/api/openchamber/sessions/ses_1/markdown-image-grants')
      .send({ directory: workspace, messageId: 'msg_1', sources: [imagePath, path.join(approvedTempRoot, 'other.png')] });

    expect(response.status).toBe(200);
    expect(response.body.results[0]).toMatchObject({ source: imagePath, status: 'ready', path: await fs.realpath(imagePath) });
    expect(response.body.results[0].outsideFileGrant).toEqual(expect.any(String));
    expect(response.body.results[1]).toEqual({ source: path.join(approvedTempRoot, 'other.png'), status: 'error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

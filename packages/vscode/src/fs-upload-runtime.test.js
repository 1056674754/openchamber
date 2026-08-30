import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { writeVSCodeUploadedFile } from './fs-upload-runtime';

const roots = [];
const makeRoot = async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-upload-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe('VS Code atomic upload runtime', () => {
  test('writes binary content and preserves conflicts', async () => {
    const root = await makeRoot();
    const target = path.join(root, 'asset.bin');
    const first = await writeVSCodeUploadedFile({
      directory: root,
      targetPath: target,
      bodyBase64: Buffer.from([0, 1, 2, 255]).toString('base64'),
    });
    expect(first.status).toBe(200);
    expect([...await fs.promises.readFile(target)]).toEqual([0, 1, 2, 255]);

    const conflict = await writeVSCodeUploadedFile({
      directory: root,
      targetPath: target,
      bodyBase64: Buffer.from('replacement').toString('base64'),
    });
    expect(conflict).toEqual({
      status: 409,
      body: { error: 'File already exists', reason: 'already-exists' },
    });
    expect([...await fs.promises.readFile(target)]).toEqual([0, 1, 2, 255]);
  });

  test('overwrites atomically when explicitly requested', async () => {
    const root = await makeRoot();
    const target = path.join(root, 'note.txt');
    await fs.promises.writeFile(target, 'old');
    const result = await writeVSCodeUploadedFile({
      directory: root,
      targetPath: target,
      bodyBase64: Buffer.from('new').toString('base64'),
      overwrite: true,
    });
    expect(result.status).toBe(200);
    expect(await fs.promises.readFile(target, 'utf8')).toBe('new');
  });

  test('denies outside and symlink targets', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const link = path.join(root, 'outside-link');
    await fs.promises.symlink(path.join(outside, 'target.txt'), link);

    const outsideResult = await writeVSCodeUploadedFile({
      directory: root,
      targetPath: path.join(outside, 'target.txt'),
      bodyBase64: Buffer.from('x').toString('base64'),
    });
    expect(outsideResult.status).toBe(403);

    const linkResult = await writeVSCodeUploadedFile({
      directory: root,
      targetPath: link,
      bodyBase64: Buffer.from('x').toString('base64'),
      overwrite: true,
    });
    expect(linkResult.status).toBe(403);
  });

  test('enforces size and parent existence and cleans temp files', async () => {
    const root = await makeRoot();
    const tooLarge = await writeVSCodeUploadedFile({
      directory: root,
      targetPath: path.join(root, 'large.bin'),
      bodyBase64: Buffer.from('1234').toString('base64'),
      maxBytes: 3,
    });
    expect(tooLarge.status).toBe(413);

    const missing = await writeVSCodeUploadedFile({
      directory: root,
      targetPath: path.join(root, 'missing', 'file.txt'),
      bodyBase64: Buffer.from('x').toString('base64'),
    });
    expect(missing.status).toBe(404);
    expect((await fs.promises.readdir(root)).some((name) => name.startsWith('.openchamber-upload-'))).toBe(false);
  });
});

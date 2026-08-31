import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertJsonFileReadableForWrite, copyPreviousGeneration } from './settings-file';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'settings-file-test-'));

describe('settings-file', () => {
  test('resolves for a missing file and for a valid JSON object root', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'settings.json');

    await expect(assertJsonFileReadableForWrite(filePath)).resolves.toBeUndefined();

    fs.writeFileSync(filePath, JSON.stringify({ themeId: 'light' }, null, 2));
    await expect(assertJsonFileReadableForWrite(filePath)).resolves.toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('refuses to write over a corrupt file and leaves it untouched', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'settings.json');
    fs.writeFileSync(filePath, '{corrupted');

    await expect(assertJsonFileReadableForWrite(filePath)).rejects.toThrow(/Refusing to write settings/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{corrupted');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('refuses when the file cannot be read at all (non-ENOENT read error)', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'settings.json');
    // A directory at the path produces EISDIR on read — the non-ENOENT branch
    // of the read guard that must never be treated as "missing file".
    fs.mkdirSync(filePath);

    await expect(assertJsonFileReadableForWrite(filePath)).rejects.toThrow(/could not be read/);
    await expect(assertJsonFileReadableForWrite(filePath, 'settings')).rejects.toThrow(/Refusing to write settings/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('refuses array and primitive roots', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'settings.json');
    for (const corruptRoot of ['[]', '"settings"', '42']) {
      fs.writeFileSync(filePath, corruptRoot);
      await expect(assertJsonFileReadableForWrite(filePath)).rejects.toThrow(/not a JSON object/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(corruptRoot);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('uses the provided label in refusal errors', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'magic-prompts.json');
    fs.writeFileSync(filePath, '{corrupted');

    await expect(assertJsonFileReadableForWrite(filePath, 'magic prompts')).rejects.toThrow(/Refusing to write magic prompts/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('copyPreviousGeneration keeps one generation and never throws', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'settings.json');
    fs.writeFileSync(filePath, JSON.stringify({ generation: 1 }, null, 2));

    await copyPreviousGeneration(filePath);
    expect(JSON.parse(fs.readFileSync(`${filePath}.prev`, 'utf8')).generation).toBe(1);

    fs.writeFileSync(filePath, JSON.stringify({ generation: 2 }, null, 2));
    await copyPreviousGeneration(filePath);
    expect(JSON.parse(fs.readFileSync(`${filePath}.prev`, 'utf8')).generation).toBe(2);

    // Missing source must not throw.
    await expect(copyPreviousGeneration(path.join(dir, 'missing.json'))).resolves.toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

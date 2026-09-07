import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

describe('VS Code webview worker build', () => {
  test('bundles worker imports into one file', () => {
    assert.match(source, /worker:\s*\{[\s\S]*?inlineDynamicImports:\s*true/);
  });
});

describe('VS Code webview module preload policy', () => {
  test('does not preload JS chunks ahead of dynamic imports', () => {
    assert.match(source, /modulePreload:\s*\{[\s\S]*?resolveDependencies:[\s\S]*?endsWith\('\.js'\)/);
  });
});

describe('VS Code webview content-addressed assets', () => {
  test('hashes entry, chunk, and asset filenames', () => {
    assert.match(source, /entryFileNames:\s*'assets\/\[name\]-\[hash\]\.js'/);
    assert.match(source, /chunkFileNames:\s*'assets\/\[name\]-\[hash\]\.js'/);
    assert.match(source, /assetFileNames:\s*'assets\/\[name\]-\[hash\]\.\[ext\]'/);
  });

  test('emits a build manifest for the hashed entry', () => {
    assert.match(source, /writeEntryManifest/);
    assert.match(source, /build-manifest\.json/);
  });
});

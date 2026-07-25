import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'webviewHtml.ts'),
  'utf8',
);

describe('VS Code webview content security policy', () => {
  test('allows blob URLs for workers without allowing blob scripts', () => {
    const workerSource = source.match(/const workerSrc = ([^\n]+);/)?.[1] ?? '';
    const scriptSource = source.match(/const scriptSrc = ([^\n]+);/)?.[1] ?? '';

    expect(workerSource).toContain("'blob:'");
    expect(scriptSource).not.toContain("'blob:'");
    expect(source).toContain('worker-src ${workerSrc}');
  });
});

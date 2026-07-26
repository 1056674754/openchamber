import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDist = path.resolve(mobileRoot, '../web/dist');
const mobileDist = path.resolve(mobileRoot, 'dist');
const mobileHtml = path.join(mobileDist, 'mobile.html');
const indexHtml = path.join(mobileDist, 'index.html');
const assetsDir = path.join(mobileDist, 'assets');

await rm(mobileDist, { recursive: true, force: true });
await mkdir(mobileDist, { recursive: true });
await cp(webDist, mobileDist, { recursive: true });

const html = await readFile(mobileHtml, 'utf8');
await writeFile(indexHtml, html);

// Fail fast: a partial Capacitor copy (icons + desktop index, no /assets) produces a
// black WebView on device. Gate the mobile dist before sync/package.
const index = await readFile(indexHtml, 'utf8');
if (!index.includes('/assets/mobile-')) {
  throw new Error(
    `packages/mobile/dist/index.html is not the mobile entry (expected /assets/mobile-*). `
    + `Refusing to package a broken Capacitor webDir.`,
  );
}

const assetsStat = await stat(assetsDir).catch(() => null);
if (!assetsStat?.isDirectory()) {
  throw new Error(`packages/mobile/dist/assets is missing after prepare-web-assets`);
}

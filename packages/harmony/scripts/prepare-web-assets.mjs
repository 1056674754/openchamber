#!/usr/bin/env node
// Copy packages/web/dist into the ArkWeb rawfile tree (entry/src/main/resources/
// rawfile/www) with mobile.html promoted to index.html, mirroring
// packages/mobile/scripts/prepare-web-assets.mjs. Fail fast on a desktop build
// accidentally packaged as the mobile surface.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDist = resolve(packageRoot, '../web/dist');
const rawfileDir = join(packageRoot, 'entry/src/main/resources/rawfile');
const target = join(rawfileDir, 'www');

const fail = (message) => {
  console.error(`[prepare-web-assets] ${message}`);
  process.exit(1);
};

if (!existsSync(webDist)) {
  fail(`web build output not found at ${webDist} — run 'bun run --cwd packages/web build' first`);
}

const mobileHtmlPath = join(webDist, 'mobile.html');
if (!existsSync(mobileHtmlPath)) {
  fail('packages/web/dist/mobile.html is missing — the web build did not emit the mobile surface');
}

const mobileHtml = readFileSync(mobileHtmlPath, 'utf8');
if (!mobileHtml.includes('/assets/mobile-')) {
  fail('Refusing to package a broken web build: mobile.html does not reference /assets/mobile-*');
}

const assetsDir = join(webDist, 'assets');
if (!existsSync(assetsDir) || !statSync(assetsDir).isDirectory()) {
  fail('packages/web/dist/assets is missing — refusing to package an incomplete web build');
}

// Every script/module referenced by mobile.html (directly or via the entry
// chunk's static imports) must exist on disk. A raced/failed vite build can
// leave a stale html referencing cleaned chunks — that ships as a silent
// white screen.
const visited = new Set();
const missing = [];
const walkChunk = (relPath) => {
  if (visited.has(relPath)) return;
  visited.add(relPath);
  const abs = join(webDist, relPath);
  if (!existsSync(abs)) {
    missing.push(relPath);
    return;
  }
  if (!relPath.endsWith('.js')) return;
  const src = readFileSync(abs, 'utf8');
  const importRe = /from\s*"([^"]+)"|import\("([^"]+)"\)/g;
  let match;
  while ((match = importRe.exec(src))) {
    const dep = match[1] || match[2];
    if (!dep || !dep.startsWith('.') && !dep.startsWith('/')) continue;
    const depAbs = join(dirname(abs), dep);
    const depRel = relative(webDist, depAbs);
    if (depRel.startsWith('..')) continue;
    walkChunk(depRel);
  }
};
for (const ref of mobileHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
  walkChunk(relative(webDist, join(webDist, ref[1])));
}
if (missing.length > 0) {
  fail(`Refusing to package a broken web build — ${missing.length} referenced asset(s) missing: `
    + missing.slice(0, 5).join(', '));
}

// The packaged bundle must contain the shell's port handshake listener — a
// stale build (raced wipe/rebuild) passes the graph check but silently ships
// an old nativeShell without the MessagePort bridge.
let markerFound = false;
for (const rel of visited) {
  if (!rel.endsWith('.js')) continue;
  if (readFileSync(join(webDist, rel), 'utf8').includes('__init_port__')) {
    markerFound = true;
    break;
  }
}
if (!markerFound) {
  fail('Refusing to package a stale web build — no __init_port__ bridge marker in any chunk. '
    + 'Rebuild packages/web (bun run --cwd packages/web build from the repo root).');
}
console.log(`[prepare-web-assets] module graph ok (${visited.size} assets verified, bridge marker found)`);

rmSync(rawfileDir, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(webDist, target, { recursive: true });

const indexTarget = join(target, 'index.html');
const mobileHtmlFinal = readFileSync(mobileHtmlPath, 'utf8');
writeFileSync(indexTarget, mobileHtmlFinal);

console.log(`[prepare-web-assets] packaged web build into ${target}`);

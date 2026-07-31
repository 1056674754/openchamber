import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const [
  oldAppImageArg,
  oldUnpackedRootArg,
  targetAppImageArg,
  targetManifestArg,
] = process.argv.slice(2);

const requirePath = (value, label) => {
  const resolved = value ? path.resolve(value) : '';
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(`${label} not found: ${resolved || '(missing)'}`);
  }
  return resolved;
};

const oldAppImage = requirePath(oldAppImageArg, 'Old AppImage');
const oldUnpackedRoot = requirePath(oldUnpackedRootArg, 'Old unpacked app');
const targetAppImage = requirePath(targetAppImageArg, 'Target AppImage');
const targetManifest = requirePath(targetManifestArg, 'Target update manifest');
const executablePath = path.join(oldUnpackedRoot, 'openchamber');
if (!fs.existsSync(executablePath)) {
  throw new Error(`Old Linux Electron executable not found: ${executablePath}`);
}

const manifest = fs.readFileSync(targetManifest, 'utf8');
const targetVersion = manifest.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
if (!targetVersion) throw new Error('Target update manifest has no version.');

const sha512 = (filePath) => crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('hex');
const targetHash = sha512(targetAppImage);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-linux-update-'));
const home = path.join(root, 'home');
const feedRoot = path.join(root, 'feed');
const installedAppImage = path.join(root, 'OpenChamber.AppImage');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(feedRoot, { recursive: true });
fs.copyFileSync(oldAppImage, installedAppImage);
fs.chmodSync(installedAppImage, 0o755);
fs.copyFileSync(targetAppImage, path.join(feedRoot, path.basename(targetAppImage)));
fs.copyFileSync(targetManifest, path.join(feedRoot, 'latest-linux.yml'));

const serveFile = (request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
  const relativePath = requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(feedRoot, relativePath);
  if (!relativePath || !filePath.startsWith(`${feedRoot}${path.sep}`) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end();
    return;
  }

  const { size } = fs.statSync(filePath);
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  let start = 0;
  let end = size - 1;
  if (range) {
    start = Number.parseInt(range[1], 10);
    end = range[2] ? Number.parseInt(range[2], 10) : end;
    if (start > end || end >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` });
      response.end();
      return;
    }
  }

  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': filePath.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(filePath, { start, end }).pipe(response);
};

const server = http.createServer(serveFile);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Update fixture did not bind a TCP port.');

const remoteDebuggingPort = 9223;
const child = spawn('xvfb-run', [
  '-a',
  'sh',
  '-c',
  'openbox >/dev/null 2>&1 & exec "$@"',
  'sh',
  executablePath,
  '--no-sandbox',
  '--disable-gpu',
  `--remote-debugging-port=${remoteDebuggingPort}`,
], {
  env: {
    ...process.env,
    APPIMAGE: installedAppImage,
    HOME: home,
    OPENCHAMBER_E2E: '1',
    OPENCHAMBER_UPDATER_E2E_URL: `http://127.0.0.1:${address.port}/`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const killProcessGroup = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {
    if (child.exitCode === null) child.kill(signal);
  }
};

const waitForCdp = async () => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Old AppImage exited before CDP became ready (${child.exitCode}):\n${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
      if (response.ok) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for old AppImage CDP endpoint:\n${stderr}`);
};

const waitForMainPage = async (browser) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = browser.contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the old AppImage main renderer.');
};

const waitForExit = async (timeoutMs) => {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Old AppImage did not exit after installing the update:\n${stderr}`));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
};

let browser = null;
let completed = false;
try {
  await waitForCdp();
  const { chromium } = await import('@playwright/test');
  browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${remoteDebuggingPort}`,
    { timeout: 90_000 },
  );
  const page = await waitForMainPage(browser);
  await page.getByRole('button', { name: 'Open OpenChamber menu' }).waitFor({ state: 'visible' });
  await page.evaluate(() => {
    globalThis.__openchamberUpdateEvents = [];
    window.addEventListener('openchamber:update-progress', (event) => {
      globalThis.__openchamberUpdateEvents.push(event.detail);
    });
  });

  const update = await page.evaluate(async () => {
    return await globalThis.__OPENCHAMBER_DESKTOP__.core.invoke('desktop_check_for_updates', {});
  });
  if (!update?.available || update.version !== targetVersion) {
    throw new Error(`Expected update ${targetVersion}, received ${JSON.stringify(update)}`);
  }

  await page.evaluate(async () => {
    await globalThis.__OPENCHAMBER_DESKTOP__.core.invoke('desktop_download_and_install_update', {});
  });
  const progressEvents = await page.evaluate(() => globalThis.__openchamberUpdateEvents);
  if (!progressEvents.some((event) => event?.event === 'Started')
    || !progressEvents.some((event) => event?.event === 'Finished')) {
    throw new Error(`Update progress lifecycle was incomplete: ${JSON.stringify(progressEvents)}`);
  }

  await page.evaluate(async () => {
    await globalThis.__OPENCHAMBER_DESKTOP__.core.invoke('desktop_restart', {});
  }).catch(() => {
  });
  await waitForExit(90_000);

  if (!fs.existsSync(installedAppImage) || sha512(installedAppImage) !== targetHash) {
    throw new Error('Installed AppImage was not atomically replaced by the downloaded target.');
  }
  completed = true;
  console.log(
    `[electron] Linux AppImage update smoke passed: ${update.currentVersion} -> ${targetVersion}; `
    + 'download progress completed and the installed AppImage hash matches the target.',
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.exitCode === null) {
    killProcessGroup('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (child.exitCode === null) killProcessGroup('SIGKILL');
  }
  await new Promise((resolve) => server.close(resolve));
  if (completed) fs.rmSync(root, { recursive: true, force: true });
  else console.error(`[electron] preserved failed Linux updater fixture: ${root}`);
}

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appImagePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
const screenshotPath = process.argv[3] ? path.resolve(process.argv[3]) : '';
if (!appImagePath || !fs.existsSync(appImagePath)) {
  throw new Error(`Linux AppImage not found: ${appImagePath || '(missing)'}`);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-linux-ui-'));
const remoteDebuggingPort = 9222;
const unpackedRoot = process.env.OPENCHAMBER_LINUX_UNPACKED_ROOT
  ? path.resolve(process.env.OPENCHAMBER_LINUX_UNPACKED_ROOT)
  : '';
const executablePath = unpackedRoot ? path.join(unpackedRoot, 'openchamber') : appImagePath;
if (!fs.existsSync(executablePath)) {
  throw new Error(`Linux Electron executable not found: ${executablePath}`);
}
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
    APPIMAGE_EXTRACT_AND_RUN: '1',
    HOME: home,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const waitForCdp = async () => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`AppImage exited before CDP became ready (${child.exitCode}):\n${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
      if (response.ok) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for AppImage CDP endpoint:\n${stderr}`);
};

const waitForMainPage = async (browser) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const mainPage = pages.find((candidate) => {
      const url = candidate.url();
      return url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:');
    });
    if (mainPage) return mainPage;
    if (child.exitCode !== null) {
      throw new Error(`AppImage exited before its main renderer became ready (${child.exitCode}):\n${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const pageUrls = browser.contexts()
    .flatMap((context) => context.pages())
    .map((candidate) => candidate.url());
  throw new Error(`Timed out waiting for the main renderer page. CDP pages: ${JSON.stringify(pageUrls)}`);
};

const collectPageDiagnostics = async (page) => page.evaluate(() => ({
  bodyText: document.body.innerText.slice(0, 1_000),
  buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
    ariaLabel: button.getAttribute('aria-label'),
    text: button.textContent?.trim().slice(0, 120) || '',
  })),
  desktopApiKeys: Object.keys(globalThis.__OPENCHAMBER_DESKTOP__ || {}),
  electronIdentity: globalThis.__OPENCHAMBER_ELECTRON__ || null,
  title: document.title,
  url: location.href,
}));

try {
  await waitForCdp();
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${remoteDebuggingPort}`,
    { timeout: 90_000 },
  ).catch((error) => {
    throw new Error(`Failed to connect to AppImage CDP:\n${stderr}`, { cause: error });
  });
  const page = await waitForMainPage(browser);

  await page.waitForLoadState('domcontentloaded');
  try {
    await page.getByRole('button', { name: 'Open OpenChamber menu' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Minimize window' }).waitFor({ state: 'visible' });
    const maximize = page.getByRole('button', { name: 'Maximize window' });
    await maximize.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Close window' }).waitFor({ state: 'visible' });
    await maximize.click();
    await page.getByRole('button', { name: 'Restore window' }).waitFor({ state: 'visible' });
  } catch (error) {
    const diagnostics = await collectPageDiagnostics(page);
    if (screenshotPath) {
      const failedScreenshotPath = screenshotPath.replace(/(\.[^.]+)?$/, '.failed$1');
      fs.mkdirSync(path.dirname(failedScreenshotPath), { recursive: true });
      await page.screenshot({ path: failedScreenshotPath, fullPage: true });
    }
    throw new Error(`Packaged Linux window controls were not usable:\n${JSON.stringify(diagnostics, null, 2)}`, {
      cause: error,
    });
  }

  const healthUrl = new URL('/health', page.url());
  const healthResponse = await fetch(healthUrl);
  if (!healthResponse.ok) throw new Error(`Packaged web server health failed: ${healthResponse.status}`);

  if (screenshotPath) {
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  await browser.close();
  console.log(
    `[electron] Linux ${unpackedRoot ? 'AppImage payload' : 'AppImage'} UI smoke passed: `
    + 'menu and window controls are visible; maximize/restore is live.',
  );
} finally {
  const killProcessGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      if (child.exitCode === null) child.kill(signal);
    }
  };

  if (child.exitCode === null) killProcessGroup('SIGTERM');
  await new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const forceKill = setTimeout(() => {
      if (child.exitCode === null) killProcessGroup('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });
  });
  fs.rmSync(home, { recursive: true, force: true });
}

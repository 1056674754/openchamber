import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PARTIAL_TEXT = 'PARTIAL_BEFORE_RECONNECT_GAP';
const FINAL_TEXT = 'FINAL_RECOVERED_AFTER_RECONNECT_GAP';
const SESSION_ID = 'ses_reconnect_recovery_e2e';
const USER_MESSAGE_ID = 'msg_reconnect_user';
const ASSISTANT_MESSAGE_ID = 'msg_reconnect_assistant';
const POST_GAP_FAILURE_WINDOW_MS = 4_500;

const isLoopbackUrl = (value: string): boolean => {
  const url = new URL(value, 'http://127.0.0.1');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  return url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '::1'
    || url.hostname === '[::1]';
};

type TimelineEntry = {
  at: number;
  event: string;
  detail?: Record<string, unknown>;
};

type FakeOpenCode = {
  baseUrl: string;
  close: () => Promise<void>;
  directory: string;
  timeline: TimelineEntry[];
  triggerGap: () => void;
};

type WebUiServerController = {
  getPort: () => number | null;
  stop: (options?: { exitProcess?: boolean; stopOpenCode?: boolean }) => Promise<void>;
};

const listen = (server: http.Server): Promise<number> => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Fake OpenCode did not expose a TCP port'));
      return;
    }
    resolve(address.port);
  });
});

const closeServer = (server: http.Server): Promise<void> => new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

const sendJson = (res: ServerResponse, body: unknown, status = 200) => {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(encoded),
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(encoded);
};

const createSession = (directory: string) => ({
  id: SESSION_ID,
  slug: SESSION_ID,
  projectID: 'project_reconnect_e2e',
  directory,
  title: 'Reconnect recovery E2E',
  version: '1.18.9-sscity',
  time: {
    created: 1_700_000_000_000,
    updated: 1_700_000_001_000,
  },
});

const createMessageHistory = (directory: string, completed: boolean) => {
  const user = {
    info: {
      id: USER_MESSAGE_ID,
      sessionID: SESSION_ID,
      role: 'user',
      time: { created: 1_700_000_000_100 },
      agent: 'build',
      model: {
        providerID: 'mock',
        modelID: 'mock-model',
      },
    },
    parts: [{
      id: 'part_reconnect_user',
      sessionID: SESSION_ID,
      messageID: USER_MESSAGE_ID,
      type: 'text',
      text: 'Exercise reconnect recovery.',
    }],
  };
  const assistant = {
    info: {
      id: ASSISTANT_MESSAGE_ID,
      sessionID: SESSION_ID,
      role: 'assistant',
      parentID: USER_MESSAGE_ID,
      providerID: 'mock',
      modelID: 'mock-model',
      agent: 'build',
      mode: 'build',
      path: {
        cwd: directory,
        root: directory,
      },
      cost: 0,
      tokens: {
        input: 1,
        output: completed ? 2 : 1,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      time: completed
        ? { created: 1_700_000_000_200, completed: 1_700_000_001_000 }
        : { created: 1_700_000_000_200 },
      ...(completed ? { finish: 'stop' } : {}),
    },
    parts: [{
      id: 'part_reconnect_assistant',
      sessionID: SESSION_ID,
      messageID: ASSISTANT_MESSAGE_ID,
      type: 'text',
      text: completed ? FINAL_TEXT : PARTIAL_TEXT,
    }],
  };
  return [user, assistant];
};

const createFakeOpenCode = async (directory: string): Promise<FakeOpenCode> => {
  const timeline: TimelineEntry[] = [];
  const startedAt = Date.now();
  const session = createSession(directory);
  const openSseResponses = new Set<ServerResponse>();
  let finalAvailable = false;
  let gapTriggeredAt = 0;
  let sseConnectionCount = 0;

  const record = (event: string, detail?: Record<string, unknown>) => {
    timeline.push({
      at: Date.now() - startedAt,
      event,
      ...(detail ? { detail } : {}),
    });
  };

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/global/event') {
      sseConnectionCount += 1;
      const connection = sseConnectionCount;
      const lastEventId = req.headers['last-event-id'] ?? null;
      record('sse.connected', { connection, lastEventId });
      res.writeHead(200, {
        connection: 'keep-alive',
        'cache-control': 'no-cache',
        'content-type': 'text/event-stream; charset=utf-8',
      });
      res.write(': connected\n\n');
      openSseResponses.add(res);
      req.once('close', () => {
        openSseResponses.delete(res);
        record('sse.closed', { connection });
      });

      if (connection > 1) {
        setTimeout(() => {
          if (res.destroyed || res.writableEnded) return;
          const payload = {
            directory,
            payload: {
              type: 'session.status',
              properties: {
                sessionID: SESSION_ID,
                status: { type: 'idle' },
              },
            },
          };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          record('sse.idle-sent', { connection });
        }, 20);
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/global/health') {
      sendJson(res, { healthy: true, version: '1.18.9-sscity' });
      return;
    }

    if (req.method === 'GET' && pathname === '/session') {
      sendJson(res, [session]);
      return;
    }

    if (req.method === 'GET' && pathname === '/session/status') {
      sendJson(res, { [SESSION_ID]: { type: 'idle' } });
      return;
    }

    if (req.method === 'GET' && pathname === `/session/${SESSION_ID}`) {
      sendJson(res, session);
      return;
    }

    if (req.method === 'GET' && pathname === `/session/${SESSION_ID}/message`) {
      const elapsedSinceGap = gapTriggeredAt ? Date.now() - gapTriggeredAt : null;
      if (
        finalAvailable
        && elapsedSinceGap !== null
        && elapsedSinceGap < POST_GAP_FAILURE_WINDOW_MS
      ) {
        record('messages.failed', { elapsedSinceGap, status: 503 });
        sendJson(res, { error: 'injected reconnect materialization failure' }, 503);
        return;
      }
      record('messages.succeeded', {
        elapsedSinceGap,
        finalAvailable,
        status: 200,
      });
      sendJson(res, createMessageHistory(directory, finalAvailable));
      return;
    }

    if (req.method === 'GET' && pathname === `/session/${SESSION_ID}/todo`) {
      sendJson(res, []);
      return;
    }

    if (req.method === 'GET' && pathname === '/question') {
      sendJson(res, []);
      return;
    }

    if (req.method === 'GET' && pathname === '/permission') {
      sendJson(res, []);
      return;
    }

    if (req.method === 'GET' && pathname === '/provider') {
      sendJson(res, {
        all: [{
          id: 'mock',
          name: 'Mock',
          source: 'config',
          env: [],
          models: {
            'mock-model': {
              id: 'mock-model',
              name: 'Mock Model',
              limit: {
                context: 128_000,
                output: 4_096,
              },
            },
          },
        }],
        connected: ['mock'],
        default: {
          mock: 'mock-model',
        },
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/agent') {
      sendJson(res, [{
        name: 'build',
        description: 'E2E agent',
        mode: 'primary',
        native: true,
        hidden: false,
        options: {},
        permission: {},
      }]);
      return;
    }

    if (req.method === 'GET' && pathname === '/config') {
      sendJson(res, {
        model: 'mock/mock-model',
        default_agent: 'build',
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/path') {
      sendJson(res, {
        home: directory,
        state: directory,
        config: directory,
        worktree: directory,
        directory,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/project') {
      sendJson(res, [{
        id: session.projectID,
        worktree: directory,
        vcs: 'git',
      }]);
      return;
    }

    if (req.method === 'GET' && pathname === '/vcs') {
      sendJson(res, { branch: 'reconnect-e2e' });
      return;
    }

    if (req.method === 'GET' && pathname === '/command') {
      sendJson(res, []);
      return;
    }

    if (req.method === 'GET' && pathname === '/mcp') {
      sendJson(res, {});
      return;
    }

    record('fallback', { method: req.method ?? 'UNKNOWN', pathname });
    sendJson(res, []);
  });

  const port = await listen(server);
  record('server.listening', { port });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    directory,
    timeline,
    triggerGap() {
      if (finalAvailable) {
        throw new Error('Reconnect gap was already triggered');
      }
      finalAvailable = true;
      gapTriggeredAt = Date.now();
      record('gap.triggered', {
        failureWindowMs: POST_GAP_FAILURE_WINDOW_MS,
      });
      for (const response of Array.from(openSseResponses)) {
        response.end();
      }
    },
    async close() {
      for (const response of Array.from(openSseResponses)) {
        response.destroy();
      }
      await closeServer(server);
    },
  };
};

const waitForHealth = async (baseUrl: string) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`OpenChamber did not become healthy at ${baseUrl}`);
};

test.describe('reconnect recovery', () => {
  let fakeOpenCode: FakeOpenCode;
  let openChamber: WebUiServerController;
  let openChamberBaseUrl: string;
  let tempRoot: string;
  let originalFetch: typeof globalThis.fetch;
  const blockedServerRequests: string[] = [];
  const originalEnv: Record<string, string | undefined> = {};
  const isolatedEnvKeys = [
    'HOME',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME',
    'OPENCODE_HOST',
    'OPENCODE_SKIP_START',
    'OPENCHAMBER_SKIP_OPENCODE_START',
    'OPENCHAMBER_RUNTIME',
  ] as const;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-reconnect-e2e-'));
    const directory = path.join(tempRoot, 'workspace');
    fs.mkdirSync(directory, { recursive: true });

    fakeOpenCode = await createFakeOpenCode(directory);
    for (const key of isolatedEnvKeys) {
      originalEnv[key] = process.env[key];
    }
    process.env.HOME = path.join(tempRoot, 'home');
    process.env.XDG_CACHE_HOME = path.join(tempRoot, 'cache');
    process.env.XDG_CONFIG_HOME = path.join(tempRoot, 'config');
    process.env.XDG_DATA_HOME = path.join(tempRoot, 'data');
    process.env.XDG_STATE_HOME = path.join(tempRoot, 'state');
    process.env.OPENCODE_HOST = fakeOpenCode.baseUrl;
    process.env.OPENCODE_SKIP_START = 'true';
    process.env.OPENCHAMBER_SKIP_OPENCODE_START = 'true';
    process.env.OPENCHAMBER_RUNTIME = 'web';
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const target = input instanceof URL
        ? input.toString()
        : typeof input === 'string'
          ? input
          : input.url;
      if (!isLoopbackUrl(target)) {
        blockedServerRequests.push(target);
        throw new Error(`Reconnect E2E blocked non-loopback request: ${target}`);
      }
      return originalFetch(input, init);
    };

    const serverModule = await import('../server/index.js') as {
      startWebUiServer: (options: {
        port: number;
        host: string;
        attachSignals: boolean;
        exitOnShutdown: boolean;
      }) => Promise<WebUiServerController>;
    };
    openChamber = await serverModule.startWebUiServer({
      port: 0,
      host: '127.0.0.1',
      attachSignals: false,
      exitOnShutdown: false,
    });
    const port = openChamber.getPort();
    if (!port) {
      throw new Error('OpenChamber did not expose a local E2E port');
    }
    openChamberBaseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(openChamberBaseUrl);
  });

  test.afterAll(async () => {
    await openChamber?.stop({ exitProcess: false, stopOpenCode: false });
    await fakeOpenCode?.close();
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    for (const key of isolatedEnvKeys) {
      const previous = originalEnv[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('restores a final assistant message after a no-ID SSE gap and a failed first materialization', async ({ page }, testInfo) => {
    const blockedBrowserRequests: string[] = [];
    const browserExternalResponses: string[] = [];
    const pageErrors: string[] = [];
    const readyFrames: Array<{ replayGap?: boolean; type?: string }> = [];

    await page.route('**/*', async (route) => {
      const target = route.request().url();
      if (!isLoopbackUrl(target)) {
        blockedBrowserRequests.push(target);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    page.on('response', (response) => {
      if (!isLoopbackUrl(response.url())) {
        browserExternalResponses.push(response.url());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/api/global/event/ws')) return;
      socket.on('framereceived', (frame) => {
        try {
          const parsed = JSON.parse(String(frame.payload)) as { replayGap?: boolean; type?: string };
          if (parsed.type === 'ready') readyFrames.push(parsed);
        } catch {
          return;
        }
      });
    });

    const url = new URL(openChamberBaseUrl);
    url.searchParams.set('ocPanel', 'session-chat');
    url.searchParams.set('sessionId', SESSION_ID);
    url.searchParams.set('directory', fakeOpenCode.directory);
    url.searchParams.set('readOnly', '1');
    await page.goto(url.toString());

    await expect(page.getByText(PARTIAL_TEXT, { exact: true })).toBeVisible();
    await expect(page.getByText(FINAL_TEXT, { exact: true })).toHaveCount(0);

    fakeOpenCode.triggerGap();

    await expect.poll(
      () => fakeOpenCode.timeline.filter((entry) => entry.event === 'messages.failed').length,
      { message: 'Expected the injected post-gap materialization failure' },
    ).toBeGreaterThan(0);
    await expect.poll(
      () => readyFrames.some((frame) => frame.replayGap === true),
      { message: 'Expected the WS bridge to report the no-ID replay gap' },
    ).toBe(true);

    await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible();
    await expect(page.getByText(FINAL_TEXT, { exact: true })).toHaveCount(1);
    await expect(page.getByText(PARTIAL_TEXT, { exact: true })).toHaveCount(0);

    const successfulRecovery = fakeOpenCode.timeline.find((entry) => (
      entry.event === 'messages.succeeded'
      && entry.detail?.finalAvailable === true
    ));
    expect(successfulRecovery).toBeTruthy();
    expect(successfulRecovery?.detail?.elapsedSinceGap).toEqual(expect.any(Number));
    expect(successfulRecovery?.detail?.elapsedSinceGap as number).toBeGreaterThanOrEqual(
      POST_GAP_FAILURE_WINDOW_MS,
    );
    expect(browserExternalResponses).toEqual([]);
    expect(pageErrors).toEqual([]);

    const evidence = {
      blockedBrowserRequests,
      blockedServerRequests,
      browserExternalResponses,
      readyFrames,
      timeline: fakeOpenCode.timeline,
    };
    console.log(`[reconnect-e2e] ${JSON.stringify(evidence)}`);
    await testInfo.attach('reconnect-timeline.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    });
  });

  test('switches context surfaces, resizes per surface, and collapses the rail on narrow viewports', async ({ page }) => {
    const pageErrors: string[] = [];
    await page.route('**/*', async (route) => {
      if (!isLoopbackUrl(route.request().url())) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const url = new URL(openChamberBaseUrl);
    url.searchParams.set('session', SESSION_ID);
    await page.goto(url.toString());
    await page.keyboard.press('Escape');

    const rail = page.getByRole('navigation', { name: 'Panel surfaces' });
    await expect(rail).toBeVisible();
    for (const label of ['Context', 'Git', 'Pull Request', 'Diff', 'Files', 'Terminal', 'Project notes', 'Browser']) {
      const button = rail.getByRole('button', { name: label });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(rail.getByRole('button', { name: 'Plan' })).toHaveCount(0);

    await rail.getByRole('button', { name: 'Git' }).click();
    const panel = page.locator('[data-context-panel="true"]');
    await expect(panel).toBeVisible();
    await panel.evaluate(async (element) => {
      let previousWidth = -1;
      let stableFrames = 0;
      while (stableFrames < 3) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const width = element.getBoundingClientRect().width;
        stableFrames = Math.abs(width - previousWidth) < 0.5 ? stableFrames + 1 : 0;
        previousWidth = width;
      }
    });
    const initialWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
    const resizeHandle = panel.locator('[role="separator"]').first();
    const handleBox = await resizeHandle.boundingBox();
    if (!handleBox) throw new Error('Context panel resize handle was not measurable');
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 120, handleBox.y + handleBox.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(
      () => panel.evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThan(initialWidth + 80);

    await page.setViewportSize({ width: 720, height: 900 });
    await expect(page.getByRole('navigation', { name: 'Panel surfaces' })).toBeVisible();
    let horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('navigation', { name: 'Panel surfaces' })).not.toBeVisible();
    horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
    expect(pageErrors).toEqual([]);
  });

  test('switches sidebar grouping and opens archive as a full-page surface', async ({ page }) => {
    const pageErrors: string[] = [];
    await page.route('**/*', async (route) => {
      if (!isLoopbackUrl(route.request().url())) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const url = new URL(openChamberBaseUrl);
    url.searchParams.set('session', SESSION_ID);
    await page.goto(url.toString());
    await page.keyboard.press('Escape');

    const displayModeButton = page.getByRole('button', { name: 'Session display mode' });
    await displayModeButton.click();
    await page.getByRole('menuitem', { name: 'Flat project list' }).click();
    await displayModeButton.click();
    await expect(page.getByRole('menuitem', { name: 'Flat project list' }).locator('svg')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Group by worktree' }).click();

    await page.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
    await expect(page.getByText('All directories')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('persists local dictation settings and opens the mobile dictation surface', async ({ page }) => {
    const pageErrors: string[] = [];
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        get: () => 1,
      });
    });
    await page.route('**/*', async (route) => {
      if (!isLoopbackUrl(route.request().url())) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const url = new URL(openChamberBaseUrl);
    url.searchParams.set('session', SESSION_ID);
    await page.context().grantPermissions(['microphone'], { origin: url.origin });
    await page.goto(url.toString());
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Voice beta' }).click();
    const voiceMode = page.getByRole('checkbox', { name: 'Enable voice mode' });
    if (!(await voiceMode.isChecked())) {
      await voiceMode.click();
    }
    await page.getByRole('button', { name: 'Local' }).click();
    await expect(page.getByRole('button', { name: 'Local' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.reload();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Voice beta' }).click();
    await expect(page.getByRole('button', { name: 'Local' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Server' }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(url.toString());
    await page.keyboard.press('Escape');
    await expect(page.getByText(PARTIAL_TEXT, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Dictate' }).click();
    await expect(page.getByText(/Listening/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText(/Listening/)).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

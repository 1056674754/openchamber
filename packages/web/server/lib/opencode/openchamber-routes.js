import express from 'express';
import { homedir } from 'node:os';

import {
  SessionMarkersPersistenceError,
  SessionMarkersValidationError,
} from './session-markers-store.js';
import { getPluginStatus } from './plugin-bootstrap.js';
import { publicEnterprisePolicy } from '../enterprise-mode.js';

export const registerOpenChamberRoutes = (app, dependencies) => {
  const {
    fs,
    path,
    process,
    server,
    __dirname,
    openchamberDataDir,
    modelsDevApiUrl,
    modelsMetadataCacheTtl,
    readSettingsFromDiskMigrated,
    fetchFreeZenModels,
    getCachedZenModels,
    unreadStore,
    markersStore,
    probePluginLoaded = null,
  } = dependencies;

  let cachedModelsMetadata = null;
  let cachedModelsMetadataTimestamp = 0;

  // Whether an administrator turned on enterprise mode, and by which source.
  // Pinned endpoints and keys never leave the server.
  app.get('/api/openchamber/enterprise-policy', (_req, res) => {
    res.json(publicEnterprisePolicy());
  });

  app.get('/api/openchamber/update-check', async (req, res) => {
    try {
      const { checkForUpdates } = await import('../package-manager.js');
      const parseString = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);
      const parseReportUsage = (value) => {
        if (typeof value !== 'string') return true;
        const normalized = value.trim().toLowerCase();
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        return true;
      };
      const inferDeviceClass = (ua) => {
        const value = (ua || '').toLowerCase();
        if (!value) return 'unknown';
        if (value.includes('ipad') || value.includes('tablet')) return 'tablet';
        if (value.includes('mobi') || value.includes('android') || value.includes('iphone')) return 'mobile';
        return 'desktop';
      };
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';

      const updateInfo = await checkForUpdates({
        appType: parseString(req.query.appType),
        deviceClass: parseString(req.query.deviceClass) || inferDeviceClass(userAgent),
        platform: parseString(req.query.platform),
        arch: parseString(req.query.arch),
        instanceMode: parseString(req.query.instanceMode),
        currentVersion: parseString(req.query.currentVersion),
        reportUsage: parseReportUsage(parseString(req.query.reportUsage)),
      });
      res.json(updateInfo);
    } catch (error) {
      console.error('Failed to check for updates:', error);
      res.status(500).json({
        available: false,
        error: error instanceof Error ? error.message : 'Failed to check for updates',
      });
    }
  });

  app.post('/api/openchamber/update-install', async (_req, res) => {
    try {
      const { spawn: spawnChild } = await import('child_process');
      const {
        checkForUpdates,
        getUpdateCommand,
        detectPackageManagerDetails,
      } = await import('../package-manager.js');

      const updateInfo = await checkForUpdates();
      if (!updateInfo.available) {
        return res.status(400).json({ error: 'No update available' });
      }

      const pmDetails = detectPackageManagerDetails();
      const pm = pmDetails.packageManager;
      const updateCmd = getUpdateCommand(pm);
      const isContainer =
        fs.existsSync('/.dockerenv') ||
        Boolean(process.env.CONTAINER) ||
        process.env.container === 'docker';

      if (isContainer) {
        res.json({
          success: true,
          message: 'Update starting, server will stay online',
          version: updateInfo.version,
          packageManager: pm,
          autoRestart: false,
        });

        setTimeout(() => {
          console.log(`\nInstalling update using ${pm} (container mode)...`);
          console.log(`Running: ${updateCmd}`);

          const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'sh';
          const shellFlag = process.platform === 'win32' ? '/c' : '-c';
          const child = spawnChild(shell, [shellFlag, updateCmd], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          });
          child.unref();
        }, 500);

        return;
      }

      const currentPort = server.address()?.port || 3000;
      const instanceFilePath = path.join(openchamberDataDir, 'run', `openchamber-${currentPort}.json`);
      let storedOptions = { port: currentPort, daemon: true };
      try {
        const content = await fs.promises.readFile(instanceFilePath, 'utf8');
        storedOptions = JSON.parse(content);
      } catch {
      }
      const launchMode = storedOptions.launchMode === 'foreground' ? 'foreground' : 'daemon';
      const isForegroundService = launchMode === 'foreground';

      const isWindows = process.platform === 'win32';
      const quotePosix = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
      const quoteCmd = (value) => {
        const stringValue = String(value);
        return `"${stringValue.replace(/"/g, '""')}"`;
      };

      const cliPath = path.resolve(__dirname, '..', 'bin', 'cli.js');
      const restartParts = [
        isWindows ? quoteCmd(process.execPath) : quotePosix(process.execPath),
        isWindows ? quoteCmd(cliPath) : quotePosix(cliPath),
        'serve',
        '--port',
        String(storedOptions.port),
      ];
      let restartCmdPrimary = restartParts.join(' ');
      let restartCmdFallback = `openchamber serve --port ${storedOptions.port}`;
      if (storedOptions.host) {
        if (isWindows) {
          const escapedHost = storedOptions.host.replace(/"/g, '""');
          restartCmdPrimary += ` --host "${escapedHost}"`;
          restartCmdFallback += ` --host "${escapedHost}"`;
        } else {
          const escapedHost = storedOptions.host.replace(/'/g, "'\\''");
          restartCmdPrimary += ` --host '${escapedHost}'`;
          restartCmdFallback += ` --host '${escapedHost}'`;
        }
      }
      if (storedOptions.uiPassword) {
        if (isWindows) {
          const escapedPw = storedOptions.uiPassword.replace(/"/g, '""');
          restartCmdPrimary += ` --ui-password "${escapedPw}"`;
          restartCmdFallback += ` --ui-password "${escapedPw}"`;
        } else {
          const escapedPw = storedOptions.uiPassword.replace(/'/g, "'\\''");
          restartCmdPrimary += ` --ui-password '${escapedPw}'`;
          restartCmdFallback += ` --ui-password '${escapedPw}'`;
        }
      }
      const restartCmd = isForegroundService ? '' : `(${restartCmdPrimary}) || (${restartCmdFallback})`;
      const updateLogPath = path.join(openchamberDataDir, 'update-install.log');
      const logPreamble = [
        '',
        `=== OpenChamber update ${new Date().toISOString()} ===`,
        `currentVersion=${updateInfo.currentVersion || 'unknown'}`,
        `targetVersion=${updateInfo.version || 'unknown'}`,
        `packageManager=${pm}`,
        `packageManagerReason=${pmDetails.reason || 'unknown'}`,
        `packageManagerCommand=${pmDetails.packageManagerCommand || 'unknown'}`,
        `packagePath=${pmDetails.packagePath || 'unknown'}`,
        `globalNodeModulesRoot=${pmDetails.globalNodeModulesRoot || 'unknown'}`,
        `mode=${isContainer ? 'container' : 'restart'}`,
        `launchMode=${launchMode}`,
        `updateCommand=${updateCmd}`,
        `restartCommand=${restartCmd || 'service-manager'}`,
        `logPath=${updateLogPath}`,
      ].join('\n');

      res.json({
        success: true,
        message: 'Update starting, server will restart shortly',
        version: updateInfo.version,
        packageManager: pm,
        autoRestart: true,
        restartManager: isForegroundService ? 'service' : 'cli',
      });

        setTimeout(() => {
          console.log(`\nInstalling update using ${pm}...`);
          console.log(`Running: ${updateCmd}`);
          console.log(logPreamble);

          const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'sh';
          const shellFlag = isWindows ? '/c' : '-c';
          const script = isWindows
            ? `
            echo ${quoteCmd(logPreamble)}
            timeout /t 2 /nobreak >nul
            ${updateCmd}
            if %ERRORLEVEL% EQU 0 (
              echo Update successful, restarting OpenChamber...
              ${restartCmd || 'echo Service manager will restart OpenChamber.'}
            ) else (
              echo Update failed
              exit /b 1
            )
            `
          : `
            printf '%s\\n' ${quotePosix(logPreamble)}
            sleep 2
            ${updateCmd}
            if [ $? -eq 0 ]; then
              echo "Update successful, restarting OpenChamber..."
              ${restartCmd || 'echo "Service manager will restart OpenChamber."'}
            else
              echo "Update failed"
              exit 1
            fi
          `;

        let logFd = null;
        try {
          fs.mkdirSync(path.dirname(updateLogPath), { recursive: true });
          logFd = fs.openSync(updateLogPath, 'a');
        } catch (logError) {
          console.warn('Failed to open update log file, continuing without log capture:', logError);
        }

        const child = spawnChild(shell, [shellFlag, script], {
          detached: true,
          stdio: logFd !== null ? ['ignore', logFd, logFd] : 'ignore',
          env: process.env,
        });
        child.unref();

        if (logFd !== null) {
          try {
            fs.closeSync(logFd);
          } catch {
          }
        }

        console.log('Update process spawned, shutting down server...');

        setTimeout(() => {
          process.exit(0);
        }, 500);
      }, 500);
    } catch (error) {
      console.error('Failed to install update:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to install update',
      });
    }
  });

  app.get('/api/openchamber/models-metadata', async (_req, res) => {
    const now = Date.now();

    if (cachedModelsMetadata && now - cachedModelsMetadataTimestamp < modelsMetadataCacheTtl) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.json(cachedModelsMetadata);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;

    try {
      const response = await fetch(modelsDevApiUrl, {
        signal: controller?.signal,
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`models.dev responded with status ${response.status}`);
      }

      const metadata = await response.json();
      cachedModelsMetadata = metadata;
      cachedModelsMetadataTimestamp = Date.now();

      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(metadata);
    } catch (error) {
      console.warn('Failed to fetch models.dev metadata via server:', error);

      if (cachedModelsMetadata) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(cachedModelsMetadata);
      } else {
        const statusCode = error?.name === 'AbortError' ? 504 : 502;
        res.status(statusCode).json({ error: 'Failed to retrieve model metadata' });
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  });

  // Proxy models.dev logos through the server with a disk cache: the UI must
  // not depend on direct browser TLS to models.dev (intermittent failures make
  // logos flicker), and once cached a logo never needs the network again.
  app.get('/api/openchamber/provider-logos/:name.svg', async (req, res) => {
    const rawName = String(req.params.name || '').toLowerCase().trim();
    const sanitizedName = rawName.replace(/[^a-z0-9_.-]/g, '');
    if (!sanitizedName || sanitizedName.startsWith('.') || sanitizedName.includes('..')) {
      return res.status(400).json({ error: 'Invalid provider name' });
    }

    const cacheDir = path.join(openchamberDataDir, 'provider-logos');
    const cacheFile = path.join(cacheDir, `${sanitizedName}.svg`);

    try {
      if (fs.existsSync(cacheFile)) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(cacheFile).pipe(res);
        return;
      }
    } catch (cacheError) {
      console.warn(`[openchamber] provider logo cache read failed for ${sanitizedName}:`, cacheError?.message || cacheError);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const logoUrl = `https://models.dev/logos/${encodeURIComponent(sanitizedName)}.svg`;
      const response = await fetch(logoUrl, {
        signal: controller?.signal,
        headers: { Accept: 'image/svg+xml,application/xml,text/xml' },
      });
      if (!response.ok) {
        throw new Error(`models.dev responded with status ${response.status}`);
      }
      const body = await response.text();
      if (!body || !/^\s*(<\?xml|<!DOCTYPE|<svg)/i.test(body)) {
        throw new Error('models.dev returned an unexpected logo payload');
      }
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
        const tmpFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpFile, body, 'utf8');
        fs.renameSync(tmpFile, cacheFile);
      } catch (writeError) {
        console.warn(`[openchamber] failed to persist provider logo to disk (${sanitizedName}):`, writeError?.message || writeError);
      }
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(body);
    } catch (error) {
      console.warn(`[openchamber] provider logo fetch failed for ${sanitizedName}:`, error?.message || error);
      res.status(error?.name === 'AbortError' ? 504 : 502).json({ error: 'Failed to fetch provider logo' });
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  });

  app.get('/api/zen/models', async (_req, res) => {
    try {
      const models = await fetchFreeZenModels();
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ models });
    } catch (error) {
      console.warn('Failed to fetch zen models:', error);
      const cachedZenModels = getCachedZenModels();
      if (cachedZenModels) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(cachedZenModels);
      } else {
        const statusCode = error?.name === 'AbortError' ? 504 : 502;
        res.status(statusCode).json({ error: 'Failed to retrieve zen models' });
      }
    }
  });

  app.get('/api/openchamber/sessions/unread', (_req, res) => {
    if (!unreadStore) return res.json({ sessions: {}, totalUnread: 0 });
    res.json({ sessions: unreadStore.getUnreadSessions(), totalUnread: unreadStore.getTotalUnread() });
  });

  app.post('/api/openchamber/sessions/:sessionId/read', (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    const state = unreadStore ? unreadStore.markRead(sessionId) : null;
    res.json({ ok: true, sessionId, state, totalUnread: unreadStore ? unreadStore.getTotalUnread() : 0 });
  });

  app.post('/api/openchamber/sessions/:sessionId/unread', (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    const state = unreadStore ? unreadStore.markUnread(sessionId) : null;
    res.json({ ok: true, sessionId, state, totalUnread: unreadStore ? unreadStore.getTotalUnread() : 0 });
  });

  app.get('/api/openchamber/sessions/markers', (_req, res) => {
    if (!markersStore) return res.json({ version: 1, sessions: {} });
    res.json(markersStore.getSnapshot());
  });

  app.put('/api/openchamber/sessions/:sessionId/markers', express.json({ limit: '16kb' }), (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    if (!markersStore) return res.status(503).json({ error: 'Markers store unavailable' });
    try {
      const markers = markersStore.applyPatch(sessionId, req.body || {});
      res.json({ sessionId, markers });
    } catch (error) {
      if (error instanceof SessionMarkersValidationError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof SessionMarkersPersistenceError) {
        return res.status(500).json({ error: error.message });
      }
      throw error;
    }
  });

  app.delete('/api/openchamber/sessions/:sessionId/markers', (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    if (!markersStore) return res.status(503).json({ error: 'Markers store unavailable' });
    try {
      markersStore.clear(sessionId);
    } catch (error) {
      if (error instanceof SessionMarkersPersistenceError) {
        return res.status(500).json({ error: error.message });
      }
      throw error;
    }
    res.json({ sessionId, cleared: true });
  });

  // Write focus text for the compaction plugin hook to pick up.
  // The UI calls this before sdk.session.summarize() when the user types
  // `/compact <focus text>`. The plugin reads and deletes the file (one-time use).
  app.post('/api/compact-focus', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const { sessionID, focus } = req.body || {};
      if (typeof sessionID !== 'string' || !sessionID.trim()) {
        return res.status(400).json({ error: 'sessionID is required' });
      }
      if (typeof focus !== 'string' || !focus.trim()) {
        return res.status(400).json({ error: 'focus text is required' });
      }

      const focusDir = path.resolve(homedir(), '.config', 'openchamber', 'compact-focus');
      await fs.promises.mkdir(focusDir, { recursive: true });
      const focusFile = path.join(focusDir, `${sessionID}.txt`);
      await fs.promises.writeFile(focusFile, focus, 'utf8');

      res.json({ ok: true });
    } catch (error) {
      console.error('[openchamber] Failed to write compact focus:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to write focus' });
    }
  });

  app.get('/api/openchamber/plugin-status', (_req, res) => {
    const status = getPluginStatus();
    // A cached failure is re-probed (throttled by the caller) so recovery after
    // a slow OpenCode boot reaches the UI instead of a permanent failure toast.
    if (!status.loaded && typeof probePluginLoaded === 'function') probePluginLoaded();
    res.json(status);
  });
};

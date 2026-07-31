import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRuntime } from './runtime-loader.mjs';

// Set the stable identity before any getPath() call. Electron memoizes
// userData/log paths, so doing this in the mutable runtime is too late.
app.setName('OpenChamber');
app.setPath('userData', path.join(app.getPath('appData'), 'OpenChamber'));

const appendShellLog = (message) => {
  try {
    const logDir = app.getPath('logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'shell.log'),
      `${new Date().toISOString()} ${message}\n`,
      'utf8',
    );
  } catch {
  }
};

const importRuntime = async (runtime) => {
  process.env.OPENCHAMBER_RUNTIME_ROOT = runtime.root;
  process.env.OPENCHAMBER_RUNTIME_SOURCE = runtime.source;
  process.env.OPENCHAMBER_SHELL_RESOURCES = process.resourcesPath;
  process.env.OPENCHAMBER_SHELL_APP_PATH = app.getAppPath();
  appendShellLog(
    `loading source=${runtime.source} root=${runtime.root}`
      + (runtime.fallbackReason ? ` fallback=${runtime.fallbackReason}` : ''),
  );
  await import(pathToFileURL(runtime.mainPath).href);
};

const embeddedRoot = app.getAppPath();
const selected = resolveRuntime({
  appDataPath: app.getPath('appData'),
  embeddedRoot,
});

try {
  await importRuntime(selected);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  appendShellLog(`runtime import failed: ${message}`);

  if (selected.source === 'external') {
    try {
      await importRuntime({
        root: embeddedRoot,
        manifest: null,
        mainPath: path.join(embeddedRoot, 'dist-bundle', 'main.mjs'),
        source: 'embedded',
        fallbackReason: `external import failed: ${message}`,
      });
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error
        ? fallbackError.stack || fallbackError.message
        : String(fallbackError);
      appendShellLog(`embedded fallback failed: ${fallbackMessage}`);
      dialog.showErrorBox('OpenChamber failed to start', fallbackMessage);
      app.exit(1);
    }
  } else {
    dialog.showErrorBox('OpenChamber failed to start', message);
    app.exit(1);
  }
}

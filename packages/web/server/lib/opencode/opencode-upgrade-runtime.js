import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OUTPUT_LIMIT_BYTES = 128 * 1024;
const UPGRADE_TIMEOUT_MS = 10 * 60 * 1000;

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');

const resolveRealPath = (binary) => {
  if (!binary) return '';
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(binary) : fs.realpathSync(binary);
  } catch {
    return binary;
  }
};

const appendBounded = (current, chunk) => {
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') <= OUTPUT_LIMIT_BYTES) return next;
  return next.slice(-OUTPUT_LIMIT_BYTES);
};

export const resolveOpenCodeUpgradeCommand = (resolution = {}) => {
  const binary = resolution.launchBinary || resolution.resolved || resolution.detectedNow || resolution.configured || '';
  const realBinary = resolveRealPath(binary);
  const normalizedBinary = normalizePath(binary).toLowerCase();
  const normalizedRealBinary = normalizePath(realBinary).toLowerCase();
  const candidates = `${normalizedBinary}\n${normalizedRealBinary}`;
  const home = normalizePath(os.homedir()).toLowerCase();

  if (candidates.includes('/homebrew/') || candidates.includes('/cellar/') || candidates.includes('/opt/homebrew/') || candidates.includes('/usr/local/')) {
    return {
      source: 'homebrew',
      command: 'brew upgrade anomalyco/tap/opencode || brew upgrade opencode',
      opencodeBinary: binary || null,
    };
  }

  if (home && candidates.includes(`${home}/.bun/`)) {
    return {
      source: 'bun',
      command: 'bun add -g opencode-ai@latest',
      opencodeBinary: binary || null,
    };
  }

  if (candidates.includes('/pnpm/') || candidates.includes('/.pnpm/')) {
    return {
      source: 'pnpm',
      command: 'pnpm add -g opencode-ai@latest',
      opencodeBinary: binary || null,
    };
  }

  if (candidates.includes('/.yarn/') || candidates.includes('/yarn/')) {
    return {
      source: 'yarn',
      command: 'yarn global add opencode-ai@latest',
      opencodeBinary: binary || null,
    };
  }

  if (candidates.includes('/node_modules/') || candidates.includes('/npm/')) {
    return {
      source: 'npm',
      command: 'npm install -g opencode-ai@latest',
      opencodeBinary: binary || null,
    };
  }

  if (home && candidates.includes(`${home}/.opencode/bin/`)) {
    return {
      source: 'official-install-script',
      command: 'curl -fsSL https://opencode.ai/install | bash',
      opencodeBinary: binary || null,
    };
  }

  return {
    source: 'unknown',
    command: null,
    opencodeBinary: binary || null,
  };
};

const runUpgradeCommand = (command) => new Promise((resolve) => {
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const child = spawn(command, {
    shell: true,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, UPGRADE_TIMEOUT_MS);

  child.stdout?.on('data', (chunk) => {
    stdout = appendBounded(stdout, String(chunk));
  });
  child.stderr?.on('data', (chunk) => {
    stderr = appendBounded(stderr, String(chunk));
  });
  child.on('error', (error) => {
    clearTimeout(timeout);
    resolve({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start OpenCode upgrade command',
      exitCode: null,
      signal: null,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
    });
  });
  child.on('close', (code, signal) => {
    clearTimeout(timeout);
    resolve({
      success: code === 0 && !timedOut,
      error: timedOut ? 'Direct OpenCode upgrade timed out' : code === 0 ? null : 'Direct OpenCode upgrade failed',
      exitCode: code,
      signal,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
    });
  });
});

export const executeDirectOpenCodeUpgrade = async ({
  getOpenCodeResolutionSnapshot,
  readSettingsFromDiskMigrated,
} = {}) => {
  const settings = typeof readSettingsFromDiskMigrated === 'function'
    ? await readSettingsFromDiskMigrated()
    : {};
  const resolution = typeof getOpenCodeResolutionSnapshot === 'function'
    ? await getOpenCodeResolutionSnapshot(settings)
    : {};
  const upgrade = resolveOpenCodeUpgradeCommand(resolution || {});

  if (!upgrade.command) {
    return {
      success: false,
      source: upgrade.source,
      opencodeBinary: upgrade.opencodeBinary,
      error: 'Unable to determine how OpenCode was installed',
    };
  }

  const result = await runUpgradeCommand(upgrade.command);
  return {
    ...result,
    source: upgrade.source,
    command: upgrade.command,
    opencodeBinary: upgrade.opencodeBinary,
  };
};

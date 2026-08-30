import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createConnectUrlCommand } from './commands-connect-url.js';

const temporaryDirectories = [];

const captureStdout = async (operation) => {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await operation();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
};

const decodeConnectUrl = (value) => {
  const encoded = new URL(value.trim()).searchParams.get('p');
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
};

const createCommand = async (overrides = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-connect-url-'));
  temporaryDirectories.push(dataDir);
  const serveCalls = [];
  const command = createConnectUrlCommand({
    serveCommand: async (options) => { serveCalls.push(options); },
    discoverRunningInstances: async () => [{ port: 3000 }],
    getInstanceFilePath: async () => path.join(dataDir, 'instance.json'),
    readInstanceOptions: () => null,
    assertSafeBrowserPort: () => undefined,
    resolveConfiguredBindHost: (host) => host || '127.0.0.1',
    buildLocalUrl: (port) => `http://127.0.0.1:${port}`,
    formatHostForUrl: (host) => host,
    getDataDir: () => dataDir,
    usageError: (message) => Object.assign(new Error(message), { exitCode: 2 }),
    ...overrides,
  });
  return { command, dataDir, serveCalls };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('connect-url command', () => {
  test('emits one direct+relay pairing URL and reuses the relay identity', async () => {
    const { command, dataDir } = await createCommand();
    const run = () => captureStdout(() => command({
      port: 3000,
      serverId: 'https://openchamber.example.test',
      name: 'QA host',
      relay: true,
      quiet: true,
    }));

    const first = decodeConnectUrl(await run());
    const second = decodeConnectUrl(await run());
    expect(first.candidates.map((candidate) => candidate.type)).toEqual(['tunnel', 'relay']);
    expect(second.candidates[1].serverId).toBe(first.candidates[1].serverId);
    const settings = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8'));
    expect(settings.relaySigningKey?.privateJwk).toBeTruthy();
    expect(settings.relayEncryptionKey?.privateJwk).toBeTruthy();
  });

  test('fails closed on corrupt settings without overwriting them', async () => {
    const { command, dataDir } = await createCommand();
    const settingsPath = path.join(dataDir, 'settings.json');
    await fs.writeFile(settingsPath, '{broken', 'utf8');

    await expect(command({
      port: 3000,
      serverId: 'https://openchamber.example.test',
      relay: true,
      quiet: true,
    })).rejects.toThrow('Settings file is corrupt or unreadable');
    expect(await fs.readFile(settingsPath, 'utf8')).toBe('{broken');
  });

  test('auto-starts the requested port and rejects invalid public URLs', async () => {
    const { command, serveCalls } = await createCommand({ discoverRunningInstances: async () => [] });
    await expect(command({ port: 3000, serverId: 'ftp://invalid', quiet: true })).rejects.toMatchObject({ exitCode: 2 });

    await captureStdout(() => command({ port: 3000, serverId: 'http://127.0.0.1:3000', quiet: true }));
    expect(serveCalls).toHaveLength(1);
    expect(serveCalls[0]).toMatchObject({ port: 3000, explicitPort: true, suppressQuietOutput: true });
  });
});

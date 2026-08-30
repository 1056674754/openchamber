import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createRemoteClientAuthRuntime } from '../../server/lib/client-auth/remote-clients.js';
import { createClientPairingRuntime } from '../../server/lib/client-auth/pairing.js';
import { createRelayIdentityRuntime } from '../../server/lib/relay/identity.js';
import { DEFAULT_RELAY_URL } from '../../server/lib/relay/service.js';
import { bytesToBase64Url } from '../../server/lib/relay/e2ee.js';
import {
  intro as clackIntro,
  outro as clackOutro,
  log as clackLog,
  isJsonMode,
  isQuietMode,
  printJson,
  logStatus,
} from '../cli-output.js';
import { createSettingsAccessors } from './cli-settings-accessors.js';

const REMOTE_CLIENTS_FILE_NAME = 'remote-clients.json';
const PAIRING_SESSIONS_FILE_NAME = 'client-pairing-sessions.json';

const isValidRelayUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
};

const resolveRelayUrl = (settings) => {
  if (isValidRelayUrl(process.env.OPENCHAMBER_RELAY_URL)) return process.env.OPENCHAMBER_RELAY_URL.trim();
  if (isValidRelayUrl(settings?.privateRelay?.relayUrl)) return settings.privateRelay.relayUrl.trim();
  return DEFAULT_RELAY_URL;
};

const normalizeServerUrl = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
};

const isWildcardHost = (host) => host === '0.0.0.0' || host === '::' || host === '[::]';

const detectLanIPv4Address = () => {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
};

const isLoopbackServerUrl = (serverUrl) => {
  try {
    const hostname = new URL(serverUrl).hostname.replace(/^\[|\]$/g, '');
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
};

const encodePairingConnectUrl = (payload) => {
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `openchamber://connect?v=2&p=${encoded}`;
};

const displayQrCode = async (url) => {
  try {
    const qrcode = await import('qrcode-terminal');
    qrcode.default.generate(url, { small: true });
  } catch (error) {
    console.warn(`Warning: Could not generate QR code: ${error.message}`);
  }
};

export const createConnectUrlCommand = ({
  serveCommand,
  discoverRunningInstances,
  getInstanceFilePath,
  readInstanceOptions,
  assertSafeBrowserPort,
  resolveConfiguredBindHost,
  buildLocalUrl,
  formatHostForUrl,
  getDataDir,
  usageError,
}) => {
  const createPairingRuntime = () => {
    const dataDir = getDataDir();
    const remoteClientAuthRuntime = createRemoteClientAuthRuntime({
      fsPromises: fs.promises,
      path,
      crypto,
      storePath: path.join(dataDir, REMOTE_CLIENTS_FILE_NAME),
    });
    return createClientPairingRuntime({
      fsPromises: fs.promises,
      path,
      crypto,
      storePath: path.join(dataDir, PAIRING_SESSIONS_FILE_NAME),
      remoteClientAuthRuntime,
    });
  };

  const buildRelayCandidate = async () => {
    const accessors = createSettingsAccessors({ fsPromises: fs.promises, path, dataDir: getDataDir() });
    return accessors.withSettingsTransaction(async (transaction) => {
      const settings = await transaction.readSettingsStrict();
      const identityRuntime = createRelayIdentityRuntime({ crypto, ...transaction });
      const identity = await identityRuntime.getRelayIdentity();
      const relayUrl = resolveRelayUrl(settings);
      return {
        enabled: settings?.privateRelay?.enabled === true,
        relayUrl,
        candidate: {
          type: 'relay',
          relayUrl,
          serverId: identity.serverId,
          hostEncPubJwk: identity.hostEncPubJwk,
          priority: 30,
        },
      };
    });
  };

  const resolveServerUrl = async (options) => {
    const explicit = normalizeServerUrl(options.serverId);
    if (options.serverId && !explicit) throw usageError('Invalid --server URL. Use an http:// or https:// URL.');
    if (explicit) return { serverUrl: explicit, source: 'explicit' };

    let hostOverride = options.host;
    if (typeof hostOverride !== 'string' && !process.env.OPENCHAMBER_HOST) {
      const stored = readInstanceOptions(await getInstanceFilePath(options.port));
      if (typeof stored?.host === 'string' && stored.host.trim()) hostOverride = stored.host.trim();
    }
    const bindHost = resolveConfiguredBindHost(hostOverride);
    const configuredUrl = normalizeServerUrl(bindHost);
    if (configuredUrl) return { serverUrl: configuredUrl, source: 'configured-host' };
    if (!isWildcardHost(bindHost)) {
      return { serverUrl: buildLocalUrl(options.port, '/', hostOverride).replace(/\/+$/, ''), source: 'configured-host' };
    }
    const lanAddress = detectLanIPv4Address();
    if (!lanAddress) return { serverUrl: buildLocalUrl(options.port, '/').replace(/\/+$/, ''), source: 'loopback-fallback' };
    return { serverUrl: `http://${formatHostForUrl(lanAddress)}:${options.port}`, source: 'lan-detected' };
  };

  return async (options = {}) => {
    assertSafeBrowserPort(options.port, { context: 'OpenChamber connect-url' });
    if (options.serverId && !normalizeServerUrl(options.serverId)) {
      throw usageError('Invalid --server URL. Use an http:// or https:// URL.');
    }
    const running = await discoverRunningInstances();
    const autoStarted = !running.some((entry) => entry.port === options.port);
    if (autoStarted) {
      await serveCommand({
        ...options,
        explicitPort: true,
        suppressUnsafePortWarning: true,
        suppressUiPasswordWarning: true,
        suppressStartupSummary: true,
        suppressQuietOutput: true,
      });
    }

    const resolved = await resolveServerUrl(options);
    const label = options.name || os.hostname();
    const candidates = [{
      type: resolved.serverUrl.startsWith('https://') ? 'tunnel' : 'lan',
      url: resolved.serverUrl,
      priority: 10,
    }];
    const relay = await buildRelayCandidate();
    if (options.relay || relay.enabled) candidates.push(relay.candidate);

    const usesRelay = candidates.some((candidate) => candidate.type === 'relay');
    const { pairing } = await createPairingRuntime().createPairingSession({ label, usesRelay });
    const payload = {
      v: 2,
      pairingId: pairing.id,
      secret: pairing.secret,
      ...(label ? { label } : {}),
      ...(pairing.fingerprint ? { fingerprint: pairing.fingerprint } : {}),
      ...(pairing.expiresAt ? { expiresAt: pairing.expiresAt } : {}),
      candidates,
    };
    const connectUrl = encodePairingConnectUrl(payload);

    if (isJsonMode(options)) {
      printJson({
        serverUrl: resolved.serverUrl,
        connectUrl,
        pairingId: pairing.id,
        fingerprint: pairing.fingerprint,
        expiresAt: pairing.expiresAt,
        candidates,
        autoStarted,
      });
      return;
    }
    if (isQuietMode(options)) {
      process.stdout.write(`${connectUrl}\n`);
      return;
    }

    clackIntro('OpenChamber pairing link');
    if (autoStarted) logStatus('success', `started OpenChamber on port ${options.port}`);
    logStatus('success', connectUrl);
    clackLog.info(`Server URL: ${resolved.serverUrl}`);
    if (options.relay || relay.enabled) clackLog.info(`Relay fallback: ${relay.relayUrl}`);
    if (options.relay && !relay.enabled) {
      logStatus('info', '[RELAY_STARTING]', 'Relay is not up yet. A running instance starts it within a minute.');
    }
    if (pairing.fingerprint) clackLog.info(`Fingerprint: ${pairing.fingerprint}`);
    if (resolved.source === 'lan-detected') {
      clackLog.info('Detected a LAN address because OpenChamber is bound to all interfaces. Use --server to override it.');
    } else if (resolved.source === 'loopback-fallback' || isLoopbackServerUrl(resolved.serverUrl)) {
      clackLog.warn(options.relay
        ? 'OpenChamber only listens on this machine, so devices will use the relay.'
        : 'OpenChamber only listens on this machine. Use --server or --relay for another device.');
    }
    if (options.qr === true) await displayQrCode(connectUrl);
    clackOutro('pairing link generated');
  };
};

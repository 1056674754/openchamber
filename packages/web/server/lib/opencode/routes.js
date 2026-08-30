import express from 'express';
import { createProjectIdFromPath } from '../projects/project-id.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeDirectOpenCodeUpgrade as defaultExecuteDirectOpenCodeUpgrade } from './opencode-upgrade-runtime.js';
import {
  getProviderAuthStates,
  removeProviderAuth as removeProviderAuthWithAdapter,
} from '../subscriptions/auth-adapter.js';
import { buildDeferredRestartResponse } from './config-mutation-response.js';
import { getClaudeCliAuthStatus } from './claude-cli-auth.js';

export const registerOpenCodeRoutes = (app, dependencies) => {
  const {
    crypto,
    getOpenCodeResolutionSnapshot,
    getOpenCodeUpgradeCapability,
    formatSettingsResponse,
    readSettingsFromDisk,
    readSettingsFromDiskMigrated,
    persistSettings,
    sanitizeProjects,
    validateDirectoryPath,
    resolveProjectDirectory,
    getProviderSources,
    removeProviderConfig,
    upsertProviderConfig,
    markPendingConfigRestart,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    fetchProvidersSnapshot,
    isAgentMemoryAvailable = () => false,
    executeDirectOpenCodeUpgrade = defaultExecuteDirectOpenCodeUpgrade,
  } = dependencies;

  let authLibrary = null;
  let openCodeUpgradePromise = null;
  const pendingMcpAuthContextByState = new Map();
  const PENDING_MCP_AUTH_TTL_MS = 30 * 60 * 1000;
  const getAuthLibrary = async () => {
    if (!authLibrary) {
      authLibrary = await import('./auth.js');
    }
    return authLibrary;
  };

  const normalizePendingString = (value) => {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed || null;
  };

  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const renderMcpOAuthCallbackPage = ({ title, message, desktopReturn }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — OpenChamber</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: Canvas; color: CanvasText; }
  main { max-width: 34rem; padding: 2.5rem 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { margin: 0; line-height: 1.5; opacity: 0.85; }
  a.return { display: inline-block; margin-top: 1.5rem; padding: 0.5rem 1.25rem; border-radius: 0.5rem;
             border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); color: inherit; text-decoration: none; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
${desktopReturn ? `<a class="return" href="openchamber://focus/mcp-auth">Return to OpenChamber</a>
<script>window.location.href = 'openchamber://focus/mcp-auth';</script>` : ''}
</main>
</body>
</html>`;

  const parseVersionForComparison = (value) => {
    const normalized = String(value || '').replace(/^v/, '');
    const withoutBuildMetadata = normalized.split('+')[0];
    const prereleaseIndex = withoutBuildMetadata.indexOf('-');
    const core = prereleaseIndex >= 0 ? withoutBuildMetadata.slice(0, prereleaseIndex) : withoutBuildMetadata;
    const prerelease = prereleaseIndex >= 0 ? withoutBuildMetadata.slice(prereleaseIndex + 1) : '';
    const parts = core.split('.').map((part) => {
      const parsed = Number.parseInt(part || '0', 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    return { parts, prerelease };
  };

  const compareVersionCore = (left, right) => {
    const a = parseVersionForComparison(left);
    const b = parseVersionForComparison(right);
    const length = Math.max(a.parts.length, b.parts.length);
    for (let index = 0; index < length; index += 1) {
      const diff = (a.parts[index] || 0) - (b.parts[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  const isKnownReleasePrerelease = (version) => {
    const parsed = parseVersionForComparison(version);
    const firstIdentifier = parsed.prerelease.split('.')[0]?.toLowerCase();
    return ['alpha', 'beta', 'canary', 'dev', 'next', 'nightly', 'pre', 'preview', 'rc'].includes(firstIdentifier);
  };

  const compareVersions = (left, right) => {
    const coreComparison = compareVersionCore(left, right);
    if (coreComparison !== 0) return coreComparison;
    const a = parseVersionForComparison(left);
    const b = parseVersionForComparison(right);
    if (a.prerelease !== b.prerelease) {
      if (!a.prerelease) return 1;
      if (!b.prerelease) return -1;
    }
    return 0;
  };

  const isOpenCodeUpgradeAvailable = (latestVersion, currentVersion) => {
    const coreComparison = compareVersionCore(latestVersion, currentVersion);
    if (coreComparison !== 0) return coreComparison > 0;
    const current = parseVersionForComparison(currentVersion);
    const latest = parseVersionForComparison(latestVersion);
    if (!latest.prerelease && current.prerelease && !isKnownReleasePrerelease(currentVersion)) {
      return false;
    }
    return compareVersions(latestVersion, currentVersion) > 0;
  };

  const fetchLatestOpenCodeVersionFromGithub = async () => {
    const response = await fetch('https://api.github.com/repos/anomalyco/opencode/releases/latest', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OpenCode releases responded with ${response.status}`);
    }
    const payload = await response.json();
    const tag = typeof payload?.tag_name === 'string' ? payload.tag_name.trim() : '';
    return tag.replace(/^v/, '');
  };

  const fetchLatestOpenCodeVersionFromNpm = async () => {
    const response = await fetch('https://registry.npmjs.org/opencode-ai/latest', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OpenCode npm registry responded with ${response.status}`);
    }
    const payload = await response.json();
    return typeof payload?.version === 'string' ? payload.version.trim().replace(/^v/, '') : '';
  };

  const fetchLatestOpenCodeVersion = async () => {
    const results = await Promise.allSettled([
      fetchLatestOpenCodeVersionFromNpm(),
      fetchLatestOpenCodeVersionFromGithub(),
    ]);
    const versions = results
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value);
    if (versions.length === 0) {
      const failure = results.find((result) => result.status === 'rejected');
      throw failure?.reason instanceof Error ? failure.reason : new Error('Failed to resolve latest OpenCode version');
    }
    return versions.sort((left, right) => compareVersions(right, left))[0];
  };

  const openCodeUpgradeDiagnosticFields = [
    'copyText',
    'message',
    'manager',
    'packageManager',
    'command',
    'exitCode',
    'code',
    'stderr',
    'stdout',
    'output',
    'logs',
    'detail',
    'details',
    'cause',
  ];

  const pickOpenCodeUpgradeDiagnostics = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }

    const diagnostics = {};
    for (const key of openCodeUpgradeDiagnosticFields) {
      if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined) {
        diagnostics[key] = payload[key];
      }
    }
    return diagnostics;
  };

  const resolveOpenCodeUpgradeError = (payload, fallback) => {
    if (typeof payload === 'string' && payload.trim()) {
      return payload.trim();
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return fallback;
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.data?.message === 'string' && payload.data.message.trim()) {
      return payload.data.message.trim();
    }
    return fallback;
  };

  const runDirectOpenCodeUpgrade = async (upstream) => {
    const result = await executeDirectOpenCodeUpgrade({
      getOpenCodeResolutionSnapshot,
      readSettingsFromDiskMigrated,
    });

    if (!result?.success) {
      return {
        status: 500,
        body: {
          ...(result || {}),
          success: false,
          upgradeSource: 'direct',
          error: result?.error || 'Direct OpenCode upgrade failed',
          upstream,
        },
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        upgraded: true,
        requiresReload: true,
        restarted: false,
        upgradeSource: 'direct',
        ...result,
        upstream,
      },
    };
  };

  const readOpenCodeCurrentVersion = async () => {
    const response = await fetch(buildOpenCodeUrl('/global/health', ''), {
      method: 'GET',
      headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
    });
    const payload = await response.json().catch(() => null);
    const currentVersion = typeof payload?.version === 'string'
      ? payload.version.trim().replace(/^v/, '')
      : null;
    return { ok: response.ok, currentVersion };
  };

  const pruneExpiredPendingMcpAuthContexts = () => {
    const now = Date.now();
    for (const [state, entry] of pendingMcpAuthContextByState.entries()) {
      if (!entry || typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) {
        pendingMcpAuthContextByState.delete(state);
      }
    }
  };

  app.get('/api/config/settings', async (_req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      res.json({
        ...formatSettingsResponse(settings),
        agentMemoryAvailable: isAgentMemoryAvailable() === true,
      });
    } catch (error) {
      console.error('Failed to read settings:', error);
      res.status(500).json({ error: 'Failed to read settings' });
    }
  });

  app.get('/api/config/opencode-resolution', async (_req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const resolution = await getOpenCodeResolutionSnapshot(settings);
      res.json(resolution);
    } catch (error) {
      console.error('Failed to resolve OpenCode binary:', error);
      res.status(500).json({ error: 'Failed to resolve OpenCode binary' });
    }
  });

  app.post('/api/opencode/upgrade', async (req, res) => {
    const requestedTarget = typeof req.body?.target === 'string' && req.body.target.trim().length > 0
      ? req.body.target.trim()
      : undefined;
    const capability = getOpenCodeUpgradeCapability();
    if (!capability.supported) {
      return res.status(409).json({
        success: false,
        code: capability.reason === 'bundled'
          ? 'OPENCODE_UPGRADE_MANAGED_BY_OPENCHAMBER'
          : 'OPENCODE_UPGRADE_UNSUPPORTED',
        error: capability.reason === 'bundled'
          ? 'OpenCode is bundled with OpenChamber Desktop and updates with the app.'
          : 'This OpenCode runtime cannot be upgraded by OpenChamber.',
      });
    }
    if (openCodeUpgradePromise) {
      return res.status(409).json({
        success: false,
        code: 'OPENCODE_UPGRADE_IN_PROGRESS',
        error: 'An OpenCode upgrade is already in progress.',
      });
    }

    const operation = (async () => {
      let target = requestedTarget;
      if (!target) {
        try {
          target = await fetchLatestOpenCodeVersion();
        } catch (error) {
          return {
            status: 502,
            body: {
              success: false,
              code: 'OPENCODE_UPGRADE_TARGET_UNRESOLVED',
              error: `Could not determine which OpenCode version to install: ${error instanceof Error ? error.message : String(error)}`,
            },
          };
        }
      }

      try {
        const response = await fetch(buildOpenCodeUrl('/global/upgrade', ''), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...getOpenCodeAuthHeaders(),
          },
          body: JSON.stringify({ target }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const upstream = {
            success: false,
            error: resolveOpenCodeUpgradeError(payload, response.statusText || 'Failed to upgrade OpenCode'),
            status: response.status,
            ...pickOpenCodeUpgradeDiagnostics(payload),
          };
          if (!requestedTarget) {
            return runDirectOpenCodeUpgrade(upstream);
          }
          return {
            status: response.status,
            body: {
              success: false,
              error: upstream.error,
              ...pickOpenCodeUpgradeDiagnostics(payload),
            },
          };
        }

        return {
          status: 200,
          body: { ...(payload ?? { success: true }), requiresReload: true, restarted: false },
        };
      } catch (error) {
        if (!requestedTarget) {
          return runDirectOpenCodeUpgrade({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to upgrade OpenCode',
          });
        }
        console.error('Failed to upgrade OpenCode:', error);
        return {
          status: 500,
          body: {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to upgrade OpenCode',
          },
        };
      }
    })();

    openCodeUpgradePromise = operation;
    try {
      const result = await operation;
      return res.status(result.status).json(result.body);
    } finally {
      if (openCodeUpgradePromise === operation) openCodeUpgradePromise = null;
    }
  });

  app.get('/api/opencode/upgrade-status', async (_req, res) => {
    try {
      const capability = getOpenCodeUpgradeCapability();
      if (!capability.supported) {
        const current = await readOpenCodeCurrentVersion().catch(() => ({
          ok: false,
          currentVersion: null,
        }));
        return res.json({
          available: false,
          currentVersion: current.ok ? current.currentVersion : null,
          latestVersion: null,
          upgrade: capability,
        });
      }

      const [healthResponse, latestVersion] = await Promise.all([
        fetch(buildOpenCodeUrl('/global/health', ''), {
          method: 'GET',
          headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
        }),
        fetchLatestOpenCodeVersion(),
      ]);
      const health = await healthResponse.json().catch(() => null);
      if (!healthResponse.ok) {
        return res.status(healthResponse.status).json({
          available: null,
          error: health?.error || healthResponse.statusText || 'Failed to read OpenCode version',
          upgrade: capability,
        });
      }
      const currentVersion = typeof health?.version === 'string' ? health.version.replace(/^v/, '') : null;
      if (!currentVersion || !latestVersion) {
        return res.json({
          available: null,
          currentVersion,
          latestVersion: latestVersion || null,
          upgrade: capability,
        });
      }
      const available = isOpenCodeUpgradeAvailable(latestVersion, currentVersion);
      return res.json({
        available,
        currentVersion,
        latestVersion,
        upgrade: capability,
      });
    } catch (error) {
      return res.status(500).json({
        available: null,
        error: error instanceof Error ? error.message : 'Failed to check OpenCode upgrade status',
      });
    }
  });

  app.get('/api/opencode/health', async (_req, res) => {
    try {
      const healthResponse = await fetch(buildOpenCodeUrl('/api/health', ''), {
        method: 'GET',
        headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
      });
      const health = await healthResponse.json().catch(() => null);
      if (!healthResponse.ok) {
        return res.status(healthResponse.status).json({
          healthy: false,
          error: health?.error || healthResponse.statusText || 'OpenCode health check failed',
        });
      }
      return res.json({ healthy: health?.healthy === true });
    } catch (error) {
      return res.status(503).json({
        healthy: false,
        error: error instanceof Error ? error.message : 'OpenCode health check failed',
      });
    }
  });

  app.get('/api/opencode/version', async (_req, res) => {
    try {
      const healthResponse = await fetch(buildOpenCodeUrl('/global/health', ''), {
        method: 'GET',
        headers: { Accept: 'application/json', ...getOpenCodeAuthHeaders() },
      });
      const health = await healthResponse.json().catch(() => null);
      if (!healthResponse.ok) {
        return res.status(healthResponse.status).json({
          version: null,
          error: health?.error || healthResponse.statusText || 'Failed to read OpenCode version',
        });
      }
      const version = typeof health?.version === 'string' ? health.version.replace(/^v/, '') : null;
      return res.json({ version });
    } catch (error) {
      return res.status(500).json({
        version: null,
        error: error instanceof Error ? error.message : 'Failed to read OpenCode version',
      });
    }
  });

  app.put('/api/config/settings', async (req, res) => {
    console.log('[API:PUT /api/config/settings] Received request');
    try {
      const previous = typeof req.body?.agentMemoryToolEnabled === 'boolean'
        ? await readSettingsFromDiskMigrated()
        : null;
      const updated = await persistSettings(req.body ?? {});
      if (
        previous
        && typeof req.body.agentMemoryToolEnabled === 'boolean'
        && previous.agentMemoryToolEnabled !== updated.agentMemoryToolEnabled
      ) {
        markPendingConfigRestart('Agent Memory tool setting changed', {
          scope: 'agent-memory',
        });
      }
      console.log(`[API:PUT /api/config/settings] Success, returning ${updated.projects?.length || 0} projects`);
      res.json(updated);
    } catch (error) {
      console.error('[API:PUT /api/config/settings] Failed to save settings:', error);
      console.error('[API:PUT /api/config/settings] Error stack:', error.stack);
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  app.post('/api/mcp/auth/pending', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      pruneExpiredPendingMcpAuthContexts();

      const state = normalizePendingString(req.body?.state);
      if (!state) {
        return res.json({ success: true, context: null });
      }

      const name = normalizePendingString(req.body?.name);
      if (!name) {
        return res.status(400).json({ error: 'MCP server name is required' });
      }

      const entry = {
        name,
        directory: normalizePendingString(req.body?.directory),
        origin: normalizePendingString(req.body?.origin),
        completionMode: req.body?.completionMode === 'client' ? 'client' : 'server',
        expiresAt: Date.now() + PENDING_MCP_AUTH_TTL_MS,
      };
      pendingMcpAuthContextByState.set(state, entry);

      return res.json({
        success: true,
        context: {
          name: entry.name,
          directory: entry.directory,
          origin: entry.origin,
          completionMode: entry.completionMode,
        },
      });
    } catch (error) {
      console.error('Failed to store pending MCP auth context:', error);
      return res.status(500).json({ error: error.message || 'Failed to store pending MCP auth context' });
    }
  });

  app.get('/api/mcp/auth/pending', async (req, res) => {
    try {
      pruneExpiredPendingMcpAuthContexts();

      const state = normalizePendingString(Array.isArray(req.query?.state) ? req.query.state[0] : req.query?.state);
      if (!state) {
        return res.json(null);
      }

      const pendingMcpAuthContext = pendingMcpAuthContextByState.get(state) ?? null;
      if (!pendingMcpAuthContext) {
        return res.status(404).json({ error: 'No pending MCP auth context' });
      }

      return res.json(pendingMcpAuthContext);
    } catch (error) {
      console.error('Failed to read pending MCP auth context:', error);
      return res.status(500).json({ error: error.message || 'Failed to read pending MCP auth context' });
    }
  });

  app.delete('/api/mcp/auth/pending', async (req, res) => {
    try {
      const state = normalizePendingString(Array.isArray(req.query?.state) ? req.query.state[0] : req.query?.state);
      if (!state) {
        return res.json({ success: true });
      }

      pendingMcpAuthContextByState.delete(state);
      return res.json({ success: true });
    } catch (error) {
      console.error('Failed to clear pending MCP auth context:', error);
      return res.status(500).json({ error: error.message || 'Failed to clear pending MCP auth context' });
    }
  });

  app.get('/mcp/oauth/callback', async (req, res) => {
    const queryValue = (key) => normalizePendingString(
      Array.isArray(req.query?.[key]) ? req.query[key][0] : req.query?.[key],
    );
    const state = queryValue('state');
    const code = queryValue('code');
    const providerError = queryValue('error');
    const providerErrorDescription = queryValue('error_description');

    pruneExpiredPendingMcpAuthContexts();
    const context = state ? pendingMcpAuthContextByState.get(state) ?? null : null;
    const startedFromDesktop = context?.origin === 'desktop';

    const finish = (status, { title, message, retainContext = false }) => {
      if (state && !retainContext) pendingMcpAuthContextByState.delete(state);
      res.status(status).type('html').send(renderMcpOAuthCallbackPage({
        title,
        message,
        desktopReturn: startedFromDesktop,
      }));
    };

    if (!context?.name) {
      return finish(400, {
        title: 'Authorization Failed',
        message: 'This authorization session has expired or is unknown to the running app. Return to OpenChamber and click Authorize again.',
      });
    }

    if (providerError) {
      if (context.completionMode === 'client') {
        pendingMcpAuthContextByState.set(state, {
          ...context,
          error: providerErrorDescription || providerError,
        });
      }
      return finish(400, {
        title: 'Authorization Failed',
        message: providerErrorDescription || providerError,
        retainContext: context.completionMode === 'client',
      });
    }
    if (!code) {
      return finish(400, {
        title: 'Authorization Failed',
        message: 'The provider did not return an authorization code. Start authorization again from MCP Settings.',
      });
    }

    if (context.completionMode === 'client') {
      pendingMcpAuthContextByState.set(state, { ...context, code });
      return finish(200, {
        title: 'Authorization Complete',
        message: 'Return to OpenChamber to finish connecting this MCP server.',
        retainContext: true,
      });
    }

    try {
      const callbackUrl = new URL(buildOpenCodeUrl(`/mcp/${encodeURIComponent(context.name)}/auth/callback`, ''));
      if (context.directory) callbackUrl.searchParams.set('directory', context.directory);
      const upstream = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...getOpenCodeAuthHeaders() },
        body: JSON.stringify({ code }),
      });
      if (!upstream.ok) {
        const payload = await upstream.json().catch(() => null);
        return finish(502, {
          title: 'Authorization Failed',
          message: payload?.error || payload?.message || `OpenCode rejected the authorization code (${upstream.status}). Start authorization again from MCP Settings.`,
        });
      }
      return finish(200, {
        title: 'Authorization Complete',
        message: 'You can close this tab and return to OpenChamber.',
      });
    } catch (error) {
      return finish(502, {
        title: 'Authorization Failed',
        message: error?.message || 'Failed to complete MCP authorization.',
      });
    }
  });

  app.get('/api/provider/:providerId/source', async (req, res) => {
    try {
      const { providerId } = req.params;
      if (!providerId) {
        return res.status(400).json({ error: 'Provider ID is required' });
      }

      const headerDirectory = typeof req.get === 'function' ? req.get('x-opencode-directory') : null;
      const queryDirectory = Array.isArray(req.query?.directory)
        ? req.query.directory[0]
        : req.query?.directory;
      const requestedDirectory = headerDirectory || queryDirectory || null;

      let directory = null;
      const resolved = await resolveProjectDirectory(req);
      if (resolved.directory) {
        directory = resolved.directory;
      } else if (requestedDirectory) {
        return res.status(400).json({ error: resolved.error });
      }

      const sources = getProviderSources(providerId, directory);
      const { listProviderAuths } = await getAuthLibrary();
      const authResult = await getProviderAuthStates({
        fetchProvidersSnapshot,
        buildOpenCodeUrl,
        getOpenCodeAuthHeaders,
        listProviderAuths,
      });
      sources.sources.auth.exists = providerId === 'claude-code'
        ? getClaudeCliAuthStatus().connected
        : authResult.states[providerId]?.configured === true;

      return res.json({
        providerId,
        sources: sources.sources,
      });
    } catch (error) {
      console.error('Failed to get provider sources:', error);
      return res.status(500).json({ error: error.message || 'Failed to get provider sources' });
    }
  });

  app.put('/api/provider', async (req, res) => {
    try {
      const providerID = typeof req.body?.providerID === 'string'
        ? req.body.providerID.trim()
        : (typeof req.body?.providerId === 'string' ? req.body.providerId.trim() : '');
      const config = req.body?.config;
      const scope = typeof req.body?.scope === 'string' ? req.body.scope : 'user';

      if (!providerID) {
        return res.status(400).json({ error: 'Provider ID is required' });
      }
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return res.status(400).json({ error: 'Provider config is required' });
      }
      if (scope !== 'user' && scope !== 'project' && scope !== 'custom') {
        return res.status(400).json({ error: 'Invalid scope' });
      }

      const headerDirectory = typeof req.get === 'function' ? req.get('x-opencode-directory') : null;
      const queryDirectory = Array.isArray(req.query?.directory)
        ? req.query.directory[0]
        : req.query?.directory;
      const requestedDirectory = headerDirectory || queryDirectory || null;

      let directory = null;
      if (scope === 'project' || requestedDirectory) {
        const resolved = await resolveProjectDirectory(req);
        if (!resolved.directory) {
          return res.status(400).json({ error: resolved.error || 'Working directory is required' });
        }
        directory = resolved.directory;
      } else {
        const resolved = await resolveProjectDirectory(req);
        if (resolved.directory) {
          directory = resolved.directory;
        }
      }

      const { listProviderAuths } = await getAuthLibrary();
      const authResult = await getProviderAuthStates({
        fetchProvidersSnapshot,
        buildOpenCodeUrl,
        getOpenCodeAuthHeaders,
        listProviderAuths,
      });
      const hasStoredAuth = authResult.states[providerID]?.configured === true;
      const upsertResult = upsertProviderConfig(providerID, config, directory, scope, { hasStoredAuth });
      const pendingRestart = markPendingConfigRestart(`provider ${providerID} upserted (${scope})`, {
        scope: 'providers',
        entityId: providerID,
      });

      return res.json({
        providerId: upsertResult.providerId,
        path: upsertResult.path,
        config: upsertResult.config,
        ...buildDeferredRestartResponse(
          'Provider configuration saved. Restart OpenCode to apply.',
          pendingRestart,
        ),
      });
    } catch (error) {
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 500;
      console.error('Failed to upsert provider config:', error);
      return res.status(status).json({ error: error.message || 'Failed to save provider config' });
    }
  });

  app.delete('/api/provider/:providerId/auth', async (req, res) => {
    try {
      const { providerId } = req.params;
      if (!providerId) {
        return res.status(400).json({ error: 'Provider ID is required' });
      }

      const scope = typeof req.query?.scope === 'string' ? req.query.scope : 'auth';
      const headerDirectory = typeof req.get === 'function' ? req.get('x-opencode-directory') : null;
      const queryDirectory = Array.isArray(req.query?.directory)
        ? req.query.directory[0]
        : req.query?.directory;
      const requestedDirectory = headerDirectory || queryDirectory || null;
      let directory = null;

      if (scope === 'project' || requestedDirectory) {
        const resolved = await resolveProjectDirectory(req);
        if (!resolved.directory) {
          return res.status(400).json({ error: resolved.error });
        }
        directory = resolved.directory;
      } else {
        const resolved = await resolveProjectDirectory(req);
        if (resolved.directory) {
          directory = resolved.directory;
        }
      }

      let removed = false;
      if (scope === 'auth') {
        const { removeProviderAuth: removeLegacyProviderAuth } = await getAuthLibrary();
        const result = await removeProviderAuthWithAdapter(providerId, {
          buildOpenCodeUrl,
          getOpenCodeAuthHeaders,
          removeLegacyProviderAuth,
        });
        console.log(`[subscriptions] Removed provider auth via ${result.path}: ${providerId}`);
        removed = result.removed;
      } else if (scope === 'user' || scope === 'project' || scope === 'custom') {
        removed = removeProviderConfig(providerId, directory, scope);
      } else if (scope === 'all') {
        const { removeProviderAuth: removeLegacyProviderAuth } = await getAuthLibrary();
        const authResult = await removeProviderAuthWithAdapter(providerId, {
          buildOpenCodeUrl,
          getOpenCodeAuthHeaders,
          removeLegacyProviderAuth,
        });
        console.log(`[subscriptions] Removed provider auth via ${authResult.path}: ${providerId}`);
        const authRemoved = authResult.removed;
        const userRemoved = removeProviderConfig(providerId, directory, 'user');
        const projectRemoved = directory ? removeProviderConfig(providerId, directory, 'project') : false;
        const customRemoved = removeProviderConfig(providerId, directory, 'custom');
        removed = authRemoved || userRemoved || projectRemoved || customRemoved;
      } else {
        return res.status(400).json({ error: 'Invalid scope' });
      }

      if (removed) {
        const pendingRestart = markPendingConfigRestart(`provider ${providerId} disconnected (${scope})`, {
          scope: 'providers',
          entityId: providerId,
        });
        return res.json({
          removed,
          ...buildDeferredRestartResponse(
            'Provider disconnected successfully. Restart OpenCode to apply.',
            pendingRestart,
          ),
        });
      }

      return res.json({
        success: true,
        removed,
        requiresReload: false,
        message: 'Provider was not connected',
      });
    } catch (error) {
      console.error('Failed to disconnect provider:', error);
      return res.status(500).json({ error: error.message || 'Failed to disconnect provider' });
    }
  });

  app.post('/api/opencode/directory', async (req, res) => {
    try {
      const requestedPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
      if (!requestedPath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      if (req.body?.create === true) {
        await fs.promises.mkdir(path.resolve(requestedPath), { recursive: true });
      }

      const validated = await validateDirectoryPath(requestedPath);
      if (!validated.ok) {
        return res.status(400).json({ error: validated.error });
      }

      const resolvedPath = validated.directory;
      const currentSettings = await readSettingsFromDisk();
      const existingProjects = sanitizeProjects(currentSettings.projects) || [];
      const existing = existingProjects.find((project) => project.path === resolvedPath) || null;

      const nextProjects = existing
        ? existingProjects
        : [
            ...existingProjects,
            {
              id: createProjectIdFromPath(resolvedPath),
              path: resolvedPath,
              addedAt: Date.now(),
              lastOpenedAt: Date.now(),
            },
          ];

      const activeProjectId = existing ? existing.id : nextProjects[nextProjects.length - 1].id;

      const updated = await persistSettings({
        projects: nextProjects,
        activeProjectId,
        lastDirectory: resolvedPath,
      });

      return res.json({
        success: true,
        restarted: false,
        path: resolvedPath,
        settings: updated,
      });
    } catch (error) {
      console.error('Failed to update OpenCode working directory:', error);
      return res.status(500).json({ error: error.message || 'Failed to update working directory' });
    }
  });

  // Behavior / Global AGENTS.md endpoints
  const AGENTS_MD_PATH = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
  const MAX_BEHAVIOR_PROMPT_SIZE = 1024 * 1024; // 1 MB

  app.get('/api/behavior/agents-md', async (_req, res) => {
    try {
      try {
        await fs.promises.access(AGENTS_MD_PATH);
      } catch {
        return res.json({ content: '', exists: false });
      }
      const content = await fs.promises.readFile(AGENTS_MD_PATH, 'utf8');
      return res.json({ content, exists: true });
    } catch (error) {
      console.error('Failed to read AGENTS.md:', error);
      return res.status(500).json({ error: 'Failed to read AGENTS.md' });
    }
  });

  app.put('/api/behavior/agents-md', async (req, res) => {
    try {
      const content = typeof req.body?.content === 'string' ? req.body.content : '';

      if (content.length > MAX_BEHAVIOR_PROMPT_SIZE) {
        return res.status(413).json({ error: `Content exceeds maximum size of ${MAX_BEHAVIOR_PROMPT_SIZE} bytes` });
      }

      // Ensure parent directory exists
      const parentDir = path.dirname(AGENTS_MD_PATH);
      try {
        await fs.promises.access(parentDir);
      } catch {
        await fs.promises.mkdir(parentDir, { recursive: true });
      }

      await fs.promises.writeFile(AGENTS_MD_PATH, content, 'utf8');
      const pendingRestart = markPendingConfigRestart('global behavior (AGENTS.md) updated', {
        scope: 'behavior',
        entityId: 'agents-md',
      });
      return res.json(buildDeferredRestartResponse(
        'AGENTS.md saved. Restart OpenCode to apply.',
        pendingRestart,
      ));
    } catch (error) {
      console.error('Failed to write AGENTS.md:', error);
      return res.status(500).json({ error: error.message || 'Failed to write AGENTS.md' });
    }
  });
};

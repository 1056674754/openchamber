/**
 * Config routes for reading/writing OpenCode configuration sections.
 * Mounts under /api/config/ on the Express app.
 */
import {
  readFullConfig,
  readPermissionConfig,
  readConfigSection,
} from './config-reader.js';
import {
  writeConfigSection,
  writePermissionRule,
  writeBulkPermissions,
} from './config-writer.js';
import { buildDeferredRestartResponse } from './config-mutation-response.js';

export const registerConfigRoutes = (app, dependencies) => {
  const {
    resolveProjectDirectory,
    markPendingConfigRestart,
  } = dependencies;

  const resolveDir = async (req) => {
    const { directory, error } = await resolveProjectDirectory(req);
    return { directory, error };
  };

  const deferRestart = (res, label) => {
    const pendingRestart = markPendingConfigRestart(label, { scope: 'config' });
    return res.json(buildDeferredRestartResponse(
      `${label} updated. Restart OpenCode to apply.`,
      pendingRestart,
    ));
  };

  // GET /api/config/full — full merged config with layer attribution
  app.get('/api/config/full', async (req, res) => {
    try {
      const { directory, error } = await resolveDir(req);
      if (!directory) return res.status(400).json({ error });
      const result = readFullConfig(directory);
      return res.json(result);
    } catch (err) {
      console.error('[API:Config full] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/config/section/:key — read a specific config section
  app.get('/api/config/section/:key', async (req, res) => {
    try {
      const { directory, error } = await resolveDir(req);
      if (!directory) return res.status(400).json({ error });
      const sectionKey = req.params.key;
      const result = readConfigSection(directory, sectionKey);
      return res.json(result);
    } catch (err) {
      console.error('[API:Config section] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/config/permissions — full permission config
  app.get('/api/config/permissions', async (req, res) => {
    try {
      const { directory, error } = await resolveDir(req);
      if (!directory) return res.status(400).json({ error });
      const result = readPermissionConfig(directory);
      return res.json(result);
    } catch (err) {
      console.error('[API:Config permissions] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/config/permissions — bulk write all permissions
  app.put('/api/config/permissions', async (req, res) => {
    try {
      const { directory, error } = await resolveDir(req);
      if (!directory) return res.status(400).json({ error });

      const { global, agents, scope } = req.body || {};
      writeBulkPermissions(directory, global || {}, agents || {}, scope || 'user');

      return deferRestart(res, 'Permissions');
    } catch (err) {
      console.error('[API:Config permissions PUT] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/config/permissions/:tool — write a single tool rule
  app.put('/api/config/permissions/:tool', async (req, res) => {
    try {
      const { directory, error } = await resolveDir(req);
      if (!directory) return res.status(400).json({ error });

      const toolName = req.params.tool;
      const { rule, scope, agentName } = req.body || {};

      if (!rule) {
        return res.status(400).json({ error: 'Missing "rule" in request body' });
      }

      writePermissionRule(directory, toolName, rule, scope || 'user', agentName || null);

      return deferRestart(res, `Permission "${toolName}"`);
    } catch (err) {
      console.error('[API:Config permissions tool PUT] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/config/section/:key — write a config section
  app.put('/api/config/section/:key', async (req, res) => {
    try {
      const { directory, error } = await resolveDir(req);
      if (!directory) return res.status(400).json({ error });

      const sectionKey = req.params.key;
      const { value, scope } = req.body || {};

      writeConfigSection(directory, sectionKey, value, scope || 'user');

      return deferRestart(res, `Config section "${sectionKey}"`);
    } catch (err) {
      console.error('[API:Config section PUT] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });
};

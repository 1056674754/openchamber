import {
  createTempSessionDirectory,
  listTempSessionDirectories,
  cleanupOldTempSessions,
  deleteTempSessionDirectory,
  renameTempSessionDirectory,
} from './temp-session-directory.js';

let _buildOpenCodeUrl = null;
let _getOpenCodeAuthHeaders = null;

/**
 * Inject OpenCode server accessors so temp-session routes can call
 * the OpenCode API directly (session creation, etc.).
 */
export function setOpenCodeDeps(deps) {
  _buildOpenCodeUrl = deps.buildOpenCodeUrl;
  _getOpenCodeAuthHeaders = deps.getOpenCodeAuthHeaders;
}

export function registerTempSessionRoutes(app) {
  /**
   * POST /api/temp-sessions/create-session
   * Creates a temp directory AND an OpenCode session in one server-side call.
   * This avoids the fragile client → SDK → proxy → OpenCode chain.
   *
   * Body: { topic: string, title?: string, parentID?: string }
   * Response: { path: string, topic: string, session: object }
   */
  app.post('/api/temp-sessions/create-session', async (req, res) => {
    try {
      const { topic, title, parentID } = req.body;
      if (!topic || typeof topic !== 'string') {
        return res.status(400).json({ error: 'Topic is required' });
      }

      const dirPath = await createTempSessionDirectory(topic);
      console.log('[TempSessions] Created temp directory:', dirPath);

      if (!_buildOpenCodeUrl || !_getOpenCodeAuthHeaders) {
        console.error('[TempSessions] OpenCode deps not initialized');
        return res.status(500).json({ error: 'OpenCode server not available', path: dirPath });
      }

      const encodedDir = encodeURIComponent(dirPath);
      let sessionUrl;
      try {
        sessionUrl = _buildOpenCodeUrl(`/session?directory=${encodedDir}`, '');
      } catch (urlErr) {
        console.error('[TempSessions] Failed to build OpenCode URL (server not ready):', urlErr.message);
        return res.status(503).json({ error: 'OpenCode server not ready', path: dirPath });
      }

      const body = {};
      if (title) body.title = title;
      if (parentID) body.parentID = parentID;

      const sessionResponse = await fetch(sessionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ..._getOpenCodeAuthHeaders(),
        },
        body: JSON.stringify(body),
      });

      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text().catch(() => '');
        console.error(
          '[TempSessions] OpenCode session.create failed:',
          sessionResponse.status,
          errorText,
        );
        return res.status(sessionResponse.status).json({
          error: 'OpenCode session creation failed',
          status: sessionResponse.status,
          details: errorText,
          path: dirPath,
        });
      }

      const session = await sessionResponse.json();
      console.log('[TempSessions] Created OpenCode session:', session?.id, 'for directory:', dirPath);

      res.json({ path: dirPath, topic, session });
    } catch (error) {
      console.error('[TempSessions] create-session failed:', error);
      res.status(500).json({ error: 'Failed to create temp session', details: error.message });
    }
  });

  app.post('/api/temp-sessions', async (req, res) => {
    try {
      const { topic } = req.body;
      console.log('[TempSessions] Creating temp session with topic:', topic);
      if (!topic || typeof topic !== 'string') {
        return res.status(400).json({ error: 'Topic is required' });
      }

      const dirPath = await createTempSessionDirectory(topic);
      console.log('[TempSessions] Created temp session directory:', dirPath);
      res.json({ path: dirPath, topic });
    } catch (error) {
      console.error('[TempSessions] Failed to create temp session directory:', error);
      res.status(500).json({ error: 'Failed to create temporary session directory', details: error.message });
    }
  });

  app.get('/api/temp-sessions', async (_req, res) => {
    try {
      const dirs = await listTempSessionDirectories();
      res.json({ directories: dirs });
    } catch (error) {
      console.error('[TempSessions] Failed to list temp session directories:', error);
      res.status(500).json({ error: 'Failed to list temporary session directories' });
    }
  });

  app.post('/api/temp-sessions/cleanup', async (req, res) => {
    try {
      const { maxAgeDays } = req.body;
      const result = await cleanupOldTempSessions(
        typeof maxAgeDays === 'number' ? maxAgeDays : 7
      );
      res.json(result);
    } catch (error) {
      console.error('[TempSessions] Failed to cleanup temp sessions:', error);
      res.status(500).json({ error: 'Failed to cleanup temporary sessions' });
    }
  });

  app.delete('/api/temp-sessions', async (req, res) => {
    try {
      const { path: dirPath } = req.body;
      if (!dirPath || typeof dirPath !== 'string') {
        return res.status(400).json({ error: 'Path is required' });
      }

      const success = await deleteTempSessionDirectory(dirPath);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: 'Failed to delete temporary session directory' });
      }
    } catch (error) {
      console.error('[TempSessions] Failed to delete temp session directory:', error);
      res.status(500).json({ error: 'Failed to delete temporary session directory' });
    }
  });

  app.post('/api/temp-sessions/rename', async (req, res) => {
    try {
      const { path: dirPath, topic } = req.body;
      if (!dirPath || typeof dirPath !== 'string') {
        return res.status(400).json({ error: 'Path is required' });
      }
      if (!topic || typeof topic !== 'string') {
        return res.status(400).json({ error: 'Topic is required' });
      }

      const newPath = await renameTempSessionDirectory(dirPath, topic);
      res.json({ path: newPath, topic });
    } catch (error) {
      console.error('[TempSessions] Failed to rename temp session directory:', error);
      res.status(500).json({ error: 'Failed to rename temporary session directory', details: error.message });
    }
  });
}

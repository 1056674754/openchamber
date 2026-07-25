import { deleteObjective, readObjective, writeObjective } from './objectives.js';

/** Current Goals HTTP contract version advertised to peers / UI probes. */
export const SESSION_GOALS_API_VERSION = 1;

export const getSessionGoalsCapability = () => ({
  goals: true,
  apiVersion: SESSION_GOALS_API_VERSION,
});

// OpenChamber-owned routes for file-backed goal objectives, keyed by session
// id (one goal per session; a new goal overwrites the old file). The UI
// writes the objective file before stamping the goal metadata (which only
// carries an `objectiveFile: true` flag), reads it back for display, and
// deletes it when the goal is removed.
export function registerSessionGoalRoutes(app) {
  // Lightweight advertisement for remote OpenChamber capability probes (#35).
  // Bare OpenCode URLs have no such route → probe fails closed.
  app.get('/api/goals/capability', (_req, res) => {
    res.json(getSessionGoalsCapability());
  });

  app.put('/api/goals/objective/:sessionId', async (req, res) => {
    try {
      const { content } = req.body || {};
      await writeObjective(req.params.sessionId, content);
      res.json({ ok: true });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      if (statusCode >= 500) {
        console.error('Failed to write goal objective:', error);
      }
      res.status(statusCode).json({ error: error?.message || 'Failed to write goal objective' });
    }
  });

  app.get('/api/goals/objective/:sessionId', async (req, res) => {
    const content = await readObjective(req.params.sessionId);
    if (content === null) {
      res.status(404).json({ error: 'objective not found' });
      return;
    }
    res.json({ content });
  });

  app.delete('/api/goals/objective/:sessionId', async (req, res) => {
    await deleteObjective(req.params.sessionId);
    res.json({ ok: true });
  });
}

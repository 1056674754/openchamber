import express from 'express';
import { asControlError } from '../openchamber-control/error.js';

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const registerOpenChamberSessionRoutes = (app, { sessionService }) => {
  app.post('/api/openchamber/sessions/archive', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      return res.json(await sessionService.archive(req.body && typeof req.body === 'object' ? req.body : {}));
    } catch (error) {
      console.error('[OpenChamberSessions] failed to archive sessions:', error);
      const controlError = asControlError(error, 'Failed to archive sessions');
      return res.status(controlError.statusCode).json({ error: controlError.message });
    }
  });

  // OC2 spine S4 [spine 654705f7d]: OpenChamber-owned session metadata. The
  // service is the single owner; reads and writes seed the store from the
  // OpenCode record inside the same transaction that needed it.
  app.get('/api/openchamber/sessions/:sessionId/metadata', async (req, res) => {
    try {
      return res.json(await sessionService.getMetadata(
        req.params.sessionId,
        asNonEmptyString(req.query?.directory) || '',
      ));
    } catch (error) {
      console.error('[OpenChamberSessions] failed to read session metadata:', error);
      const controlError = asControlError(error, 'Failed to read session metadata');
      return res.status(controlError.statusCode).json({ error: controlError.message });
    }
  });

  app.post('/api/openchamber/sessions/:sessionId/metadata', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      return res.json(await sessionService.setMetadata(
        req.params.sessionId,
        req.body && typeof req.body === 'object' ? req.body : {},
      ));
    } catch (error) {
      console.error('[OpenChamberSessions] failed to store session metadata:', error);
      const controlError = asControlError(error, 'Failed to store session metadata');
      return res.status(controlError.statusCode).json({ error: controlError.message });
    }
  });
};

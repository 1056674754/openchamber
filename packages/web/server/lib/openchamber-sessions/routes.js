import express from 'express';
import { asControlError } from '../openchamber-control/error.js';

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
};

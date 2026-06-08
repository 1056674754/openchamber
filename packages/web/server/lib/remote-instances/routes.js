export const registerRemoteInstanceRoutes = (app, runtime) => {
  app.get('/api/remote-instances', async (_req, res) => {
    try {
      const instances = await runtime.getInstances();
      res.json({ instances });
    } catch (error) {
      console.error('[remote-instances] Failed to list instances:', error?.message || error);
      res.status(500).json({ error: 'Failed to list remote instances' });
    }
  });

  app.put('/api/remote-instances', async (req, res) => {
    try {
      const body = req.body;
      if (!body || !Array.isArray(body.instances)) {
        return res.status(400).json({ error: 'Request body must include { instances: [...] }' });
      }
      const instances = await runtime.setInstances(body.instances);
      res.json({ instances });
    } catch (error) {
      console.error('[remote-instances] Failed to set instances:', error?.message || error);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      res.status(status).json({ error: status === 400 ? (error?.message || 'Invalid remote instances') : 'Failed to set remote instances' });
    }
  });

  app.post('/api/remote-instances/:id/health', async (req, res) => {
    const { id } = req.params;
    try {
      await runtime.refreshCache();
      const instance = await runtime.getInstance(id);
      if (!instance) {
        return res.status(404).json({ error: `Remote instance "${id}" not found` });
      }
      const options = {};
      if (req.body && typeof req.body.timeoutSec === 'number' && Number.isFinite(req.body.timeoutSec)) {
        options.timeoutSec = Math.max(1, Math.min(5, Math.round(req.body.timeoutSec)));
      }
      const status = await runtime.probeHealth(instance, options);
      res.json({ instanceId: id, ...status });
    } catch (error) {
      console.error(`[remote-instances] Health check failed for "${id}":`, error?.message || error);
      res.status(500).json({ error: 'Health check failed', instanceId: id });
    }
  });

  app.post('/api/remote-instances/:id/connect', async (req, res) => {
    const { id } = req.params;
    try {
      await runtime.refreshCache();
      const instance = await runtime.getInstance(id);
      if (!instance) {
        return res.status(404).json({ error: `Remote instance "${id}" not found` });
      }
      const status = await runtime.probeHealth(instance);
      if (status.healthy) {
        res.json({ instanceId: id, connected: true, ...status });
      } else {
        res.json({ instanceId: id, connected: false, ...status });
      }
    } catch (error) {
      console.error(`[remote-instances] Connect failed for "${id}":`, error?.message || error);
      res.status(500).json({ error: 'Connect failed', instanceId: id });
    }
  });

  app.post('/api/remote-instances/:id/disconnect', async (req, res) => {
    const { id } = req.params;
    try {
      await runtime.refreshCache();
      runtime.setHealthStatus(id, { healthy: false, latencyMs: 0, error: 'Disconnected by user' });
      res.json({ instanceId: id, connected: false });
    } catch (error) {
      console.error(`[remote-instances] Disconnect failed for "${id}":`, error?.message || error);
      res.status(500).json({ error: 'Disconnect failed', instanceId: id });
    }
  });
};

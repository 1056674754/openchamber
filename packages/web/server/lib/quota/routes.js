import express from 'express';
import {
  normalizeOpenCodeGoCredential,
  openCodeGoCredentialStore,
} from './opencode-go-credentials.js';
import { fetchOpenCodeGoUsage } from './providers/opencode-go.js';

export function registerQuotaRoutes(app, {
  getQuotaProviders,
  openCodeGoCredentials = openCodeGoCredentialStore,
  validateOpenCodeGoCredential = fetchOpenCodeGoUsage,
}) {
  app.get('/api/quota/providers', async (_req, res) => {
    try {
      const { listConfiguredQuotaProviders } = await getQuotaProviders();
      const providers = listConfiguredQuotaProviders();
      res.json({ providers });
    } catch (error) {
      console.error('Failed to list quota providers:', error);
      res.status(500).json({ error: error.message || 'Failed to list quota providers' });
    }
  });

  app.get('/api/quota/credentials/opencode-go', (_req, res) => {
    res.json(openCodeGoCredentials.getStatus());
  });

  app.put('/api/quota/credentials/opencode-go', express.json({ limit: '16kb' }), async (req, res) => {
    const credential = normalizeOpenCodeGoCredential(req.body);
    if (!credential) {
      return res.status(400).json({ error: 'Workspace ID and auth cookie are required' });
    }
    try {
      await validateOpenCodeGoCredential(credential);
      return res.json(openCodeGoCredentials.write(credential));
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Credential validation failed',
      });
    }
  });

  app.post('/api/quota/credentials/opencode-go/validate', async (_req, res) => {
    const credential = openCodeGoCredentials.read();
    if (!credential) return res.status(404).json({ error: 'Not configured' });
    try {
      await validateOpenCodeGoCredential(credential);
      return res.json({ valid: true });
    } catch (error) {
      return res.status(400).json({
        valid: false,
        error: error instanceof Error ? error.message : 'Credential validation failed',
      });
    }
  });

  app.delete('/api/quota/credentials/opencode-go', (_req, res) => {
    openCodeGoCredentials.remove();
    res.json({ configured: false });
  });

  app.get('/api/quota/:providerId', async (req, res) => {
    try {
      const { providerId } = req.params;
      if (!providerId) {
        return res.status(400).json({ error: 'Provider ID is required' });
      }
      const { fetchQuotaForProvider } = await getQuotaProviders();
      const result = await fetchQuotaForProvider(providerId);
      res.json(result);
    } catch (error) {
      console.error('Failed to fetch quota:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch quota' });
    }
  });
}

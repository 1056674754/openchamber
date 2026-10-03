import { aggregateSubscriptions } from './aggregate.js';

/**
 * Register read-only subscription routes.
 * @param {import('express').Express} app
 * @param {object} dependencies
 * @param {() => Promise<object[]>} dependencies.fetchProvidersSnapshot
 * @param {(req: object) => Promise<{directory?: string|null, error?: string}>} dependencies.resolveProjectDirectory
 * @param {() => Promise<{listConfiguredQuotaProviders: () => Promise<string[]>}>} dependencies.getQuotaProviders
 * @param {Record<string, string|undefined>} [dependencies.processEnv]
 */
export const registerSubscriptionRoutes = (app, {
  fetchProvidersSnapshot,
  resolveProjectDirectory,
  getQuotaProviders,
  processEnv = process.env,
}) => {
  app.get('/api/subscriptions', async (req, res) => {
    try {
      const headerDirectory = typeof req.get === 'function' ? req.get('x-opencode-directory') : null;
      const queryDirectory = Array.isArray(req.query?.directory) ? req.query.directory[0] : req.query?.directory;
      const requestedDirectory = headerDirectory || queryDirectory || null;
      const resolved = await resolveProjectDirectory(req);
      if (!resolved?.directory && requestedDirectory) {
        return res.status(400).json({ error: resolved?.error || 'Invalid project directory' });
      }

      const quotaProviders = await getQuotaProviders();
      const payload = await aggregateSubscriptions({
        workingDirectory: resolved?.directory ?? null,
        processEnv,
        fetchProvidersSnapshot,
        listConfiguredQuotaProviders: quotaProviders.listConfiguredQuotaProviders,
      });
      return res.json(payload);
    } catch (error) {
      console.error('Failed to aggregate subscriptions:', error);
      return res.status(500).json({ error: error?.message || 'Failed to aggregate subscriptions' });
    }
  });
};

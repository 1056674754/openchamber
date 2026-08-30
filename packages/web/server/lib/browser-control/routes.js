export function registerBrowserControlRoutes(app, { express, broker }) {
  app.post('/api/browser-control/claim', express.json({ limit: '4kb' }), (req, res) => {
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
    if (!requestId) return res.status(400).json({ error: 'requestId is required' });
    return res.json({ granted: broker.claim(requestId) });
  });
  app.post('/api/browser-control/result', express.json({ limit: '2mb' }), (req, res) => {
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
    if (!requestId) return res.status(400).json({ error: 'requestId is required' });
    const matched = broker.resolve(requestId, {
      ok: req.body?.ok === true,
      data: req.body?.data ?? null,
      error: typeof req.body?.error === 'string' ? req.body.error : '',
    });
    return res.json({ matched });
  });
}

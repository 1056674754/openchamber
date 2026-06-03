const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const registerPendingMessagesRoutes = (app, dependencies) => {
  const {
    fsPromises,
    path,
    openchamberDataDir,
  } = dependencies;

  const dirPath = path.join(openchamberDataDir, 'pending-messages');

  const ensureDir = async () => {
    await fsPromises.mkdir(dirPath, { recursive: true });
  };

  app.get('/api/pending-messages', async (_req, res) => {
    try {
      const entries = await fsPromises.readdir(dirPath).catch((error) => {
        if (error && error.code === 'ENOENT') return [];
        throw error;
      });
      const messages = [];
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        try {
          const raw = await fsPromises.readFile(path.join(dirPath, entry), 'utf8');
          const parsed = JSON.parse(raw);
          messages.push(parsed);
        } catch {
          // skip files that fail to parse
        }
      }
      messages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      return res.json({ messages });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list pending messages';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/pending-messages', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be an object' });
    }
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId must be a non-empty string' });
    }
    const serialized = JSON.stringify(body, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'Payload too large' });
    }
    const filePath = path.join(dirPath, `${body.sessionId}.json`);
    let tmp;
    let saved = false;
    try {
      await ensureDir();
      tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await fsPromises.writeFile(tmp, serialized, 'utf8');
      await fsPromises.rename(tmp, filePath);
      saved = true;
      return res.json({ success: true });
    } catch (error) {
      if (tmp && !saved) {
        await fsPromises.unlink(tmp).catch(() => {});
      }
      const message = error instanceof Error ? error.message : 'Failed to write pending message';
      return res.status(500).json({ error: message });
    }
  });

  app.delete('/api/pending-messages/:sessionId', async (req, res) => {
    const filePath = path.join(dirPath, `${req.params.sessionId}.json`);
    try {
      await fsPromises.unlink(filePath).catch((error) => {
        if (error && error.code === 'ENOENT') return;
        throw error;
      });
      return res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete pending message';
      return res.status(500).json({ error: message });
    }
  });
};

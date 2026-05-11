const DEBOUNCE_MS = 500;
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const createSessionUnreadStore = ({ fs, path, dataDir }) => {
  const filePath = path.join(dataDir, 'session-unread.json');
  let data = { sessions: {} };
  let persistTimer = null;

  const schedulePersist = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writeToFile();
    }, DEBOUNCE_MS);
  };

  const writeToFile = () => {
    try {
      const tmp = filePath + '.tmp';
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, filePath);
    } catch {
    }
  };

  const load = () => {
    try {
      if (!fs.existsSync(filePath)) {
        data = { sessions: {} };
        return;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.sessions !== 'object') {
        data = { sessions: {} };
        return;
      }
      data = { sessions: {} };
      const now = Date.now();
      for (const [id, entry] of Object.entries(parsed.sessions)) {
        if (!entry || typeof entry !== 'object') continue;
        const lastActivityAt = typeof entry.lastActivityAt === 'number' ? entry.lastActivityAt : 0;
        if (lastActivityAt > 0 && now - lastActivityAt > PRUNE_AGE_MS) continue;
        data.sessions[id] = {
          lastActivityAt,
          lastReadAt: typeof entry.lastReadAt === 'number' ? entry.lastReadAt : 0,
          hasError: entry.hasError === true,
        };
      }
    } catch {
      data = { sessions: {} };
    }
  };

  const recordActivity = (sessionId, opts = {}) => {
    if (!sessionId || typeof sessionId !== 'string') return;
    const existing = data.sessions[sessionId];
    const now = Date.now();
    data.sessions[sessionId] = {
      lastActivityAt: now,
      lastReadAt: existing?.lastReadAt || 0,
      hasError: opts.hasError === true,
    };
    schedulePersist();
  };

  const markRead = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') return;
    const existing = data.sessions[sessionId];
    const now = Date.now();
    data.sessions[sessionId] = {
      lastActivityAt: existing?.lastActivityAt || 0,
      lastReadAt: now,
      hasError: existing?.hasError || false,
    };
    schedulePersist();
  };

  const getUnreadSessions = () => {
    const result = {};
    for (const [id, entry] of Object.entries(data.sessions)) {
      const unread = entry.lastActivityAt > entry.lastReadAt;
      result[id] = { unread, hasError: entry.hasError };
    }
    return result;
  };

  const getUnreadState = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') return null;
    const entry = data.sessions[sessionId];
    if (!entry) return null;
    return {
      unread: entry.lastActivityAt > entry.lastReadAt,
      hasError: entry.hasError,
    };
  };

  const flush = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    writeToFile();
  };

  const dispose = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  };

  return {
    load,
    recordActivity,
    markRead,
    getUnreadSessions,
    getUnreadState,
    flush,
    dispose,
  };
};

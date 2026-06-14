const DEBOUNCE_MS = 500;
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STORE_VERSION = 1;

const emptyData = () => ({ version: STORE_VERSION, sessions: {} });

const readTimestamp = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

const isUnread = (entry) => Math.max(entry.lastActivityAt, entry.manualUnreadAt) > entry.lastReadAt;

const cloneState = (entry) => ({
  unread: isUnread(entry),
  hasError: entry.hasError === true,
});

export const createSessionUnreadStore = ({ fs, path, dataDir, onChange }) => {
  const filePath = path.join(dataDir, 'session-unread.json');
  let data = emptyData();
  let persistTimer = null;

  const getUnreadSessions = () => {
    const result = {};
    for (const [id, entry] of Object.entries(data.sessions)) {
      result[id] = cloneState(entry);
    }
    return result;
  };

  const getTotalUnread = () => {
    let total = 0;
    for (const entry of Object.values(data.sessions)) {
      if (isUnread(entry)) total += 1;
    }
    return total;
  };

  const emitChange = (sessionId) => {
    if (typeof onChange !== 'function') return;
    const state = sessionId ? getUnreadState(sessionId) : null;
    // Targeted update only — do NOT include the full sessions map.
    // The client's applyUnreadResponse treats a present `sessions` field as a
    // full hydration (hydrateFromServer), which destructively replaces the
    // entire unread index and wipes client-only unread state for sessions the
    // server doesn't track yet. Omitting `sessions` routes the client to the
    // surgical updateSessionUnread path, preserving all other sessions.
    onChange({
      sessionId,
      state,
      totalUnread: getTotalUnread(),
    });
  };

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
        data = emptyData();
        return;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.sessions !== 'object') {
        data = emptyData();
        return;
      }
      data = emptyData();
      const now = Date.now();
      for (const [id, entry] of Object.entries(parsed.sessions)) {
        if (!entry || typeof entry !== 'object') continue;
        const lastActivityAt = readTimestamp(entry.lastActivityAt);
        const manualUnreadAt = readTimestamp(entry.manualUnreadAt);
        const lastReadAt = readTimestamp(entry.lastReadAt);
        const lastTouchAt = Math.max(lastActivityAt, manualUnreadAt, lastReadAt);
        if (lastTouchAt > 0 && now - lastTouchAt > PRUNE_AGE_MS) continue;
        data.sessions[id] = {
          lastActivityAt,
          manualUnreadAt,
          lastReadAt,
          hasError: entry.hasError === true,
        };
      }
    } catch {
      data = emptyData();
    }
  };

  const recordActivity = (sessionId, opts = {}) => {
    if (!sessionId || typeof sessionId !== 'string') return;
    const existing = data.sessions[sessionId];
    const now = Date.now();
    const before = existing ? cloneState(existing) : null;
    data.sessions[sessionId] = {
      lastActivityAt: now,
      manualUnreadAt: existing?.manualUnreadAt || 0,
      lastReadAt: existing?.lastReadAt || 0,
      hasError: opts.hasError === true,
    };
    schedulePersist();
    const after = cloneState(data.sessions[sessionId]);
    if (!before || before.unread !== after.unread || before.hasError !== after.hasError) {
      emitChange(sessionId);
    }
  };

  const markRead = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') return null;
    const existing = data.sessions[sessionId];
    const now = Date.now();
    const before = existing ? cloneState(existing) : null;
    data.sessions[sessionId] = {
      lastActivityAt: existing?.lastActivityAt || 0,
      manualUnreadAt: existing?.manualUnreadAt || 0,
      lastReadAt: now,
      hasError: existing?.hasError || false,
    };
    schedulePersist();
    const after = cloneState(data.sessions[sessionId]);
    if (before && (before.unread !== after.unread || before.hasError !== after.hasError)) {
      emitChange(sessionId);
    }
    return after;
  };

  const markUnread = (sessionId, opts = {}) => {
    if (!sessionId || typeof sessionId !== 'string') return null;
    const existing = data.sessions[sessionId];
    const now = Date.now();
    const before = existing ? cloneState(existing) : null;
    data.sessions[sessionId] = {
      lastActivityAt: existing?.lastActivityAt || 0,
      manualUnreadAt: now,
      lastReadAt: existing?.lastReadAt || 0,
      hasError: opts.hasError === true || existing?.hasError === true,
    };
    schedulePersist();
    const after = cloneState(data.sessions[sessionId]);
    if (!before || before.unread !== after.unread || before.hasError !== after.hasError) {
      emitChange(sessionId);
    }
    return after;
  };

  const getUnreadState = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') return null;
    const entry = data.sessions[sessionId];
    if (!entry) return null;
    return cloneState(entry);
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
    markUnread,
    getUnreadSessions,
    getUnreadState,
    getTotalUnread,
    flush,
    dispose,
  };
};

const PENDING_RESTART_EVENT_TYPE = 'openchamber:pending-config-restart';

export function createPendingConfigRestartRuntime({
  applyRestart,
  broadcastEvent,
  getSessionActivitySnapshot,
  now = Date.now,
}) {
  let nextChangeId = 0;
  let changes = [];
  let applyPromise = null;

  const getAffectedSessions = () => {
    const activity = getSessionActivitySnapshot();
    return Object.entries(activity)
      .filter(([, status]) => status?.type === 'busy' || status?.type === 'retry')
      .map(([sessionId, status]) => ({ sessionId, status: status.type }));
  };

  const getPendingConfigRestart = () => ({
    count: changes.length,
    reasons: changes.map((change) => change.reason),
    changes: changes.map((change) => ({ ...change })),
    affectedSessions: getAffectedSessions(),
    isApplying: applyPromise !== null,
  });

  const broadcastSnapshot = () => {
    const snapshot = getPendingConfigRestart();
    broadcastEvent({
      type: PENDING_RESTART_EVENT_TYPE,
      properties: snapshot,
    });
    return snapshot;
  };

  const markPendingConfigRestart = (reason, details = {}) => {
    const normalizedReason = typeof reason === 'string' && reason.trim().length > 0
      ? reason.trim()
      : 'configuration change';
    nextChangeId += 1;
    changes = [
      ...changes,
      {
        id: nextChangeId,
        reason: normalizedReason,
        recordedAt: now(),
        ...(typeof details.scope === 'string' && details.scope ? { scope: details.scope } : {}),
        ...(typeof details.entityId === 'string' && details.entityId ? { entityId: details.entityId } : {}),
      },
    ];
    return broadcastSnapshot();
  };

  const applyPendingConfigRestart = () => {
    if (applyPromise) return applyPromise;
    if (changes.length === 0) {
      return Promise.resolve({
        appliedCount: 0,
        restart: null,
        pending: getPendingConfigRestart(),
      });
    }

    const appliedIds = new Set(changes.map((change) => change.id));
    const forceProcessRestart = changes.some((change) => change.scope === 'agent-memory');
    const appliedCount = appliedIds.size;
    applyPromise = (async () => {
      broadcastSnapshot();
      try {
        const restart = forceProcessRestart
          ? await applyRestart('pending configuration changes', { forceRestart: true })
          : await applyRestart('pending configuration changes');
        changes = changes.filter((change) => !appliedIds.has(change.id));
        return {
          appliedCount,
          restart,
          pending: null,
        };
      } finally {
        applyPromise = null;
        broadcastSnapshot();
      }
    })().then((result) => ({
      ...result,
      pending: getPendingConfigRestart(),
    }));

    return applyPromise;
  };

  return {
    getPendingConfigRestart,
    markPendingConfigRestart,
    applyPendingConfigRestart,
  };
}

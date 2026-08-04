import {
  buildRemoteUpstreamHeaders,
  preserveRemoteRequestHeaderValues,
  redactRemoteRequestHeadersForApi,
  sanitizeRemoteRequestHeaders,
} from './request-headers.js';

const VALID_AUTH_TYPES = new Set(['none', 'password', 'bearer']);

/**
 * Reserved ids that remote instances must never occupy. They collide with
 * internal sentinels across layers:
 * - 'default': local in-process OpenCode server id (DEFAULT_SERVER_ID) and
 *   InstanceType 'default' in the instance-context store.
 * - 'local': desktop host id (LOCAL_HOST_ID) and RPC target sentinel
 *   (LOCAL_RPC_TARGET).
 * Allowing a remote instance to claim either id would let it masquerade as or
 * overwrite the local connection in the server registry / host switcher.
 */
const RESERVED_REMOTE_INSTANCE_IDS = new Set(['default', 'local']);

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000;
export const DEFAULT_HEALTH_PROBE_TIMEOUT_SEC = 3;
export const MAX_HEALTH_PROBE_TIMEOUT_SEC = 5;
const DEFAULT_REQUEST_LANE_LIMITS = {
  health: { maxActive: 1, maxQueue: 0, queueTimeoutMs: 0 },
  critical: { maxActive: 8, maxQueue: 0, queueTimeoutMs: 0 },
  fast: { maxActive: 32, maxQueue: 64, queueTimeoutMs: 5_000 },
  normal: { maxActive: 32, maxQueue: 128, queueTimeoutMs: 5_000 },
  io: { maxActive: 4, maxQueue: 16, queueTimeoutMs: 10_000 },
  ai: { maxActive: 2, maxQueue: 4, queueTimeoutMs: 10_000 },
  stream: { maxActive: 3, maxQueue: 0, queueTimeoutMs: 0 },
};
const REQUEST_CIRCUIT_FAILURE_THRESHOLD = 3;
const REQUEST_CIRCUIT_COOLDOWN_MS = 15_000;
const REQUEST_LANE_RETRY_AFTER_MS = 1_000;

export const normalizeHealthProbeTimeoutSec = (...values) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.max(1, Math.min(MAX_HEALTH_PROBE_TIMEOUT_SEC, Math.round(value)));
    }
  }
  return DEFAULT_HEALTH_PROBE_TIMEOUT_SEC;
};

const isTimeoutError = (error) => (
  error?.name === 'AbortError'
  || error?.name === 'TimeoutError'
  || error?.code === 'ABORT_ERR'
  || error?.code === 'ETIMEDOUT'
);

export class RemoteInstanceRequestRejectedError extends Error {
  constructor(message, statusCode = 503, code = 'REMOTE_REQUEST_REJECTED', retryAfterMs) {
    super(message);
    this.name = 'RemoteInstanceRequestRejectedError';
    this.statusCode = statusCode;
    this.code = code;
    if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
      this.retryAfterMs = retryAfterMs;
    }
  }
}

class RemoteInstancesValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RemoteInstancesValidationError';
    this.statusCode = 400;
  }
}

const validateInstance = (inst) => {
  if (!inst || typeof inst !== 'object') {
    return null;
  }

  const id = typeof inst.id === 'string' ? inst.id.trim() : '';
  if (id.length === 0 || id.length > 128) {
    return null;
  }
  if (RESERVED_REMOTE_INSTANCE_IDS.has(id)) {
    return null;
  }

  const rawUrl = typeof inst.url === 'string' ? inst.url.trim().replace(/\/+$/, '') : '';
  if (rawUrl.length === 0) {
    return null;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  const authType = VALID_AUTH_TYPES.has(inst?.auth?.type) ? inst.auth.type : 'none';
  const authValue = authType !== 'none' && typeof inst?.auth?.value === 'string' && inst.auth.value.length > 0
    ? inst.auth.value
    : undefined;
  const requestHeaders = sanitizeRemoteRequestHeaders(inst?.requestHeaders);

  return {
    id,
    label: typeof inst.label === 'string' ? inst.label.trim().slice(0, 256) || id : id,
    url: rawUrl,
    auth: {
      type: authType,
      value: authValue,
    },
    ...(Object.keys(requestHeaders).length > 0 ? { requestHeaders } : {}),
    connectionTimeoutSec:
      typeof inst.connectionTimeoutSec === 'number' && Number.isFinite(inst.connectionTimeoutSec)
        ? Math.max(5, Math.min(300, Math.round(inst.connectionTimeoutSec)))
        : 30,
    enabled: typeof inst.enabled === 'boolean' ? inst.enabled : true,
  };
};

const redactInstanceForApi = (inst) => {
  const authType = VALID_AUTH_TYPES.has(inst?.auth?.type) ? inst.auth.type : 'none';
  const headerRedaction = redactRemoteRequestHeadersForApi(inst?.requestHeaders);
  const redacted = {
    ...inst,
    auth: {
      type: authType,
    },
    ...headerRedaction,
  };
  if (!headerRedaction.requestHeaders) {
    delete redacted.requestHeaders;
    delete redacted.hasRequestHeaders;
  }

  if (authType !== 'none' && Boolean(inst?.auth?.value)) {
    redacted.auth.hasValue = true;
  }

  return redacted;
};

const buildRemoteAuthHeaders = (instance) => ({
  Accept: 'application/json',
  ...buildRemoteUpstreamHeaders(instance),
});

const readJsonOrNull = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const describeHealthResponseError = (response, body, fallback) => {
  if (body && typeof body.error === 'string' && body.error.trim()) {
    return body.error.trim();
  }
  return `${fallback} HTTP ${response.status}`;
};

const sanitizeInstancesOrThrow = (input, existingInstances = []) => {
  if (!Array.isArray(input)) {
    throw new RemoteInstancesValidationError('Remote instances must be an array');
  }

  const existingById = new Map(existingInstances.map((inst) => [inst.id, inst]));
  const seen = new Set();
  const result = [];

  for (const item of input) {
    const validated = validateInstance(item);
    if (!validated) {
      const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : '<unknown>';
      throw new RemoteInstancesValidationError(`Invalid remote instance configuration: ${id}`);
    }
    if (seen.has(validated.id)) {
      throw new RemoteInstancesValidationError(`Duplicate remote instance id: ${validated.id}`);
    }
    seen.add(validated.id);

    const existing = existingById.get(validated.id);
    if (
      validated.auth.type !== 'none'
      && !validated.auth.value
      && existing?.auth?.type === validated.auth.type
      && existing.auth.value
    ) {
      validated.auth.value = existing.auth.value;
    }

    const preservedHeaders = preserveRemoteRequestHeaderValues(
      existing?.requestHeaders,
      item && Object.prototype.hasOwnProperty.call(item, 'requestHeaders')
        ? item.requestHeaders
        : undefined,
    );
    if (preservedHeaders) {
      validated.requestHeaders = preservedHeaders;
    } else {
      delete validated.requestHeaders;
    }

    result.push(validated);
  }

  return result;
};

export const createRemoteInstancesRuntime = (deps) => {
  const {
    readSettingsFromDisk,
    writeSettingsToDisk,
    readSettingsFromDiskMigrated,
    persistSettings,
  } = deps;

  const healthStatusMap = new Map();
  const healthProbeInFlight = new Map();
  const requestPressureMap = new Map();
  let healthMonitoringInterval = null;
  let cachedInstances = [];

  const normalizeRequestLane = (lane) => (
    lane === 'health'
      || lane === 'critical'
      || lane === 'fast'
      || lane === 'normal'
      || lane === 'io'
      || lane === 'ai'
      || lane === 'stream'
      ? lane
      : 'normal'
  );

  const getRequestPressureState = (id) => {
    let state = requestPressureMap.get(id);
    if (state) {
      return state;
    }

    state = {
      active: { health: 0, critical: 0, fast: 0, normal: 0, io: 0, ai: 0, stream: 0 },
      queues: { health: [], critical: [], fast: [], normal: [], io: [], ai: [], stream: [] },
      consecutiveFailures: 0,
      circuitOpenUntil: 0,
    };
    requestPressureMap.set(id, state);
    return state;
  };

  const isRequestCircuitOpen = (id) => {
    const state = requestPressureMap.get(id);
    return Boolean(state && state.circuitOpenUntil > Date.now());
  };

  const releaseRequestLane = (id, lane) => {
    const state = requestPressureMap.get(id);
    if (!state) {
      return;
    }

    const normalizedLane = normalizeRequestLane(lane);
    state.active[normalizedLane] = Math.max(0, state.active[normalizedLane] - 1);
    drainRequestLane(id, normalizedLane);
  };

  const acquireRequestLane = (id, lane) => {
    const normalizedLane = normalizeRequestLane(lane);
    const state = getRequestPressureState(id);
    state.active[normalizedLane] += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      releaseRequestLane(id, normalizedLane);
    };
  };

  const rejectQueuedLane = (item, error) => {
    if (item.timeout) {
      clearTimeout(item.timeout);
      item.timeout = null;
    }
    item.reject(error);
  };

  const drainRequestLane = (id, lane) => {
    const normalizedLane = normalizeRequestLane(lane);
    const limits = DEFAULT_REQUEST_LANE_LIMITS[normalizedLane];
    const state = requestPressureMap.get(id);
    if (!state) {
      return;
    }

    const queue = state.queues[normalizedLane];
    while (state.active[normalizedLane] < limits.maxActive && queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        continue;
      }

      if (normalizedLane !== 'health' && isRequestCircuitOpen(id)) {
        rejectQueuedLane(
          item,
          new RemoteInstanceRequestRejectedError(
            'Remote instance is temporarily unavailable',
            503,
            'REMOTE_CIRCUIT_OPEN',
            Math.max(REQUEST_LANE_RETRY_AFTER_MS, state.circuitOpenUntil - Date.now()),
          ),
        );
        continue;
      }

      if (item.timeout) {
        clearTimeout(item.timeout);
        item.timeout = null;
      }
      item.resolve(acquireRequestLane(id, normalizedLane));
    }
  };

  const enterRequestLane = async (id, lane = 'normal', options = {}) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new RemoteInstanceRequestRejectedError('Remote instance id is required', 400);
    }

    const normalizedLane = normalizeRequestLane(lane);
    const limits = DEFAULT_REQUEST_LANE_LIMITS[normalizedLane];
    const state = getRequestPressureState(id);

    if (normalizedLane !== 'health' && isRequestCircuitOpen(id)) {
      throw new RemoteInstanceRequestRejectedError(
        'Remote instance is temporarily unavailable',
        503,
        'REMOTE_CIRCUIT_OPEN',
        Math.max(REQUEST_LANE_RETRY_AFTER_MS, state.circuitOpenUntil - Date.now()),
      );
    }

    if (state.active[normalizedLane] < limits.maxActive) {
      return acquireRequestLane(id, normalizedLane);
    }

    if (limits.maxQueue <= 0 || state.queues[normalizedLane].length >= limits.maxQueue) {
      throw new RemoteInstanceRequestRejectedError(
        'Remote instance request lane is busy',
        429,
        'REMOTE_LANE_BUSY',
        Math.max(REQUEST_LANE_RETRY_AFTER_MS, limits.queueTimeoutMs),
      );
    }

    const queueTimeoutMs = Number.isFinite(options.queueTimeoutMs)
      ? Math.max(0, Math.round(options.queueTimeoutMs))
      : limits.queueTimeoutMs;

    return new Promise((resolve, reject) => {
      const item = { resolve, reject, timeout: null };
      if (queueTimeoutMs > 0) {
        item.timeout = setTimeout(() => {
          const queue = state.queues[normalizedLane];
          const index = queue.indexOf(item);
          if (index >= 0) {
            queue.splice(index, 1);
          }
          reject(new RemoteInstanceRequestRejectedError(
            'Remote instance request lane timed out',
            503,
            'REMOTE_LANE_QUEUE_TIMEOUT',
            Math.max(REQUEST_LANE_RETRY_AFTER_MS, queueTimeoutMs),
          ));
        }, queueTimeoutMs);
      }

      state.queues[normalizedLane].push(item);
    });
  };

  const recordRemoteRequestSuccess = (id) => {
    if (typeof id !== 'string' || id.length === 0) {
      return;
    }
    const state = getRequestPressureState(id);
    state.consecutiveFailures = 0;
    state.circuitOpenUntil = 0;
  };

  const recordRemoteRequestFailure = (id, errorOrStatus = null) => {
    if (typeof id !== 'string' || id.length === 0) {
      return;
    }

    let status;
    if (typeof errorOrStatus === 'number') {
      status = errorOrStatus;
    } else if (Number.isInteger(errorOrStatus?.statusCode)) {
      status = errorOrStatus.statusCode;
    } else if (Number.isInteger(errorOrStatus?.status)) {
      status = errorOrStatus.status;
    }

    if (typeof status === 'number' && status > 0 && status < 500) {
      return;
    }

    const state = getRequestPressureState(id);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures < REQUEST_CIRCUIT_FAILURE_THRESHOLD) {
      return;
    }

    state.circuitOpenUntil = Date.now() + REQUEST_CIRCUIT_COOLDOWN_MS;
    for (const lane of ['normal', 'stream']) {
      const queue = state.queues[lane];
      while (queue.length > 0) {
        const item = queue.shift();
        rejectQueuedLane(
          item,
          new RemoteInstanceRequestRejectedError(
            'Remote instance is temporarily unavailable',
            503,
            'REMOTE_CIRCUIT_OPEN',
            REQUEST_CIRCUIT_COOLDOWN_MS,
          ),
        );
      }
    }
  };

  const getRequestPressure = (id) => {
    const state = getRequestPressureState(id);
    const queued = {};
    for (const lane of Object.keys(DEFAULT_REQUEST_LANE_LIMITS)) {
      queued[lane] = state.queues[lane]?.length ?? 0;
    }
    return {
      active: { ...state.active },
      queued,
      circuitOpenUntil: state.circuitOpenUntil,
    };
  };

  const mergeWithSshInstances = (explicitInstances, settings) => {
    const result = [...explicitInstances];
    const explicitIds = new Set(result.map((i) => i.id));

    const sshInstances = Array.isArray(settings.desktopSshInstances) ? settings.desktopSshInstances : [];
    const desktopHosts = Array.isArray(settings.desktopHosts) ? settings.desktopHosts : [];
    const hostMap = new Map(desktopHosts.map((h) => [h.id, h]));

    for (const ssh of sshInstances) {
      if (!ssh || typeof ssh !== 'object' || explicitIds.has(ssh.id)) continue;
      const host = hostMap.get(ssh.id);
      const url = host?.url?.trim()?.replace(/\/+$/, '');
      if (!url) continue;
      const label = ssh.nickname?.trim() || ssh.sshParsed?.destination || ssh.id;
      const authValue = ssh.auth?.openchamberPassword?.enabled && ssh.auth.openchamberPassword.value
        ? ssh.auth.openchamberPassword.value
        : undefined;
      result.push({
        id: ssh.id,
        label,
        url,
        auth: authValue ? { type: 'password', value: authValue } : { type: 'none' },
        connectionTimeoutSec: typeof ssh.connectionTimeoutSec === 'number' ? ssh.connectionTimeoutSec : 30,
        enabled: true,
        source: 'ssh',
      });
    }

    return result;
  };

  const refreshCache = async () => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const explicit = Array.isArray(settings.remoteInstances) ? settings.remoteInstances : [];
      cachedInstances = mergeWithSshInstances(explicit, settings);
    } catch {
      cachedInstances = cachedInstances || [];
    }
  };

  const readCurrentInstances = async () => {
    const settings = await readSettingsFromDiskMigrated();
    const explicit = Array.isArray(settings.remoteInstances) ? settings.remoteInstances : [];
    return mergeWithSshInstances(explicit, settings);
  };

  const getInstances = async () => {
    const instances = await readCurrentInstances();
    return instances.map((inst) => ({
      ...redactInstanceForApi(inst),
      health: healthStatusMap.get(inst.id) || null,
    }));
  };

  const getInstance = async (id) => {
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    const instances = await readCurrentInstances();
    return instances.find((i) => i.id === id) || null;
  };

  const getInstanceSync = (id) => {
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    return cachedInstances.find((i) => i.id === id) || null;
  };

  const setInstances = async (instances) => {
    const explicit = instances.filter((i) => i.source !== 'ssh');
    const currentSettings = await readSettingsFromDiskMigrated();
    const existingExplicit = Array.isArray(currentSettings.remoteInstances) ? currentSettings.remoteInstances : [];
    const sanitized = sanitizeInstancesOrThrow(explicit, existingExplicit);
    await persistSettings({ remoteInstances: sanitized });
    await refreshCache();
    return getInstances();
  };

  const addInstance = async (instance) => {
    const validated = validateInstance(instance);
    if (!validated) {
      throw new Error('Invalid remote instance configuration');
    }

    const current = await readCurrentInstances();
    if (current.some((i) => i.id === validated.id)) {
      throw new Error(`Remote instance with id "${validated.id}" already exists`);
    }

    const next = [...current, validated];
    await persistSettings({ remoteInstances: next });
    cachedInstances = next;
    return validated;
  };

  const updateInstance = async (id, patch) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Instance ID is required');
    }

    const current = await readCurrentInstances();
    const index = current.findIndex((i) => i.id === id);
    if (index === -1) {
      throw new Error(`Remote instance "${id}" not found`);
    }

    const merged = { ...current[index], ...patch, id };
    const validated = validateInstance(merged);
    if (!validated) {
      throw new Error('Invalid remote instance configuration after update');
    }

    const next = [...current];
    next[index] = validated;
    await persistSettings({ remoteInstances: next });
    cachedInstances = next;
    return validated;
  };

  const removeInstance = async (id) => {
    if (typeof id !== 'string' || id.length === 0) {
      return false;
    }

    const current = await readCurrentInstances();
    const filtered = current.filter((i) => i.id !== id);
    if (filtered.length === current.length) {
      return false;
    }

    await persistSettings({ remoteInstances: filtered });
    cachedInstances = filtered;
    healthStatusMap.delete(id);
    requestPressureMap.delete(id);
    return true;
  };

  const isHealthy = (id) => {
    const status = healthStatusMap.get(id);
    return status ? status.healthy : false;
  };

  const setHealthStatus = (id, status) => {
    healthStatusMap.set(id, {
      healthy: status.healthy,
      lastCheck: Date.now(),
      latencyMs: status.latencyMs,
      error: status.error || undefined,
    });
  };

  const getHealthStatus = (id) => healthStatusMap.get(id) || null;

  const isHealthProbeInFlight = (id) => healthProbeInFlight.has(id);

  const finishHealthProbe = (id, status) => {
    setHealthStatus(id, status);
    if (status.healthy) {
      recordRemoteRequestSuccess(id);
    } else {
      recordRemoteRequestFailure(id, { status: 0 });
    }
    return status;
  };

  const probeHealth = async (instance, options = {}) => {
    const timeoutSec = normalizeHealthProbeTimeoutSec(options.timeoutSec, instance.connectionTimeoutSec);
    const startMs = Date.now();
    const deadlineMs = startMs + timeoutSec * 1000;
    const createRemainingTimeoutSignal = () => {
      const remainingMs = Math.ceil(deadlineMs - Date.now());
      if (remainingMs <= 0) {
        const error = new Error('Connection timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      return AbortSignal.timeout(Math.max(1, remainingMs));
    };

    try {
      const headers = buildRemoteAuthHeaders(instance);

      const response = await fetch(`${instance.url}/health`, {
        method: 'GET',
        headers,
        signal: createRemainingTimeoutSignal(),
      });

      const latencyMs = Date.now() - startMs;

      if (!response.ok) {
        const status = { healthy: false, latencyMs, error: `HTTP ${response.status}` };
        return finishHealthProbe(instance.id, status);
      }

      const data = await readJsonOrNull(response);
      if (!data) {
        const status = { healthy: false, latencyMs, error: 'Invalid health response' };
        return finishHealthProbe(instance.id, status);
      }

      const remoteServerHealthy = data.status === 'ok';
      if (!remoteServerHealthy) {
        const status = {
          healthy: false,
          latencyMs,
          error: data?.lastOpenCodeError || 'Remote health check failed',
        };
        return finishHealthProbe(instance.id, status);
      }

      const reportedOpenCodeReady = data?.isOpenCodeReady !== false && data?.openCodeRunning !== false;
      if (!reportedOpenCodeReady) {
        const status = {
          healthy: false,
          latencyMs,
          error: data?.lastOpenCodeError || 'OpenCode API is not ready',
        };
        return finishHealthProbe(instance.id, status);
      }

      const openCodeResponse = await fetch(`${instance.url}/api/global/health`, {
        method: 'GET',
        headers,
        signal: createRemainingTimeoutSignal(),
      });
      const finalLatencyMs = Date.now() - startMs;
      const openCodeData = await readJsonOrNull(openCodeResponse);

      if (!openCodeResponse.ok) {
        const status = {
          healthy: false,
          latencyMs: finalLatencyMs,
          error: describeHealthResponseError(openCodeResponse, openCodeData, 'OpenCode API'),
        };
        return finishHealthProbe(instance.id, status);
      }

      const healthy = openCodeData?.healthy === true;
      const error = healthy
        ? undefined
        : openCodeData?.error || 'OpenCode API is not healthy';
      const status = { healthy, latencyMs: finalLatencyMs, error };
      return finishHealthProbe(instance.id, status);
    } catch (error) {
      const latencyMs = Date.now() - startMs;
      const status = {
        healthy: false,
        latencyMs,
        error: isTimeoutError(error) ? 'Connection timed out' : (error?.message || 'Connection failed'),
      };
      return finishHealthProbe(instance.id, status);
    }
  };

  const ensureHealthy = async (id, options = {}) => {
    if (isHealthy(id)) {
      return true;
    }

    const instance = getInstanceSync(id);
    if (!instance || instance.enabled === false) {
      return false;
    }

    const existing = healthProbeInFlight.get(id);
    if (existing) {
      const status = await existing;
      return status.healthy === true;
    }

    const probe = probeHealth(instance, {
      ...options,
      timeoutSec: normalizeHealthProbeTimeoutSec(options.timeoutSec, instance.connectionTimeoutSec),
    }).finally(() => {
      healthProbeInFlight.delete(id);
    });

    healthProbeInFlight.set(id, probe);
    const status = await probe;
    return status.healthy === true;
  };

  const checkAllHealth = async () => {
    await refreshCache();
    const instances = cachedInstances.filter((i) => i.enabled !== false);
    await Promise.allSettled(instances.map((inst) => probeHealth(inst)));
  };

  const startHealthMonitoring = (intervalMs = DEFAULT_HEALTH_CHECK_INTERVAL_MS) => {
    stopHealthMonitoring();
    void refreshCache().then(() => checkAllHealth());
    healthMonitoringInterval = setInterval(() => {
      void checkAllHealth();
    }, intervalMs);
  };

  const stopHealthMonitoring = () => {
    if (healthMonitoringInterval) {
      clearInterval(healthMonitoringInterval);
      healthMonitoringInterval = null;
    }
  };

  const shutdown = () => {
    stopHealthMonitoring();
    healthStatusMap.clear();
    healthProbeInFlight.clear();
    requestPressureMap.clear();
  };

  void refreshCache();

  return {
    getInstances,
    getInstance,
    getInstanceSync,
    setInstances,
    addInstance,
    updateInstance,
    removeInstance,
    isHealthy,
    getHealthStatus,
    isHealthProbeInFlight,
    ensureHealthy,
    setHealthStatus,
    probeHealth,
    enterRequestLane,
    getRequestPressure,
    isRequestCircuitOpen,
    recordRemoteRequestSuccess,
    recordRemoteRequestFailure,
    startHealthMonitoring,
    stopHealthMonitoring,
    shutdown,
    refreshCache,
  };
};

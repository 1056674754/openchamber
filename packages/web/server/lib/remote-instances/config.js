const VALID_AUTH_TYPES = new Set(['none', 'password', 'bearer']);

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000;

const validateInstance = (inst) => {
  if (!inst || typeof inst !== 'object') {
    return null;
  }

  const id = typeof inst.id === 'string' ? inst.id.trim() : '';
  if (id.length === 0 || id.length > 128) {
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
  const authValue = authType !== 'none' && typeof inst?.auth?.value === 'string' ? inst.auth.value : undefined;

  return {
    id,
    label: typeof inst.label === 'string' ? inst.label.trim().slice(0, 256) || id : id,
    url: rawUrl,
    auth: {
      type: authType,
      value: authValue,
    },
    connectionTimeoutSec:
      typeof inst.connectionTimeoutSec === 'number' && Number.isFinite(inst.connectionTimeoutSec)
        ? Math.max(5, Math.min(300, Math.round(inst.connectionTimeoutSec)))
        : 30,
    enabled: typeof inst.enabled === 'boolean' ? inst.enabled : true,
  };
};

const sanitizeInstances = (input) => {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of input) {
    const validated = validateInstance(item);
    if (!validated) {
      continue;
    }
    if (seen.has(validated.id)) {
      continue;
    }
    seen.add(validated.id);
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
  let healthMonitoringInterval = null;
  let cachedInstances = [];

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
      ...inst,
      health: healthStatusMap.get(inst.id) || null,
    }));
  };

  const getInstance = async (id) => {
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    const instances = await getInstances();
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
    const sanitized = sanitizeInstances(explicit);
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

  const probeHealth = async (instance, options = {}) => {
    const timeoutSec = options.timeoutSec || instance.connectionTimeoutSec || 30;
    const startMs = Date.now();

    try {
      const headers = {};
      if (instance.auth?.type === 'password' && instance.auth.value) {
        headers.Authorization = `Basic ${Buffer.from(`user:${instance.auth.value}`).toString('base64')}`;
      } else if (instance.auth?.type === 'bearer' && instance.auth.value) {
        headers.Authorization = `Bearer ${instance.auth.value}`;
      }

      const response = await fetch(`${instance.url}/health`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutSec * 1000),
      });

      const latencyMs = Date.now() - startMs;

      if (!response.ok) {
        const status = { healthy: false, latencyMs, error: `HTTP ${response.status}` };
        setHealthStatus(instance.id, status);
        return status;
      }

      let data;
      try {
        data = await response.json();
      } catch {
        const status = { healthy: false, latencyMs, error: 'Invalid health response' };
        setHealthStatus(instance.id, status);
        return status;
      }

      const openCodeReady = data?.isOpenCodeReady !== false && data?.openCodeRunning !== false;
      const healthy = data && data.status === 'ok' && openCodeReady;
      const error = healthy
        ? undefined
        : data?.lastOpenCodeError || (openCodeReady ? 'Remote health check failed' : 'OpenCode API is not ready');
      const status = { healthy, latencyMs, error };
      setHealthStatus(instance.id, status);
      return status;
    } catch (error) {
      const latencyMs = Date.now() - startMs;
      const status = {
        healthy: false,
        latencyMs,
        error: error?.name === 'AbortError' ? 'Connection timed out' : (error?.message || 'Connection failed'),
      };
      setHealthStatus(instance.id, status);
      return status;
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
      timeoutSec: Math.min(options.timeoutSec || instance.connectionTimeoutSec || 30, 5),
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
    ensureHealthy,
    setHealthStatus,
    probeHealth,
    startHealthMonitoring,
    stopHealthMonitoring,
    shutdown,
    refreshCache,
  };
};

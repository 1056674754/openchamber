import fsPromises from 'node:fs/promises';
import { parseLsofListeners, parseNetstatListeners, parseProcNetTcpListeners, selectDevServerCandidates } from './parse.js';

const runCommand = (spawn, command, args, timeoutMs = 2500) => new Promise((resolve) => {
  let child;
  try { child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { resolve(null); return; }
  let stdout = '';
  let settled = false;
  const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill(); } catch { /* already exited */ } resolve(value); };
  const timer = setTimeout(() => finish(null), timeoutMs);
  child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
  child.on('error', () => finish(null));
  child.on('close', (code) => finish(code === 0 || stdout ? stdout : null));
});

const readProcListeners = async (readFile) => {
  const tables = await Promise.all(['/proc/net/tcp', '/proc/net/tcp6'].map((file) => readFile(file, 'utf8').catch(() => null)));
  if (tables.every((table) => table === null)) return null;
  const byPort = new Map();
  for (const table of tables) for (const entry of table ? parseProcNetTcpListeners(table) : []) if (!byPort.has(entry.port)) byPort.set(entry.port, entry);
  return [...byPort.values()].sort((a, b) => a.port - b.port);
};

export const createDevServerScanner = ({ spawn, platform, readFile = fsPromises.readFile }) => {
  let cache = null;
  const scan = async () => {
    if (platform === 'win32') {
      const output = await runCommand(spawn, 'netstat', ['-ano', '-p', 'TCP']);
      return output === null ? { ok: false, reason: 'netstat-unavailable' } : { ok: true, listeners: parseNetstatListeners(output) };
    }
    const output = await runCommand(spawn, 'lsof', ['-iTCP', '-sTCP:LISTEN', '-P', '-n', '-F', 'pcn']);
    if (output !== null) return { ok: true, listeners: parseLsofListeners(output) };
    const proc = await readProcListeners(readFile);
    return proc === null ? { ok: false, reason: 'no-listener-source' } : { ok: true, listeners: proc };
  };
  return {
    async discover({ ownPorts = [] } = {}) {
      const now = Date.now();
      if (cache && now - cache.at < 3000) return cache.value;
      const result = await scan();
      if (!result.ok) return result;
      const servers = selectDevServerCandidates(result.listeners, { ownPorts, ownPids: [process.pid] })
        .map((entry) => ({ ...entry, url: `http://localhost:${entry.port}/` }));
      const value = { ok: true, servers };
      cache = { at: now, value };
      return value;
    },
  };
};

export const registerDevServerRoutes = (app, { scanner, getOwnPorts }) => {
  app.get('/api/dev-servers', async (_req, res) => {
    try {
      const result = await scanner.discover({ ownPorts: getOwnPorts?.() ?? [] });
      if (!result.ok) return res.status(503).json({ error: 'Port discovery is unavailable', reason: result.reason });
      return res.json({ servers: result.servers });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'Port discovery failed' });
    }
  });
};

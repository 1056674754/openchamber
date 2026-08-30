const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const WILDCARD = new Set(['*', '0.0.0.0', '[::]', '::']);
const IGNORED_PORTS = new Set([22, 53, 445, 631, 5432, 3306, 6379, 27017, 9229]);

const splitHostPort = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close < 0 || raw[close + 1] !== ':') return null;
    return { host: raw.slice(0, close + 1), port: raw.slice(close + 2) };
  }
  const separator = raw.lastIndexOf(':');
  return separator < 0 ? null : { host: raw.slice(0, separator), port: raw.slice(separator + 1) };
};

const toPort = (value) => {
  const port = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
};

export const isLocallyReachableHost = (host) => {
  const value = String(host || '').trim().toLowerCase();
  return LOOPBACK.has(value) || WILDCARD.has(value);
};

export const parseLsofListeners = (output) => {
  const byPort = new Map();
  let pid = null;
  let command = '';
  for (const line of String(output || '').split('\n')) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') { const parsed = Number.parseInt(value, 10); pid = Number.isInteger(parsed) ? parsed : null; command = ''; continue; }
    if (tag === 'c') { command = value.trim(); continue; }
    if (tag !== 'n' || value.includes('->')) continue;
    const parsed = splitHostPort(value);
    const port = parsed ? toPort(parsed.port) : null;
    if (port === null || !isLocallyReachableHost(parsed.host)) continue;
    const existing = byPort.get(port);
    if (!existing || existing.pid === null) byPort.set(port, { port, pid, command });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
};

export const parseNetstatListeners = (output) => {
  const byPort = new Map();
  for (const line of String(output || '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || !/^tcp$/i.test(parts[0]) || !/^LISTENING$/i.test(parts[3])) continue;
    const parsed = splitHostPort(parts[1]);
    const port = parsed ? toPort(parsed.port) : null;
    if (port === null || !isLocallyReachableHost(parsed.host) || byPort.has(port)) continue;
    const pid = Number.parseInt(parts[4] ?? '', 10);
    byPort.set(port, { port, pid: Number.isInteger(pid) ? pid : null, command: '' });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
};

const PROC_ADDRESSES = new Set(['00000000', '00000000000000000000000000000000', '0100007F', '00000000000000000000000001000000']);
export const parseProcNetTcpListeners = (output) => {
  const byPort = new Map();
  for (const line of String(output || '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || parts[3] !== '0A') continue;
    const [address, portHex] = String(parts[1] || '').split(':');
    if (!PROC_ADDRESSES.has(String(address || '').toUpperCase())) continue;
    const port = Number.parseInt(portHex, 16);
    if (Number.isInteger(port) && port > 0 && port <= 65535 && !byPort.has(port)) byPort.set(port, { port, pid: null, command: '' });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
};

export const selectDevServerCandidates = (listeners, { ownPorts = [], ownPids = [] } = {}) => {
  const ports = new Set(ownPorts.filter(Number.isInteger));
  const pids = new Set(ownPids.filter(Number.isInteger));
  return listeners.filter((entry) => !ports.has(entry.port) && !pids.has(entry.pid) && !IGNORED_PORTS.has(entry.port));
};

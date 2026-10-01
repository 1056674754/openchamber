import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execute = promisify(execFile);

// Suffix tolerance is deliberate: this fork runs an OpenCode fork whose
// releases carry an `-sscity` suffix (e.g. `2.0.14-sscity`), and prerelease /
// build metadata must never break parsing or comparisons.
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
const infoSchema = z.object({ version: versionSchema });
const legacyHealthSchema = z.object({ version: versionSchema, healthy: z.boolean() });

/**
 * OpenCode 2.x floor for the v2 track. Spine pin placeholder (plan J1): the
 * S8 activation batch realigns this with the `../opencode` 2.x release that
 * finally ships. 2.0.14 is the wire vocabulary the spine was ported against.
 * Advisory only — nothing in this fork hard-fails on an older version; the
 * protocol-mode store keeps those instances on the v1 track instead.
 */
export const PROTOCOL_V2_MINIMUM_VERSION = '2.0.14';

const releaseParts = (version) => version.split(/[-+]/, 1)[0].split('.').map(Number);

const compareRelease = (left, right) => {
  const a = releaseParts(left);
  const b = releaseParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};

/** Suffix-aware numeric release comparison (`2.0.9` < `2.0.14-sscity`). */
export const compareOpenCodeReleases = (left, right) => compareRelease(left, right);

const isParseableVersion = (version) => versionSchema.safeParse(version).success;

/**
 * Whether a parsed version is at or above the v2-track floor. Pure numeric
 * floor (suffix-aware); compose with `supportsProtocolV2Track` for the full
 * capability gate.
 */
export const meetsProtocolV2Minimum = (version) => isParseableVersion(version)
  && compareRelease(version, PROTOCOL_V2_MINIMUM_VERSION) >= 0;

export const readOpenCodeInfo = async (response) => {
  if (!response.ok) return null;
  const parsed = infoSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
};

export const readOpenCodeCliVersion = async (launch, options = {}) => {
  const { stdout } = await execute(launch.binary, [...launch.args, '--version'], {
    ...options, encoding: 'utf8', timeout: 15_000, maxBuffer: 16 * 1024, windowsHide: true,
  });
  const match = /^(?:opencode\s+v?)?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/.exec(stdout.trim());
  if (!match) throw new Error('Could not determine the installed OpenCode version.');
  return match[1];
};

// External URLs have no local executable. A legacy probe identifies v1 only
// from its JSON contract; neither HTML fallbacks nor auth failures imply v1.
// v1 has no `/api/info`: its catch-all serves the web UI, and a v1 build
// without the embedded UI proxies that path to app.opencode.ai, which can hang
// or fail. A failed v2 probe therefore still falls through to the v1 probe.
// Auth failures (401/403) stay ambiguous on both probes — a gated server must
// not be downgraded to v1 just because it refused the probe.
export const readExternalOpenCodeVersion = async (baseUrl, headers, fetchImpl = fetch) => {
  const request = (pathname) => fetchImpl(new URL(pathname, baseUrl), {
    headers: { ...headers, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  const response = await request('/api/info').catch(() => null);
  if (response && (response.status === 401 || response.status === 403)) return null;
  const info = response ? await readOpenCodeInfo(response) : null;
  if (info) return info.version;
  const legacy = await request('/global/health');
  if (!legacy.ok) return null;
  const parsed = legacyHealthSchema.safeParse(await legacy.json().catch(() => null));
  return parsed.success && parsed.data.version.startsWith('1.') ? parsed.data.version : null;
};

/**
 * Fork dual-stack judgment: which wire protocol a version speaks. `2.x` (any
 * suffix) is v2; `1.x`, future majors, and unparseable values all stay on the
 * conservative v1 track so the default experience never changes until the
 * managed instance is deliberately flipped (plan §2).
 */
export const resolveProtocolModeFromVersion = (version) => {
  if (!isParseableVersion(version)) return 'v1';
  return releaseParts(version)[0] === 2 ? 'v2' : 'v1';
};

/**
 * Full R5 capability gate for v2-only surfaces (e.g. `GET /api/credential`,
 * 2.0.20+): the version must speak the v2 protocol AND clear the floor.
 * Anything else — 1.x, prerelease-of-floor 2.x, future majors, unparseable —
 * keeps those surfaces on the v1 track.
 */
export const supportsProtocolV2Track = (version) => (
  resolveProtocolModeFromVersion(version) === 'v2' && meetsProtocolV2Minimum(version)
);

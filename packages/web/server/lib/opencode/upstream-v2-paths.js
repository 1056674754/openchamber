import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';

/**
 * v1 → v2 upstream request-path translation (OC2 spine finale).
 *
 * OpenCode 2 serves its whole API under the `/api` prefix; its v1-shaped
 * root-level paths do not exist there and answer with a bare 500. The fork's
 * dual-track strategy keeps v1 callers working by mapping at the single
 * upstream-URL boundary instead of changing every call site:
 *
 * - v1 mode: paths pass through byte-stable.
 * - v2 mode: a v1 path is prefixed with `/api`, except paths that are already
 *   v2-shaped, and a small rename table for the v1 names OpenCode 2 renamed
 *   or folded (verified against the 2.0.x endpoint table):
 *   - `/global/event` → `/event`: v2 carries one global event stream at
 *     `/api/event` (scoped per location only by the directory header/query).
 *   - `/path` → `/location`: `path.get` merged into `location.get`.
 *   - `/session/status` → `/session/active`: the v1 name would otherwise
 *     route into `/api/session/:sessionID` and answer 400.
 *
 * Query translation lives here too: the v2 location middleware scopes a
 * request from `?location[directory]=` or the `x-opencode-directory` header
 * and IGNORES v1's `?directory=` — silently falling back to the server's own
 * working directory. Rewriting the parameter at the same boundary keeps
 * directory-scoped v1 callers correct on the v2 track.
 */

const V2_RENAMED_PATHS = new Map([
  ['/global/event', '/event'],
  ['/path', '/location'],
  ['/session/status', '/session/active'],
]);

const splitPathQuery = (path) => {
  const queryIndex = path.indexOf('?');
  if (queryIndex < 0) return { pathname: path, search: '' };
  return { pathname: path.slice(0, queryIndex), search: path.slice(queryIndex) };
};

/**
 * Map one request path (no rewriting of already-v2 `/api`-prefixed paths,
 * the empty path used for base-URL building, or anything on the v1 track).
 */
export const resolveUpstreamRequestPath = (path, mode) => {
  if (mode !== 'v2') return path;
  const { pathname, search } = splitPathQuery(path);
  if (pathname === '' || pathname === '/' || pathname === '/api' || pathname.startsWith('/api/')) {
    return path;
  }
  const renamed = V2_RENAMED_PATHS.get(pathname) ?? pathname;
  return `/api${renamed}${search}`;
};

/** The same mapping against the default (managed) instance's recorded mode. */
export const resolveUpstreamRequestPathForDefaultServer = (path, env = process.env) => (
  resolveUpstreamRequestPath(path, resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID, env))
);

/**
 * Move v1's `?directory=` to the v2 location query on an upstream path.
 * An explicit v2 `location[directory]` wins and the v1 parameter is dropped;
 * a request that never carried a directory is returned untouched.
 */
export const rewriteDirectoryQueryForUpstream = (pathWithQuery, mode) => {
  if (mode !== 'v2' || !pathWithQuery.includes('directory=')) return pathWithQuery;
  const { pathname, search } = splitPathQuery(pathWithQuery);
  const params = new URLSearchParams(search);
  const directory = params.get('directory');
  if (!directory) return pathWithQuery;
  params.delete('directory');
  if (!params.has('location[directory]')) {
    params.set('location[directory]', directory);
  }
  const nextSearch = params.toString();
  return nextSearch ? `${pathname}?${nextSearch}` : pathname;
};

/** The same query rewrite against the default instance's recorded mode. */
export const rewriteDirectoryQueryForDefaultServer = (pathWithQuery, env = process.env) => (
  rewriteDirectoryQueryForUpstream(pathWithQuery, resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID, env))
);

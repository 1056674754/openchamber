import { useCallback } from 'react';
import { create } from 'zustand';
import { getSafeStorage } from '@/stores/utils/safeStorage';
import { normalizePath } from '@/lib/pathNormalization';
import { createSessionActivityKey } from './session-activity-key';

// Per-session turn timing behind the sidebar activity readout.
//
// The OpenCode status contract carries no timestamps — `SessionStatus` is a
// bare `busy | retry | idle` union — so how long the current turn has been
// running has to be measured on the client. This module owns that measurement
// and is driven from the same two write paths as the child-store status maps
// the index rows actually render their live state from, so a row can never
// count a turn that index calls idle.
//
// [sscity-mod] Multi-instance: records are keyed by the fork's composite
// `createSessionActivityKey(serverId, directory, sessionId)` instead of bare
// session IDs. Two OpenCode servers can each mint session IDs independently,
// so bare session IDs are not unique across instances — the composite key is
// the canonical identity the rest of the sync layer already uses.
//
// Two maps with deliberately different lifetimes:
//
// - `startedAt` — sessions observed active right now. Persisted, so reloading
//   the page resumes the same count instead of restarting it at zero.
// - `settledMs` — how long the turn that just finished took. In memory only:
//   rows show it while the session is unread, and unread state itself does not
//   survive a reload, so persisting it would outlive its only consumer.
//
// A persisted start is a lookup table, never a claim of activity. Nothing in
// the protocol marks where a turn begins: the server calls `SessionStatus.set`
// with `busy` at every step of the agent loop and publishes an event each time,
// so a busy event means "still running", not "just started" — it cannot be read
// as a turn boundary, and reading it that way reset every counter on reload,
// because after a refresh one of those repeats almost always beats the first
// status snapshot.
//
// Turn *ends* are marked: `session.idle` and `session.error` events fire once,
// live, and retire the persisted record.
//
// That leaves the case with no observable answer at all: a turn that ended, and
// another that began, entirely while the tab was gone. Two bounds stand in for
// the evidence the client cannot have:
//
// - a liveness stamp beside the start, refreshed while the session is observed
//   active and stamped precisely as the page hides, compared against this page's
//   navigation start — how long the app was actually absent;
// - an adoption window after load, after which unclaimed records are discarded,
//   which backstops a runtime whose event stream is down and where snapshots are
//   therefore the only signal.
//
// Nothing else may drop a persisted start. Status snapshots legitimately arrive
// before they can see a session as busy — bootstrap fetches status and sessions
// in parallel, directory scopes resolve at different times — and treating one
// of those as "the turn ended" destroyed the start moments before the real busy
// snapshot arrived, which is exactly the reload-resets-to-zero bug. Absence of
// evidence is not evidence here; only the two bounds above expire a record.

type SessionActivityPhase = 'active' | 'settled';

type SessionActivityTimingState = {
  startedAt: ReadonlyMap<string, number>;
  settledMs: ReadonlyMap<string, number>;
};

/** Persisted per session: when this turn began, and when it was last alive. */
type PersistedStart = { start: number; seen: number };

/** Finished turns worth remembering at once; each row only needs its own. */
const SETTLED_LIMIT = 200;
/** A turn running longer than this is treated as a stale record, not a turn. */
const MAX_TURN_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * How long the app may have been gone and still have its counters resumed,
 * measured from the liveness stamp to this page's navigation start — not to
 * "now". Bootstrap latency belongs to this page, not to the absence, and this
 * client has seen 20-second startups; charging those to the gap would refuse
 * a legitimate resume on exactly the slowest machines.
 */
const MAX_AWAY_MS = 30_000;
/** Refresh the persisted stamp at most this often during a long turn. */
const LIVENESS_PERSIST_INTERVAL_MS = 15_000;
/**
 * How long after page load a persisted record may still be adopted. Past this
 * point the app has certainly seen live status, so a record nothing claimed
 * describes a turn that is over — and a turn starting later is a new one that
 * must count from zero.
 */
const RESTORE_ADOPTION_WINDOW_MS = 90_000;
// One key, not one per runtime. These records live for seconds and are keyed by
// the fork's composite activity key (`serverId + directory + sessionId`), which
// is instance-unique. Runtime scoping of the storage key itself bought nothing
// while adding a real failure mode: the runtime key is derived from injected
// globals and is not guaranteed stable across early startup, and a read under a
// key the previous page did not write to looks exactly like "no turn was
// running".
const STORAGE_KEY = 'oc.session-activity.v1';

const EMPTY_ACTIVE: ReadonlySet<string> = new Set();
const EMPTY_RESTORED: ReadonlyMap<string, PersistedStart> = new Map();

export const useSessionActivityTimingStore = create<SessionActivityTimingState>(() => ({
  startedAt: new Map(),
  settledMs: new Map(),
}));

/** Last moment each live start was observed active, for the liveness stamp. */
const liveSeen = new Map<string, number>();
let lastPersistAt = 0;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let restoredStarts: Map<string, PersistedStart> | null = null;

/** Epoch ms of this page's navigation start; the reference for "how long gone". */
const readPageLoadAt = (): number => {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)) {
    return performance.timeOrigin;
  }
  return Date.now();
};

let pageLoadAt = readPageLoadAt();

const isResumable = (entry: PersistedStart, now: number): boolean => (
  entry.start <= now
  && now - entry.start <= MAX_TURN_AGE_MS
  && entry.seen <= now
  // Negative when this page wrote the stamp itself, which is trivially fresh.
  && pageLoadAt - entry.seen <= MAX_AWAY_MS
);

const parseEntry = (value: unknown): PersistedStart | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { start, seen } = value as { start?: unknown; seen?: unknown };
  if (typeof start !== 'number' || !Number.isFinite(start)) return null;
  if (typeof seen !== 'number' || !Number.isFinite(seen)) return null;
  return { start, seen };
};

const readRestoredStarts = (): Map<string, PersistedStart> => {
  const restored = new Map<string, PersistedStart>();
  let raw: string | null = null;
  try {
    raw = getSafeStorage().getItem(STORAGE_KEY);
  } catch {
    return restored;
  }
  if (!raw) return restored;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed payload is a failed read, not authoritative "no turns were
    // running": live status re-seeds every counter from now either way.
    return restored;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return restored;

  const now = Date.now();
  for (const [activityKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = parseEntry(value);
    // Rejects stale turns, quiet stamps, and clock-skewed futures rather than
    // rendering a counter that reads days long or negative.
    if (entry && isResumable(entry, now)) restored.set(activityKey, entry);
  }
  return restored;
};

const getRestoredStarts = (): Map<string, PersistedStart> => {
  restoredStarts ??= readRestoredStarts();
  return restoredStarts;
};

/**
 * Restored records still eligible to be adopted. Past the adoption window they
 * are dropped for good, so a turn that starts later counts from zero instead of
 * inheriting the start of whatever ran before the reload.
 */
const getAdoptableStarts = (now: number): ReadonlyMap<string, PersistedStart> => {
  if (now - pageLoadAt > RESTORE_ADOPTION_WINDOW_MS) {
    restoredStarts?.clear();
    return EMPTY_RESTORED;
  }
  return getRestoredStarts();
};

// Live starts merged over restored-but-unconfirmed ones, so a reload landing
// before the first authoritative snapshot does not drop the starts that
// snapshot is about to confirm. Restored entries whose stamp has gone quiet are
// dropped here, which is the only way they leave storage.
const persistStarts = (startedAt: ReadonlyMap<string, number>, now: number): void => {
  const payload: Record<string, PersistedStart> = {};
  for (const [activityKey, entry] of getRestoredStarts()) {
    if (isResumable(entry, now)) payload[activityKey] = entry;
  }
  for (const [activityKey, start] of startedAt) {
    payload[activityKey] = { start, seen: liveSeen.get(activityKey) ?? now };
  }

  lastPersistAt = now;
  try {
    const storage = getSafeStorage();
    if (Object.keys(payload).length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage is unavailable or full; counters simply restart after a reload.
  }
};

// The most accurate liveness stamp available: the page is going away and every
// running turn was still running as of now. Writes are immediate (not deferred)
// so this cannot lose the race against a deferred flush on the same event.
const stampLiveness = (): void => {
  const { startedAt } = useSessionActivityTimingStore.getState();
  if (startedAt.size === 0) return;
  const now = Date.now();
  for (const activityKey of startedAt.keys()) liveSeen.set(activityKey, now);
  persistStarts(startedAt, now);
};

let lifecycleHooked = false;

const ensureLivenessStampOnHide = (): void => {
  if (lifecycleHooked || typeof window === 'undefined') return;
  lifecycleHooked = true;
  try {
    // `pagehide` covers unload and bfcache entry; `visibilitychange`/`freeze`
    // cover backgrounding and are the reliable ones in WKWebView. No
    // `beforeunload` — it would cost bfcache for a stamp the others already
    // wrote.
    window.addEventListener('pagehide', stampLiveness, { capture: true });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') stampLiveness();
      });
      document.addEventListener('freeze', stampLiveness);
    }
  } catch {
    // Restricted environments can reject listeners; the periodic stamp refresh
    // still bounds how quiet a running turn's record can get.
  }
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

const trimSettled = (settled: Map<string, number>): void => {
  while (settled.size > SETTLED_LIMIT) {
    const oldest = settled.keys().next();
    if (oldest.done) return;
    settled.delete(oldest.value);
  }
};

/**
 * What ends a turn in this pass. An event names its session outright; a snapshot
 * only answers whether it covers a given one — deliberately the cheaper
 * question, since the settle loop walks running turns rather than session lists.
 * An `event` idle is a live, one-shot "this turn is over"; a snapshot omitting a
 * session is not, because it may simply not see it yet.
 */
type SettleInput =
  | { source: 'event'; activityKey: string }
  | { source: 'snapshot'; isCovered: (activityKey: string) => boolean };

const applyTransitions = (
  activeActivityKeys: ReadonlySet<string>,
  settle: SettleInput | null,
): void => {
  const now = Date.now();
  const restored = getAdoptableStarts(now);
  const state = useSessionActivityTimingStore.getState();

  const next: { started: Map<string, number> | null; settled: Map<string, number> | null } = {
    started: null,
    settled: null,
  };
  let sawActive = false;
  let restoredChanged = false;

  const draftStarted = (): Map<string, number> => (next.started ??= new Map(state.startedAt));
  const draftSettled = (): Map<string, number> => (next.settled ??= new Map(state.settledMs));

  for (const activityKey of activeActivityKeys) {
    sawActive = true;
    liveSeen.set(activityKey, now);
    if ((next.started ?? state.startedAt).has(activityKey)) continue;
    // Busy carries no turn boundary from either source: the server re-publishes
    // `session.status: busy` on every step of the agent loop, so a busy event
    // means "still running", not "just started". Both paths therefore prefer a
    // persisted start when one survives; only the bounds below expire it.
    draftStarted().set(activityKey, restored.get(activityKey)?.start ?? now);
    if ((next.settled ?? state.settledMs).has(activityKey)) draftSettled().delete(activityKey);
  }

  const settleTurn = (activityKey: string, start: number): void => {
    draftStarted().delete(activityKey);
    liveSeen.delete(activityKey);
    draftSettled().set(activityKey, Math.max(0, now - start));
  };

  if (settle === null) {
    // Nothing ends this pass.
  } else if (settle.source === 'event') {
    // An idle/error event is a live, unambiguous end of turn, so it also retires
    // the persisted record. A snapshot's silence is not: it may simply not see
    // the session yet.
    if (getRestoredStarts().delete(settle.activityKey)) restoredChanged = true;
    const start = state.startedAt.get(settle.activityKey);
    // Only a turn watched from its start yields a duration.
    if (start !== undefined) settleTurn(settle.activityKey, start);
  } else {
    // Walk the running turns, not everything the snapshot covers. Only a live
    // start can settle, and there are a handful of those against a directory's
    // hundreds of sessions — asking "does this snapshot cover that one?" keeps
    // the pass proportional to the work instead of to the session list, and
    // allocates nothing per poll.
    //
    // [sscity-mod] Scoped to the snapshot's (serverId, directory): entries
    // belonging to other instances keep running, since this snapshot has no
    // authority over them.
    for (const [activityKey, start] of state.startedAt) {
      if (activeActivityKeys.has(activityKey)) continue;
      if (!settle.isCovered(activityKey)) continue;
      settleTurn(activityKey, start);
    }
  }

  if (next.settled) trimSettled(next.settled);

  if (next.started || next.settled) {
    useSessionActivityTimingStore.setState({
      startedAt: next.started ?? state.startedAt,
      settledMs: next.settled ?? state.settledMs,
    });
  }

  if (next.started) {
    if (next.started.size > 0) ensureLivenessStampOnHide();
    persistStarts(next.started, now);
    return;
  }
  if (restoredChanged) {
    persistStarts(state.startedAt, now);
    return;
  }
  // Nothing structural changed, but a long-running turn still needs its stamp
  // refreshed so a reload can tell it apart from one that ended unobserved.
  if (sawActive && state.startedAt.size > 0 && now - lastPersistAt >= LIVENESS_PERSIST_INTERVAL_MS) {
    persistStarts(state.startedAt, now);
  }
};

/**
 * Event-driven path: one session changed phase, live. Busy repeats throughout a
 * turn and carries no boundary; idle/error fire once and end it, which is why
 * only settling here retires the persisted record.
 */
export const observeSessionActivityTiming = (
  serverId: string,
  directory: string,
  sessionId: string,
  phase: SessionActivityPhase,
): void => {
  const activityKey = createSessionActivityKey(serverId, directory, sessionId);
  if (phase === 'active') {
    applyTransitions(new Set([activityKey]), null);
    return;
  }
  applyTransitions(EMPTY_ACTIVE, { source: 'event', activityKey });
};

/**
 * Authoritative path: a `/session/status` snapshot for one directory. Sessions
 * the snapshot covers but does not report active stop their live counters —
 * that is what recovers a turn whose end event this client missed — but their
 * persisted records survive, because a snapshot that cannot yet see a session
 * looks identical to one whose turn is over.
 *
 * [sscity-mod] Scoped to `(serverId, directory)`: the active session IDs passed
 * in are bare session IDs local to that instance, and are converted to composite
 * activity keys internally. Entries belonging to other instances are never
 * settled by this call.
 */
export const reconcileSessionActivityTiming = (
  serverId: string,
  directory: string,
  activeSessionIds: ReadonlySet<string>,
  isCoveredBySnapshot: (sessionId: string) => boolean,
): void => {
  const activeActivityKeys = new Set<string>();
  for (const sessionId of activeSessionIds) {
    activeActivityKeys.add(createSessionActivityKey(serverId, directory, sessionId));
  }
  // Coverage is per bare session ID, but only within this snapshot's scope.
  // Entries from other instances never match the scope, so they are never
  // tested for coverage and never settled.
  const normalizedDirectory = normalizePath(directory ?? '') ?? '';
  const isCovered = (activityKey: string): boolean => {
    const scope = parseActivityKey(activityKey);
    if (!scope || scope.serverId !== serverId || scope.directory !== normalizedDirectory) {
      return false;
    }
    return isCoveredBySnapshot(scope.sessionId);
  };
  applyTransitions(activeActivityKeys, { source: 'snapshot', isCovered });
};

export const removeSessionActivityTiming = (
  serverId: string,
  directory: string,
  sessionId: string,
): void => {
  const activityKey = createSessionActivityKey(serverId, directory, sessionId);
  const restoredChanged = getRestoredStarts().delete(activityKey);
  const state = useSessionActivityTimingStore.getState();
  const hadStart = state.startedAt.has(activityKey);
  const hadSettled = state.settledMs.has(activityKey);
  liveSeen.delete(activityKey);

  if (!hadStart && !hadSettled) {
    if (restoredChanged) persistStarts(state.startedAt, Date.now());
    return;
  }

  let startedAt = state.startedAt;
  if (hadStart) {
    const draft = new Map(state.startedAt);
    draft.delete(activityKey);
    startedAt = draft;
  }
  let settledMs = state.settledMs;
  if (hadSettled) {
    const draft = new Map(state.settledMs);
    draft.delete(activityKey);
    settledMs = draft;
  }

  useSessionActivityTimingStore.setState({ startedAt, settledMs });
  if (hadStart || restoredChanged) persistStarts(startedAt, Date.now());
};

/**
 * [sscity-mod] Removes all timing records belonging to one server instance.
 * Called when a remote server is disconnected or its SyncProvider unmounts,
 * since its sessions' turns are no longer ours to track.
 */
export const removeSessionActivityTimingForServer = (serverId: string): void => {
  const state = useSessionActivityTimingStore.getState();
  const startedAt = new Map(state.startedAt);
  const settledMs = new Map(state.settledMs);
  let changed = false;

  for (const activityKey of state.startedAt.keys()) {
    if (!isActivityKeyForServer(activityKey, serverId)) continue;
    startedAt.delete(activityKey);
    liveSeen.delete(activityKey);
    changed = true;
  }
  for (const activityKey of state.settledMs.keys()) {
    if (!isActivityKeyForServer(activityKey, serverId)) continue;
    settledMs.delete(activityKey);
    changed = true;
  }
  // Drop persisted records for this server too.
  const restored = getRestoredStarts();
  for (const activityKey of Array.from(restored.keys())) {
    if (isActivityKeyForServer(activityKey, serverId)) {
      restored.delete(activityKey);
      changed = true;
    }
  }

  if (!changed) return;
  useSessionActivityTimingStore.setState({ startedAt, settledMs });
  persistStarts(startedAt, Date.now());
};

/**
 * Extracts the serverId from a composite activity key, checking whether it
 * belongs to the given server. The key format is
 * `JSON.stringify([serverId, directory, sessionId])`.
 */
const isActivityKeyForServer = (activityKey: string, serverId: string): boolean => {
  const scope = parseActivityKey(activityKey);
  return scope !== null && scope.serverId === serverId;
};

/** Parses a composite activity key back into its scope components. */
const parseActivityKey = (activityKey: string): { serverId: string; directory: string; sessionId: string } | null => {
  try {
    const parsed = JSON.parse(activityKey) as unknown[];
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [serverId, directory, sessionId] = parsed;
    if (typeof serverId !== 'string' || typeof directory !== 'string' || typeof sessionId !== 'string') return null;
    return { serverId, directory, sessionId };
  } catch {
    return null;
  }
};

/**
 * Drops in-memory state and the cached restored-start snapshot — i.e. treats
 * what follows as a fresh page load. Called on a runtime switch, where the
 * previous instance's turns are no longer ours, and by tests. `pageLoadAt`
 * overrides the navigation-start reference so tests can place a load in the
 * past (slow bootstrap, expired window).
 */
export const resetSessionActivityTiming = (options: { pageLoadAt?: number } = {}): void => {
  restoredStarts = null;
  liveSeen.clear();
  lastPersistAt = 0;
  pageLoadAt = options.pageLoadAt ?? Date.now();
  useSessionActivityTimingStore.setState({ startedAt: new Map(), settledMs: new Map() });
};

// ---------------------------------------------------------------------------
// Leaf subscriptions
// ---------------------------------------------------------------------------

export const useSessionActivityStartedAt = (
  serverId: string,
  directory: string,
  sessionId: string,
): number | undefined => {
  const activityKey = createSessionActivityKey(serverId, directory, sessionId);
  // createSessionActivityKey is deterministic for the same inputs, so the key
  // is stable across renders when serverId/directory/sessionId don't change.
  return useSessionActivityTimingStore(useCallback((state) => state.startedAt.get(activityKey), [activityKey]));
};

export const useSessionSettledDurationMs = (
  serverId: string,
  directory: string,
  sessionId: string,
): number | undefined => {
  const activityKey = createSessionActivityKey(serverId, directory, sessionId);
  return useSessionActivityTimingStore(useCallback((state) => state.settledMs.get(activityKey), [activityKey]));
};

/**
 * Whether a duration exists to render, without subscribing the caller to the
 * value itself — a row uses this to decide between the counter and its normal
 * metadata, and must not re-render every tick to do so.
 */
export const useHasSessionActivityDuration = (
  serverId: string,
  directory: string,
  sessionId: string,
  running: boolean,
): boolean => {
  const activityKey = createSessionActivityKey(serverId, directory, sessionId);
  return useSessionActivityTimingStore(useCallback((state) => (
    running ? state.startedAt.has(activityKey) : state.settledMs.has(activityKey)
  ), [running, activityKey]));
};

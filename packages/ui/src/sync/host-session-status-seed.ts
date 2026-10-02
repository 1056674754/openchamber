import type { Event } from '@opencode-ai/sdk/v2/client';
import { opencodeClient } from '@/lib/opencode/client';
import type { HostSessionStatusSnapshot } from '@/lib/opencode/session-status';
import type { PermissionRequest } from '@/types/permission';
import type { FormRequest } from '@/types/form';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { applyGlobalSessionStatusEvents, useGlobalSessionStatusStore } from './global-session-status';
import { seedGlobalBlockingRequests } from './global-blocking-requests';

// Seeds the cross-directory status index from the host's own map.
//
// Directory bootstrap only runs for the directory the user is working in, so a
// turn that was already running in another project when this client started
// is invisible to the event stream until its next status event. The OpenChamber
// host (web server) has been listening to the single upstream stream the whole
// time and answers `/api/sessions/status` in one request without creating
// OpenCode instances.
//
// The seed is strictly additive: it only adds busy entries for sessions this
// client has not observed itself. Absence from the host map never clears
// anything, because the map has no directory and a missing entry proves
// nothing about a session the client already knows to be running. A live event
// that arrives before the seed wins, since the event path records every
// observed session and the seed skips those.

// Nothing on the host reconciles its map against OpenCode after a stream gap,
// so a missed idle can leave `busy` there for the host's 24-hour retention.
// A running turn refreshes its entry at every agent-loop step; an entry older
// than this is not trusted as current activity. A genuinely long tool call
// past this age simply waits for its next event instead of being seeded.
export const HOST_STATUS_SEED_MAX_AGE_MS = 30 * 60_000;

type SeedDependencies = {
  isKnown: (sessionId: string) => boolean;
  resolveDirectory: (sessionId: string) => string | null;
};

/**
 * Turns the host snapshot into per-directory `session.status` events for the
 * sessions the client has no live observation of. Retry collapses to busy:
 * the host keeps no attempt details, and the next live event restores them.
 */
export const buildHostStatusSeedEvents = (
  snapshot: HostSessionStatusSnapshot,
  deps: SeedDependencies,
  maxAgeMs = HOST_STATUS_SEED_MAX_AGE_MS,
): Map<string, Event[]> => {
  const eventsByDirectory = new Map<string, Event[]>();
  for (const [sessionId, entry] of Object.entries(snapshot.sessions)) {
    if (entry.status !== 'busy' && entry.status !== 'retry') continue;
    if (snapshot.serverTime - entry.lastUpdateAt > maxAgeMs) continue;
    if (deps.isKnown(sessionId)) continue;
    const directory = deps.resolveDirectory(sessionId);
    if (!directory) continue;
    const events = eventsByDirectory.get(directory) ?? [];
    events.push({
      id: `host-seed:${sessionId}`,
      type: 'session.status',
      properties: { sessionID: sessionId, status: { type: 'busy' } },
    });
    eventsByDirectory.set(directory, events);
  }
  return eventsByDirectory;
};

let inFlight: Promise<void> | null = null;

/**
 * Fetches the host map once and seeds unobserved busy sessions into the
 * cross-directory status index and the global catalog's status map. Coalesces
 * overlapping calls.
 */
export const seedGlobalSessionStatusFromHost = (): Promise<void> => {
  if (inFlight) return inFlight;
  const runtimeKey = getRuntimeKey();
  inFlight = (async () => {
    const snapshot = await opencodeClient.getHostSessionStatusSnapshot();
    // A runtime switch between request and response clears the index; the old
    // host's sessions must not be written into the new one.
    if (!snapshot || getRuntimeKey() !== runtimeKey) return;
    const status = useGlobalSessionStatusStore.getState();
    const catalog = useGlobalSessionsStore.getState();
    const directoryBySessionId = new Map<string, string | null>();
    const resolveDirectory = (sessionId: string): string | null => {
      const cached = directoryBySessionId.get(sessionId);
      if (cached !== undefined) return cached;
      const session = catalog.activeSessions.find((entry) => entry.id === sessionId)
        ?? catalog.archivedSessions.find((entry) => entry.id === sessionId);
      const directory = session ? resolveGlobalSessionDirectory(session) : null;
      directoryBySessionId.set(sessionId, directory);
      return directory;
    };
    const seedEvents = buildHostStatusSeedEvents(snapshot, {
      isKnown: (sessionId) => status.statusById.has(sessionId) || status.observedById.has(sessionId),
      resolveDirectory,
    });
    for (const [directory, payloads] of seedEvents) {
      applyGlobalSessionStatusEvents(directory, payloads);
    }
    // The global catalog's status map feeds the tray, collapsed folder rows,
    // and queued auto-send. Mirror the additive busy/retry seed into it so the
    // fork's multi-server pipeline sees the same live activity without any
    // per-directory instance-creating request.
    const seededStatuses: Array<[string, { type: 'busy' }]> = [];
    for (const payloads of seedEvents.values()) {
      for (const payload of payloads) {
        const props = payload.properties as { sessionID?: string };
        if (props.sessionID) seededStatuses.push([props.sessionID, { type: 'busy' }]);
      }
    }
    if (seededStatuses.length > 0) {
      useGlobalSessionsStore.setState((state) => {
        let changed = false;
        const next = new Map(state.sessionStatuses);
        for (const [sessionId, value] of seededStatuses) {
          if (next.has(sessionId)) continue;
          next.set(sessionId, value);
          changed = true;
        }
        return changed ? { sessionStatuses: next } : state;
      });
    }
    // Pending permissions and forms ride on the same response. They are
    // not age-limited: the host drops them on reply, deletion, and OpenCode
    // restart, so a listed request is one OpenCode is still waiting on.
    // (The host payload keys stay `questions` — that wire contract predates
    // the S7 concept rename.)
    const pending: Array<{
      sessionId: string;
      directory: string;
      permissions: readonly PermissionRequest[];
      forms: readonly FormRequest[];
    }> = [];
    for (const [sessionId, entry] of Object.entries(snapshot.pending ?? {})) {
      const directory = resolveDirectory(sessionId);
      if (!directory) continue;
      // `forms` is the v2 ask bucket the host tracks on a v2 upstream; the v1
      // `questions` key keeps its wire contract. Both ride the same store.
      // The v2 ask naming (`action`/`resources`/`save`) folds into the v1
      // field names the store reads; the v1 fields win when present.
      const permissions = entry.permissions.map((request): PermissionRequest => ({
        id: request.id,
        sessionID: request.sessionID,
        permission: request.permission ?? request.action ?? '',
        patterns: request.patterns ?? request.resources ?? [],
        metadata: request.metadata ?? {},
        always: request.always ?? request.save ?? [],
        ...(request.tool ? { tool: request.tool } : {}),
      }));
      const forms = [...(entry.questions ?? []), ...(entry.forms ?? [])].map((form): FormRequest => form as unknown as FormRequest);
      pending.push({ sessionId, directory, permissions, forms });
    }
    seedGlobalBlockingRequests(pending);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

/**
 * Server-side archive batch.
 *
 * Archiving the sessions linked to a worktree one request at a time is what
 * made removing a worktree with many sessions take tens of seconds: every
 * session cost its own round trip and its own store reconciliation. This asks
 * the OpenChamber server to archive the whole batch next to OpenCode, so the
 * browser spends one request and reconciles once.
 *
 * The route is an OpenChamber capability, not an OpenCode one. Runtimes that do
 * not serve it (the VS Code webview has no server process) answer with a stable
 * unsupported status, and callers fall back to archiving session by session.
 */

import type { Session } from '@opencode-ai/sdk/v2/client';
import { z } from 'zod';

import { resolveApiUrl } from '@/lib/api/serverUrl';
import { runtimeFetch } from '@/lib/runtime-fetch';

/**
 * The route answers with sessions OpenCode itself returned from
 * `session.update`. Only the identity this layer routes on is asserted here;
 * every other field is carried through to the stores exactly as the server
 * sent it, the same as for any other session response.
 */
const archiveResponseSchema = z.object({
  archived: z.array(z.looseObject({ id: z.string().min(1) })),
  failedIds: z.array(z.string().min(1)),
});

export type SessionArchiveBatchResult =
  | { outcome: 'archived'; archived: Session[]; failedIds: string[] }
  | { outcome: 'unavailable'; reason: string };

export async function requestSessionArchiveBatch(
  directory: string,
  ids: string[],
  archivedAt: number,
  baseUrl?: string,
): Promise<SessionArchiveBatchResult> {
  const body = JSON.stringify({ directory, ids, archivedAt });
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  };

  let response: Response;
  try {
    // The default server participates in the runtime's fetch bridge (auth
    // headers, mobile relay); a remote instance is reached through the
    // remote proxy path directly.
    response = baseUrl
      ? await fetch(resolveApiUrl('/api/openchamber/sessions/archive', baseUrl), init)
      : await runtimeFetch('/api/openchamber/sessions/archive', init);
  } catch (error) {
    return { outcome: 'unavailable', reason: error instanceof Error ? error.message : 'archive request failed' };
  }

  if (!response.ok) {
    return { outcome: 'unavailable', reason: `archive request failed with ${response.status}` };
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch (error) {
    return { outcome: 'unavailable', reason: error instanceof Error ? error.message : 'archive response was not JSON' };
  }

  const parsed = archiveResponseSchema.safeParse(parsedBody);
  if (!parsed.success) {
    // A body this layer cannot read is reported as unavailable rather than as
    // an empty success, so a caller never mistakes "the response made no
    // sense" for "nothing needed archiving" and drops the sessions.
    return { outcome: 'unavailable', reason: `malformed archive response: ${parsed.error.issues[0]?.message ?? 'unknown shape'}` };
  }

  return {
    outcome: 'archived',
    // SAFETY: the schema guarantees the non-empty string `id` this layer keys
    // on; the remaining fields are the server's own session payload.
    archived: parsed.data.archived as Session[],
    failedIds: parsed.data.failedIds,
  };
}

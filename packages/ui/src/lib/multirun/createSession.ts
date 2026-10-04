import { opencodeClient } from '@/lib/opencode/client';
import type { Session } from '@/lib/opencode/client';
import type { Metadata, Session as ModelSession } from '@/lib/opencode/model';
import { getMultiRunMembership, withMultiRunMembership, type MultiRunIdentity } from './identity';

/**
 * Bridge the fork's two Session shapes at the lane boundary. R2 client
 * unification: the client now surfaces the projected model.Session directly,
 * so this is an identity-level cast kept for the call sites that still type
 * records with the legacy wire Session.
 */
export const toModelSession = (session: Session): ModelSession => session as unknown as ModelSession;
export const toClientSession = (session: ModelSession): Session => session as unknown as Session;

/**
 * Fork adaptation of upstream's createMultiRunSession. The fork's client has
 * no `/api/openchamber/sessions/:id/metadata` merge-patch seam yet, so the
 * membership is written through the session update endpoint with the FULL
 * merged envelope (never a bare patch), which keeps the write correct whether
 * the server replaces or merges metadata. Model/agent stay send-time data —
 * the fork dispatches them per lane through its own send path.
 *
 * Bind the server-assigned ID before dispatch. A fork inherits this ID and cannot join.
 */
export async function createMultiRunSession(
  input: {
    title: string;
    directory: string;
    identity: Omit<MultiRunIdentity, 'key'>;
  },
  assertCurrent: () => void,
): Promise<Session> {
  assertCurrent();
  const membership = { ...input.identity, version: 1 as const, sessionID: null };
  const session = await opencodeClient.withDirectory(input.directory, () =>
    opencodeClient.createSession({
      title: input.title,
      metadata: withMultiRunMembership({ metadata: {} as Metadata }, membership) as Metadata,
    }),
  );
  try {
    assertCurrent();
    const boundMetadata = withMultiRunMembership(
      { metadata: session.metadata } as { metadata: Metadata },
      { ...membership, sessionID: session.id },
    ) as Metadata;
    const updated = await opencodeClient.withDirectory(input.directory, () =>
      opencodeClient.updateSession(session.id, undefined, boundMetadata),
    );
    assertCurrent();
    // identity.ts reads only `id` and `metadata` off the session; the fork's
    // client surfaces the SDK v2 Session, whose metadata envelope is the same
    // JSON the membership parser expects.
    if (!getMultiRunMembership({ id: updated.id, metadata: updated.metadata } as Parameters<typeof getMultiRunMembership>[0])) {
      throw new Error('Multi-run membership was not saved');
    }
    return updated;
  } catch (error) {
    // Never delete through a switched runtime. The pending marker remains ineligible.
    assertCurrent();
    try {
      await opencodeClient.withDirectory(input.directory, () => opencodeClient.deleteSession(session.id));
    } catch {
      console.warn('[MultiRun] Could not remove an undispatched session after membership failure');
    }
    throw error;
  }
}

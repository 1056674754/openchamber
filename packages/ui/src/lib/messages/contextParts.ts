/**
 * Structured context attached to an outgoing message.
 *
 * Minimal envelope port (upstream v1.22.2 orphan port): the server-side message
 * queue carries attached context as synthetic text parts whose
 * `metadata[CONTEXT_METADATA_KEY]` holds the UI's structured payload, and the
 * queue store validates that envelope on the way back. The full payload
 * taxonomy (code comments, terminal selections, PR/issue attachments) and the
 * composer-side builders land with the composer port; until then the payload
 * is an opaque record with a `kind` discriminator, and read-back validation
 * stays permissive.
 */

import { z } from 'zod';

export const CONTEXT_METADATA_KEY = 'openchamberContext';

export type ContextPartPayload = { kind: string } & Record<string, unknown>;

export type ContextPartMetadata = { [CONTEXT_METADATA_KEY]: ContextPartPayload };

/** Payload kinds the upstream taxonomy defines; fields stay loosely validated. */
const CONTEXT_PAYLOAD_KINDS = [
    'code-comment',
    'terminal',
    'browser-annotation',
    'pr-comment',
    'pr-check',
    'file-quote',
    'chat-quote',
    'github-issue',
    'github-pr',
    'linear-issue',
] as const;

export const contextPartMetadataSchema = z.object({
    [CONTEXT_METADATA_KEY]: z.object({ kind: z.enum(CONTEXT_PAYLOAD_KINDS) }).catchall(z.unknown()),
});

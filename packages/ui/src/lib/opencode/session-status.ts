import { z } from "zod";

// Requests the host forwards verbatim from OpenCode's ask events; the shapes
// mirror `@/types/permission` and `@/types/form` so a parsed entry is one
// (the wire keeps the v1 `question` payload field names).
const toolReferenceSchema = z.object({ messageID: z.string(), callID: z.string() }).optional()
const hostPermissionRequestSchema = z.object({
  id: z.string().min(1),
  sessionID: z.string().min(1),
  permission: z.string(),
  patterns: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  always: z.array(z.string()),
  tool: toolReferenceSchema,
})
const hostFormRequestSchema = z.object({
  id: z.string().min(1),
  sessionID: z.string().min(1),
  questions: z.array(z.object({
    question: z.string(),
    header: z.string(),
    options: z.array(z.object({ label: z.string(), description: z.string() })),
    multiple: z.boolean().optional(),
  })),
  tool: toolReferenceSchema,
})

// Cross-project status kept by the OpenChamber host (web server) from its
// single upstream event stream. Entries carry the host's own clock so
// staleness is judged against `serverTime`, not the client.
export const hostSessionStatusSnapshotSchema = z.object({
  sessions: z.record(z.string().min(1), z.object({
    status: z.string(),
    lastUpdateAt: z.number(),
  })),
  // Permission and question requests the host still sees unanswered, keyed by
  // session. Optional: hosts predating the field omit it.
  pending: z.record(z.string().min(1), z.object({
    permissions: z.array(hostPermissionRequestSchema),
    questions: z.array(hostFormRequestSchema),
  })).optional(),
  serverTime: z.number(),
})

export type HostSessionStatusSnapshot = z.infer<typeof hostSessionStatusSnapshotSchema>
export type HostPermissionRequest = z.infer<typeof hostPermissionRequestSchema>
export type HostFormRequest = z.infer<typeof hostFormRequestSchema>

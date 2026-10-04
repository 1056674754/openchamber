import { z } from "zod";

// Requests the host forwards verbatim from OpenCode's ask events; the shapes
// mirror `@/types/permission` and `@/types/form` so a parsed entry is one
// (the wire keeps the v1 `question` payload field names).
//
// OC2 spine S6: on a v2 upstream the host's tracker stores the translated
// ask properties (`action`/`resources`/`save` — see the server's
// translate-v2), so the schema tolerates both namings instead of dropping the
// whole snapshot on a strict v1 field.
const toolReferenceSchema = z.object({ messageID: z.string(), callID: z.string() }).optional()
const hostPermissionRequestSchema = z.object({
  id: z.string().min(1),
  sessionID: z.string().min(1),
  permission: z.string().optional(),
  patterns: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  always: z.array(z.string()).optional(),
  // v2 ask naming (translate-v2), carried for the surfaces that read it.
  action: z.string().optional(),
  resources: z.array(z.string()).optional(),
  save: z.array(z.string()).optional(),
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
  })).optional(),
  tool: toolReferenceSchema,
}).passthrough()

// Cross-project status kept by the OpenChamber host (web server) from its
// single upstream event stream. Entries carry the host's own clock so
// staleness is judged against `serverTime`, not the client.
export const hostSessionStatusSnapshotSchema = z.object({
  sessions: z.record(z.string().min(1), z.object({
    status: z.string(),
    lastUpdateAt: z.number(),
  })),
  // Permission and question requests the host still sees unanswered, keyed by
  // session. Optional: hosts predating the field omit it. `forms` is the v2
  // ask naming the host tracks on a v2 upstream (`form.created`/`form.settled`);
  // v1 hosts never emit it.
  pending: z.record(z.string().min(1), z.object({
    permissions: z.array(hostPermissionRequestSchema),
    questions: z.array(hostFormRequestSchema),
    forms: z.array(hostFormRequestSchema).optional(),
  })).optional(),
  serverTime: z.number(),
})

export type HostSessionStatusSnapshot = z.infer<typeof hostSessionStatusSnapshotSchema>
export type HostPermissionRequest = z.infer<typeof hostPermissionRequestSchema>
export type HostFormRequest = z.infer<typeof hostFormRequestSchema>

// v2 reports active loops globally (session.active). A malformed response
// cannot prove idle. (Fork port of the upstream session-status schema.)
export const activeSessionSnapshotSchema = z.record(z.string().min(1), z.object({ type: z.literal("running") }))

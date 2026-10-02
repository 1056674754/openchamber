import { z } from 'zod';

export type ScheduledTaskRanEvent = {
  type: 'scheduled-task-ran';
  projectId: string;
  taskId: string;
  ranAt: number;
  status: 'running' | 'success' | 'error';
  sessionId?: string;
};

/** Jev routing events; each carries what the routing store needs and nothing the UI must re-derive. */
const routingUpdatedSchema = z.object({
  available: z.boolean(),
  autoReady: z.boolean(),
  // Servers from before the classifier pick never send this; absent keeps the
  // last known value rather than reading as "no provider".
  jevAvailable: z.boolean().optional(),
  tokenPresent: z.boolean(),
  jevSource: z.enum(['typesafe', 'zen-free']).optional(),
});

const routingDecisionSchema = z.object({
  sessionId: z.string().min(1),
  at: z.number(),
  category: z.string().nullable(),
  confidence: z.number(),
  reason: z.enum(['routed', 'low-confidence', 'unknown-category', 'error', 'not-ready']),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  variant: z.string().nullable().optional(),
  agent: z.string().nullable().optional(),
  error: z.string().optional(),
});

const routingPermissionHeldSchema = z.object({
  permissionId: z.string().min(1),
  sessionId: z.string().min(1),
  score: z.number(),
  kind: z.string().nullable(),
  directory: z.string().nullable().optional(),
});

const routingSafetySkippedSchema = z.object({
  permissionId: z.string().min(1),
  sessionId: z.string().min(1),
  error: z.string(),
  directory: z.string().nullable().optional(),
});

type RoutingUpdatedEvent = { type: 'routing-updated' } & z.infer<typeof routingUpdatedSchema>;
type RoutingDecisionEvent = { type: 'routing-decision'; decision: z.infer<typeof routingDecisionSchema> };
type RoutingPermissionHeldEvent = { type: 'routing-permission-held' } & z.infer<typeof routingPermissionHeldSchema>;
type RoutingSafetySkippedEvent = { type: 'routing-safety-skipped' } & z.infer<typeof routingSafetySkippedSchema>;

/**
 * The agent asked for a file to be shown in the user's file panel. Every
 * client receives it; one showing that project opens the file.
 */
const fileOpenRequestSchema = z.object({
  path: z.string().min(1),
  directory: z.string().min(1).nullable(),
  sessionId: z.string().min(1).nullable(),
});
type FileOpenRequestEvent = { type: 'file-open-request' } & z.infer<typeof fileOpenRequestSchema>;

type OpenChamberEvent = ScheduledTaskRanEvent | RoutingUpdatedEvent | RoutingDecisionEvent | RoutingPermissionHeldEvent | RoutingSafetySkippedEvent | FileOpenRequestEvent;
type Listener = (event: OpenChamberEvent) => void;
export type OpenChamberEventEnvelope = {
  readonly type?: unknown;
  readonly properties?: unknown;
  readonly serverId?: string;
};
type Envelope = OpenChamberEventEnvelope;
type EnvelopeListener = (event: Envelope) => void;

const listeners = new Set<Listener>();
const envelopeListeners = new Set<EnvelopeListener>();

const normalizeEnvelope = (raw: Envelope): { type: string; properties: unknown; serverId?: string } | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const type = typeof raw.type === 'string' ? raw.type : '';
  if (!type) {
    return null;
  }

  return {
    type,
    properties: raw.properties,
    ...(typeof raw.serverId === 'string' ? { serverId: raw.serverId } : {}),
  };
};

const dispatchFromEnvelope = (envelope: { type: string; properties: unknown }) => {
  if (envelope.type === 'openchamber:event-stream-ready') {
    return;
  }

  if (envelope.type === 'openchamber:heartbeat') {
    return;
  }

  if (envelope.type === 'openchamber:routing.updated') {
    const parsed = routingUpdatedSchema.safeParse(envelope.properties);
    if (parsed.success) for (const listener of listeners) listener({ type: 'routing-updated', ...parsed.data });
    return;
  }

  if (envelope.type === 'openchamber:routing.decision') {
    const parsed = routingDecisionSchema.safeParse(envelope.properties);
    if (parsed.success) for (const listener of listeners) listener({ type: 'routing-decision', decision: parsed.data });
    return;
  }

  if (envelope.type === 'openchamber:routing.permission-held') {
    const parsed = routingPermissionHeldSchema.safeParse(envelope.properties);
    if (parsed.success) for (const listener of listeners) listener({ type: 'routing-permission-held', ...parsed.data });
    return;
  }

  if (envelope.type === 'openchamber:routing.safety-skipped') {
    const parsed = routingSafetySkippedSchema.safeParse(envelope.properties);
    if (parsed.success) for (const listener of listeners) listener({ type: 'routing-safety-skipped', ...parsed.data });
    return;
  }

  if (envelope.type === 'openchamber:file-open-request') {
    const parsed = fileOpenRequestSchema.safeParse(envelope.properties);
    if (parsed.success) for (const listener of listeners) listener({ type: 'file-open-request', ...parsed.data });
    return;
  }

  if (envelope.type !== 'openchamber:scheduled-task-ran') {
    return;
  }

  const parsed = envelope.properties && typeof envelope.properties === 'object'
    ? envelope.properties as Record<string, unknown>
    : null;
  const projectId = typeof parsed?.projectId === 'string' ? parsed.projectId : '';
  const taskId = typeof parsed?.taskId === 'string' ? parsed.taskId : '';
  const ranAt = typeof parsed?.ranAt === 'number' ? parsed.ranAt : Date.now();
  const rawStatus = parsed?.status;
  const status = rawStatus === 'running' || rawStatus === 'error' ? rawStatus : 'success';
  if (!projectId || !taskId) {
    return;
  }

  const nextEvent: ScheduledTaskRanEvent = {
    type: 'scheduled-task-ran',
    projectId,
    taskId,
    ranAt,
    status,
    ...(typeof parsed?.sessionId === 'string' && parsed.sessionId.length > 0 ? { sessionId: parsed.sessionId } : {}),
  };
  for (const listener of listeners) {
    listener(nextEvent);
  }
};

export const dispatchOpenchamberEventEnvelope = (raw: Envelope, serverId?: string) => {
  const routed = serverId ? { ...raw, serverId } : raw;
  const envelope = normalizeEnvelope(routed);
  if (!envelope) {
    return;
  }

  for (const listener of envelopeListeners) {
    listener(envelope);
  }
  dispatchFromEnvelope(envelope);
};

export const subscribeOpenchamberEventEnvelopes = (listener: EnvelopeListener): (() => void) => {
  envelopeListeners.add(listener);
  return () => {
    envelopeListeners.delete(listener);
  };
};

export const subscribeOpenchamberEvents = (listener: Listener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

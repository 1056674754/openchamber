export type ScheduledTaskRanEvent = {
  type: 'scheduled-task-ran';
  projectId: string;
  taskId: string;
  ranAt: number;
  status: 'running' | 'success' | 'error';
  sessionId?: string;
};

type OpenChamberEvent = ScheduledTaskRanEvent;
type Listener = (event: OpenChamberEvent) => void;
type Envelope = { type?: unknown; properties?: unknown };
type EnvelopeListener = (event: Envelope) => void;

const listeners = new Set<Listener>();
const envelopeListeners = new Set<EnvelopeListener>();

const normalizeEnvelope = (raw: Envelope): { type: string; properties: unknown } | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const type = typeof raw.type === 'string' ? raw.type : '';
  if (!type) {
    return null;
  }

  return { type, properties: raw.properties };
};

const dispatchFromEnvelope = (envelope: { type: string; properties: unknown }) => {
  if (envelope.type === 'openchamber:event-stream-ready') {
    return;
  }

  if (envelope.type === 'openchamber:heartbeat') {
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

export const dispatchOpenchamberEventEnvelope = (raw: Envelope) => {
  const envelope = normalizeEnvelope(raw);
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

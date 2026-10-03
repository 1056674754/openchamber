/**
 * Shared v2 → v1 message-record view (OC2 spine follow-up).
 *
 * OpenCode 2 message reads answer a different wire shape than the fork's v1
 * callers consume:
 * - lists are `{ data: [...], cursor }` pages, not bare arrays;
 * - records are FLAT (`{ id, type: 'user'|'assistant'|'compaction'|..., text
 *   |content, time }` — no `sessionID`, `model` as `Model.Ref` `{providerID,
 *   id, variant}`) where v1 rows are `{ info, parts }`.
 *
 * `readMessageRecords` / `readMessageRecord` accept either track's answer and
 * return the v1 view. v1 rows pass through by reference, so the v1 track's
 * parsed shapes are unchanged; v2 rows are mapped like upstream v2.1.0's
 * `toLoopMessage` (synthetic folds into the user role, a completed compaction
 * plays the `summary: true` assistant turn, marker roles the v1 view has no
 * equivalent for are dropped). `unwrapOpenCodeEnvelope` splits the
 * single-record `{ data }` wrapper; a page keeps its envelope so callers can
 * still read its cursor (mirrors upstream `unwrapOpenCodeResponse`).
 */

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

const normalizeTime = (time) => (asRecord(time) ? { ...time } : {});

const modelRefOf = (model) => {
  const record = asRecord(model);
  const providerID = typeof record?.providerID === 'string' ? record.providerID : '';
  const modelID = typeof record?.id === 'string' ? record.id : '';
  return providerID && modelID
    ? {
      providerID,
      modelID,
      ...(typeof record.variant === 'string' && record.variant ? { variant: record.variant } : {}),
    }
    : null;
};

/** One OC2 flat record → the v1 `{ info, parts }` row; v1 rows pass through. */
export const normalizeMessageRecord = (record) => {
  const source = asRecord(record);
  if (!source) return null;
  // v1 rows already carry the consumer view; pass them through untouched.
  if (asRecord(source.info)) return source;
  const type = typeof source.type === 'string' ? source.type : '';
  // Not a v2 flat record (a loose partial row, e.g. `{ parts }`): pass it
  // through raw — only unambiguous v2 records (type + id) are converted.
  if (!type) return source;
  if (typeof source.id !== 'string' || !source.id) return null;
  const base = {
    id: source.id,
    ...(typeof source.sessionID === 'string' ? { sessionID: source.sessionID } : {}),
    time: normalizeTime(source.time),
  };
  if (type === 'user' || type === 'synthetic') {
    // v2 keeps synthetic pre-text in its own role; v1 consumers read it as a
    // trailing user message (upstream toLoopMessage folds it the same way).
    return {
      info: { ...base, role: 'user' },
      parts: typeof source.text === 'string' && source.text ? [{ type: 'text', text: source.text }] : [],
    };
  }
  if (type === 'assistant') {
    const model = modelRefOf(source.model);
    // v1 errors carried `name`; v2's structured error calls it `type`.
    const errorSource = asRecord(source.error);
    const info = {
      ...base,
      role: 'assistant',
      summary: false,
      ...(typeof source.agent === 'string' && source.agent ? { agent: source.agent } : {}),
      ...(model ? {
        providerID: model.providerID,
        modelID: model.modelID,
        model,
        ...(model.variant ? { variant: model.variant } : {}),
      } : {}),
      ...(typeof source.finish === 'string' && source.finish ? { finish: source.finish } : {}),
      ...(asRecord(source.tokens) ? { tokens: source.tokens } : {}),
      ...(errorSource ? { error: { name: errorSource.type, ...errorSource } } : {}),
    };
    const parts = (Array.isArray(source.content) ? source.content : [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string' && part.text)
      .map((part) => ({ type: 'text', text: part.text }));
    return { info, parts };
  }
  if (type === 'compaction') {
    // A finished compaction plays v1's `summary: true` assistant turn; running
    // or failed compactions are dropped (upstream toLoopMessage).
    if (source.status !== 'completed') return null;
    return {
      info: {
        ...base,
        time: { ...base.time, completed: base.time.completed ?? base.time.created },
        role: 'assistant',
        summary: true,
        finish: 'stop',
        ...(asRecord(source.tokens) ? { tokens: source.tokens } : {}),
      },
      parts: typeof source.summary === 'string' && source.summary ? [{ type: 'text', text: source.summary }] : [],
    };
  }
  // Marker roles (system, skill, shell, idle, *-switched) have no v1
  // equivalent; consumers filter by role and never saw them on v1 either.
  return null;
};

/**
 * One message-list response → the v1 `{ info, parts }` array. Accepts the v2
 * `{ data, cursor }` page, a bare v2/v1 array, or the SDK's `{ data }` result;
 * null when the payload holds no list.
 */
export const readMessageRecords = (payload) => {
  const body = asRecord(payload) && Array.isArray(payload.data) ? payload.data : payload;
  if (!Array.isArray(body)) return null;
  const records = [];
  for (const item of body) {
    const normalized = normalizeMessageRecord(item);
    if (normalized) records.push(normalized);
  }
  return records;
};

/**
 * `{ data }` single-record envelope splitter (mirrors upstream
 * `unwrapOpenCodeResponse`): a page keeps its envelope because callers read
 * its cursor; everything else passes through.
 */
export const unwrapOpenCodeEnvelope = (payload) => {
  if (!asRecord(payload)) return payload;
  return 'data' in payload && !('cursor' in payload) ? payload.data : payload;
};

/** One single-message response (`GET .../message/:id`) → the v1 row or null. */
export const readMessageRecord = (payload) => normalizeMessageRecord(unwrapOpenCodeEnvelope(payload));

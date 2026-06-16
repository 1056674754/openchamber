import fs from 'fs';
import os from 'os';
import path from 'node:path';
import assert from 'node:assert';
import {
  createSessionMarkersStore,
  SessionMarkersValidationError,
} from '../packages/web/server/lib/opencode/session-markers-store.js';

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok -', label); };
const fail = (label, err) => { console.error('  FAIL -', label, err?.message || err); process.exitCode = 1; };

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markers-smoke-'));
console.log('tmpDir:', tmpDir);

const events = [];
const store = createSessionMarkersStore({
  fs,
  path,
  dataDir: tmpDir,
  onChange: (e) => events.push(e),
});

// ---------- load (empty) ----------
store.load();
assert.equal(store.getSnapshot().version, 1);
assert.deepEqual(store.getSnapshot().sessions, {});
ok('load() on empty dir yields version=1, empty sessions');

// getMarkers returns null only for non-string/falsy sessionId; valid unknown string -> {todos:[]}.
assert.deepEqual(store.getMarkers('unknown'), { todos: [] });
ok('getMarkers(unknown string) returns {todos:[]}');

assert.equal(store.getMarkers(null), null);
assert.equal(store.getMarkers(123), null);
ok('getMarkers(non-string) returns null');

// ---------- applyPatch: status ----------
events.length = 0;
const m1 = store.applyPatch('s1', { status: 'draft' });
assert.equal(m1.status, 'draft');
assert.deepEqual(m1.todos, []);
assert.equal(events.length, 1);
assert.equal(events[0].sessionId, 's1');
assert.equal(events[0].markers.status, 'draft');
ok('applyPatch status=draft sets + broadcasts');

// ---------- applyPatch: todos (dedupe) ----------
events.length = 0;
// 2 elements with a dup -> validates (length 2 OK) then dedupes to 1
const m2 = store.applyPatch('s1', { todos: ['uncommitted', 'uncommitted'] });
assert.deepEqual(m2.todos, ['uncommitted']); // dedupe
assert.equal(m2.status, 'draft'); // preserved
ok('applyPatch todos dedupes and preserves other fields');

// ---------- applyPatch: todos replace (not merge) ----------
const m2b = store.applyPatch('s1', { todos: ['untested'] });
assert.deepEqual(m2b.todos, ['untested']); // replaced, not merged with prior
ok('applyPatch todos replaces (does not merge)');

// ---------- applyPatch: todos cap at MAX_TODO_MARKERS via validation (rejected before dedupe) ----------
events.length = 0;
try {
  store.applyPatch('s1', { todos: ['uncommitted', 'untested', 'needs-review'] });
  fail('should have thrown for > MAX_TODO_MARKERS');
} catch (e) {
  assert.ok(e instanceof SessionMarkersValidationError);
  ok('applyPatch rejects todos.length > MAX_TODO_MARKERS (2) — before dedupe');
}

// ---------- applyPatch: invalid todo value ----------
try {
  store.applyPatch('s1', { todos: ['bogus'] });
  fail('should have thrown for invalid todo');
} catch (e) {
  assert.ok(e instanceof SessionMarkersValidationError);
  ok('applyPatch rejects invalid todo value');
}

// ---------- applyPatch: invalid status ----------
try {
  store.applyPatch('s1', { status: 'bogus' });
  fail('should have thrown for invalid status');
} catch (e) {
  assert.ok(e instanceof SessionMarkersValidationError);
  ok('applyPatch rejects invalid status value');
}

// ---------- applyPatch: important true ----------
events.length = 0;
const m3 = store.applyPatch('s1', { important: true });
assert.equal(m3.important, true);
assert.equal(events.length, 1);
ok('applyPatch important=true sets + broadcasts');

// ---------- applyPatch: important null clears ----------
events.length = 0;
const m4 = store.applyPatch('s1', { important: null });
assert.equal('important' in m4, false);
assert.equal(events.length, 1);
ok('applyPatch important=null clears + broadcasts');

// ---------- applyPatch: important false clears (matches JSON semantics) ----------
events.length = 0;
store.applyPatch('s1', { important: true });
const m5 = store.applyPatch('s1', { important: false });
assert.equal('important' in m5, false);
ok('applyPatch important=false clears');

// ---------- applyPatch: status null clears ----------
events.length = 0;
const m6 = store.applyPatch('s1', { status: null });
assert.equal('status' in m6, false);
ok('applyPatch status=null clears');

// ---------- applyPatch: undefined leaves unchanged ----------
events.length = 0;
store.applyPatch('s1', { status: 'done' });
const m7 = store.applyPatch('s1', {});
assert.equal(m7.status, 'done');
ok('applyPatch empty patch leaves fields unchanged');

// ---------- applyPatch: non-object patch rejected ----------
try {
  store.applyPatch('s1', null);
  fail('should reject null patch');
} catch (e) {
  assert.ok(e instanceof SessionMarkersValidationError);
  ok('applyPatch rejects null patch');
}
try {
  store.applyPatch('s1', 'string');
  fail('should reject string patch');
} catch (e) {
  assert.ok(e instanceof SessionMarkersValidationError);
  ok('applyPatch rejects string patch');
}
try {
  store.applyPatch('s1', []);
  fail('should reject array patch');
} catch (e) {
  assert.ok(e instanceof SessionMarkersValidationError);
  ok('applyPatch rejects array patch');
}

// ---------- applyPatch: non-string sessionId ----------
events.length = 0;
const m8 = store.applyPatch(null, { status: 'done' });
assert.deepEqual(m8, { todos: [] });
assert.equal(events.length, 0); // no broadcast for invalid sessionId
ok('applyPatch(invalid sessionId) returns {todos:[]} without broadcast');

// ---------- important must be boolean or null ----------
try {
  store.applyPatch('s1', { important: 'yes' });
  fail('should reject string important');
} catch (e) {
  assert.ok(e instanceof SessionMarkersValidationError);
  ok('applyPatch rejects non-boolean important');
}

// ---------- getSnapshot reflects current state ----------
const snap = store.getSnapshot();
assert.ok(snap.sessions.s1);
ok('getSnapshot includes session');

// ---------- clear: existing session ----------
events.length = 0;
const cleared = store.clear('s1');
assert.equal(cleared, true);
// Source: getMarkers returns null only for non-string sessionId. For valid string
// with no entry, returns {todos:[]}.
assert.deepEqual(store.getMarkers('s1'), { todos: [] });
assert.equal(events.length, 1);
assert.equal(events[0].sessionId, 's1');
assert.equal(events[0].markers, null);
ok('clear(existing) deletes in-memory + broadcasts null');

// ---------- clear: idempotent (unknown session still broadcasts null) ----------
events.length = 0;
const cleared2 = store.clear('never-existed');
assert.equal(cleared2, true);
assert.equal(events.length, 1);
assert.equal(events[0].markers, null);
ok('clear(unknown) is idempotent and still broadcasts null');

// ---------- clear: invalid sessionId ----------
events.length = 0;
const cleared3 = store.clear(null);
assert.equal(cleared3, false);
assert.equal(events.length, 0);
ok('clear(invalid) returns false, no broadcast');

// ---------- persistence: write, dispose, reload ----------
store.applyPatch('persist-1', { status: 'in-progress', todos: ['uncommitted'], important: true });
store.applyPatch('persist-2', { status: 'done', important: true });
store.dispose();

const events2 = [];
const store2 = createSessionMarkersStore({
  fs,
  path,
  dataDir: tmpDir,
  onChange: (e) => events2.push(e),
});
store2.load();
const snap2 = store2.getSnapshot();
assert.equal(snap2.sessions['persist-1'].status, 'in-progress');
assert.deepEqual(snap2.sessions['persist-1'].todos, ['uncommitted']);
assert.equal(snap2.sessions['persist-1'].important, true);
assert.equal(snap2.sessions['persist-2'].status, 'done');
assert.equal(snap2.sessions['persist-2'].important, true);
// cleared session should NOT be in snapshot
assert.equal(snap2.sessions['s1'], undefined);
ok('persistence: state survives dispose + reload from same db file');

// ---------- cleared row should not reappear ----------
// 's1' was cleared before dispose; ensure it's not in the DB.
assert.equal(snap2.sessions['s1'], undefined);
ok('cleared session does not reappear after reload');

// ---------- db file exists at expected path ----------
const dbFile = path.join(tmpDir, 'openchamber-sessions.db');
assert.ok(fs.existsSync(dbFile), 'db file should exist');
ok('DB file created at <dataDir>/openchamber-sessions.db');

// ---------- flush is a no-op but exists ----------
assert.doesNotThrow(() => store2.flush());
ok('flush() is a no-op, does not throw');

// ---------- dispose is idempotent ----------
store2.dispose();
assert.doesNotThrow(() => store2.dispose());
ok('dispose() is idempotent');

store2.dispose();

console.log(`\nALL ASSERTIONS PASSED: ${passed}`);
console.log('(temp dir left in place for inspection:', tmpDir, ')');

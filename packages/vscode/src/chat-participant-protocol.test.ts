import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AssistantTextStream,
  SseDataParser,
  composePromptText,
  formatReferenceForPrompt,
  readIdleSessionId,
} from './chat-participant-protocol';

describe('SseDataParser', () => {
  test('reassembles events split across arbitrary chunk boundaries', () => {
    const parser = new SseDataParser();
    assert.deepEqual(parser.feed('data: {"type":"a"}\n'), ['{"type":"a"}']);
    assert.deepEqual(parser.feed('data: {"type":"b"'), []);
    assert.deepEqual(parser.feed(',"x":1}\r\n: keepalive\ndata: {"type":"c"}\n\n'), ['{"type":"b","x":1}', '{"type":"c"}']);
    assert.deepEqual(parser.flush(), []);
  });

  test('flush emits a trailing unterminated data line', () => {
    const parser = new SseDataParser();
    assert.deepEqual(parser.feed('data: tail'), []);
    assert.deepEqual(parser.flush(), ['tail']);
  });
});

describe('composePromptText', () => {
  test('appends string references as attached context', () => {
    const out = composePromptText('fix this', [{ id: 'element-1', value: '<div class="hero">…</div>' }]);
    assert.match(out, /^fix this/);
    assert.match(out, /<div class="hero">…<\/div>/);
    assert.match(out, /Attached context/);
  });

  test('context-only requests still produce a prompt', () => {
    const out = composePromptText('', [{ id: 'e', value: '<button>Go</button>' }]);
    assert.match(out, /<button>Go<\/button>/);
    assert.ok(out.length > '<button>Go</button>'.length);
  });

  test('uri-like references become paths and junk values are dropped', () => {
    assert.equal(formatReferenceForPrompt({ value: { scheme: 'file', fsPath: '/a/b.ts' } }), '`/a/b.ts`');
    assert.equal(formatReferenceForPrompt({ value: '' }), null);
    assert.equal(formatReferenceForPrompt({ value: {} }), null);
    const out = composePromptText('hi', [{ value: { fsPath: '/a/b.ts' } }, { value: '   ' }]);
    assert.match(out, /`\/a\/b\.ts`/);
    assert.doesNotMatch(out, /Attached[\s\S]*Attached/);
  });
});

describe('AssistantTextStream', () => {
  test('streams assistant parts only, via updates and deltas, scoped to the session', () => {
    const stream = new AssistantTextStream();
    const sid = 'sess-1';
    // User message text must never stream out.
    stream.noteMessage({ type: 'message.updated', properties: { info: { id: 'm-user', role: 'user' } } });
    assert.equal(
      stream.feed({ type: 'message.part.updated', properties: { sessionID: sid, part: { id: 'pu', messageID: 'm-user', type: 'text', text: 'my prompt' } } }, sid),
      null,
    );
    stream.noteMessage({ type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } });
    assert.equal(
      stream.feed({ type: 'message.part.updated', properties: { sessionID: sid, part: { id: 'p1', messageID: 'm1', type: 'text', text: 'Hello' } } }, sid),
      'Hello',
    );
    assert.equal(
      stream.feed({ type: 'message.part.updated', properties: { sessionID: sid, part: { id: 'p1', messageID: 'm1', type: 'text', text: 'Hello, world' } } }, sid),
      ', world',
    );
    assert.equal(
      stream.feed({ type: 'message.part.delta', properties: { sessionID: sid, messageID: 'm1', partID: 'p1', field: 'text', delta: '!' } }, sid),
      '!',
    );
    // Foreign session parts and non-text parts are ignored.
    assert.equal(
      stream.feed({ type: 'message.part.updated', properties: { sessionID: 'other', part: { id: 'pX', messageID: 'm1', type: 'text', text: 'nope' } } }, sid),
      null,
    );
    assert.equal(
      stream.feed({ type: 'message.part.updated', properties: { sessionID: sid, part: { id: 'p2', messageID: 'm1', type: 'step-start' } } }, sid),
      null,
    );
    // Parts for messages with unknown role are dropped until the role is known.
    assert.equal(
      stream.feed({ type: 'message.part.updated', properties: { sessionID: sid, part: { id: 'p3', messageID: 'm-unknown', type: 'text', text: '?' } } }, sid),
      null,
    );
    // Idempotent updates emit nothing.
    assert.equal(
      stream.feed({ type: 'message.part.updated', properties: { sessionID: sid, part: { id: 'p1', messageID: 'm1', type: 'text', text: 'Hello, world!' } } }, sid),
      null,
    );
    assert.equal(stream.hasOutput, true);
  });

  test('readIdleSessionId only matches session.idle with a session id', () => {
    assert.equal(readIdleSessionId({ type: 'session.idle', properties: { sessionID: 's' } }), 's');
    assert.equal(readIdleSessionId({ type: 'message.updated', properties: { sessionID: 's' } }), null);
    assert.equal(readIdleSessionId({ type: 'session.idle', properties: {} }), null);
  });
});

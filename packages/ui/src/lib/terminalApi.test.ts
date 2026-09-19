import { describe, expect, test } from "bun:test";

import type { TerminalStreamEvent } from "./api/types";
import { isRemoteTerminalProxyBaseUrl, TerminalTransport } from "./terminalApi";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeSocket {
  readyState = 0;
  binaryType: BinaryType = 'arraybuffer';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  send(value: ArrayBufferView): void {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.sent.push(JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.(new Event('close'));
  }
}

describe("isRemoteTerminalProxyBaseUrl", () => {
  test("detects local remote proxy API bases", () => {
    expect(isRemoteTerminalProxyBaseUrl("/api/remote/ssh-1")).toBe(true);
    expect(isRemoteTerminalProxyBaseUrl("/api/remote/ssh-1/")).toBe(true);
    expect(isRemoteTerminalProxyBaseUrl("http://127.0.0.1:45173/api/remote/ssh-1")).toBe(true);
  });

  test("does not treat direct API bases as remote proxy bases", () => {
    expect(isRemoteTerminalProxyBaseUrl(undefined)).toBe(false);
    expect(isRemoteTerminalProxyBaseUrl("/api")).toBe(false);
    expect(isRemoteTerminalProxyBaseUrl("http://127.0.0.1:3000/api")).toBe(false);
    expect(isRemoteTerminalProxyBaseUrl("http://remote-host:3000")).toBe(false);
  });
});

describe('TerminalTransport', () => {
  test('reuses the open socket while switching terminal tabs', async () => {
    const sockets: FakeSocket[] = [];
    const transport = new TerminalTransport('http://127.0.0.1:3000', () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });

    const unsubscribe = transport.subscribe('term-1', { onEvent: () => {} });
    await tick();
    sockets[0].open();
    await tick();

    unsubscribe();
    transport.subscribe('term-2', { onEvent: () => {} });
    await tick();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent.some((message) => message.t === 'detach' && message.s === 'term-1')).toBe(true);
    expect(sockets[0].sent.some((message) => message.t === 'attach' && message.s === 'term-2')).toBe(true);
    transport.dispose();
  });

  test('carries the PTY size through snapshot projections and accepted resizes', async () => {
    const socket = new FakeSocket();
    const transport = new TerminalTransport('http://127.0.0.1:3000', () => socket as unknown as WebSocket);
    const events: TerminalStreamEvent[] = [];

    const unsubscribe = transport.subscribe('term-size', { onEvent: (event) => events.push(event) });
    await tick();
    socket.open();
    await tick();

    const frame = (message: Record<string, unknown>): ArrayBuffer => {
      const payload = new TextEncoder().encode(JSON.stringify(message));
      const bytes = new Uint8Array(payload.length + 1);
      bytes[0] = 1;
      bytes.set(payload, 1);
      return bytes.buffer;
    };

    socket.onmessage?.({ data: frame({ t: 'snapshot', v: 3, s: 'term-size', q: 0, history: '', cols: 94, rows: 56, status: 'running' }) } as MessageEvent);
    await tick();

    const snapshot = events.find((event) => event.type === 'snapshot');
    expect(snapshot?.cols).toBe(94);
    expect(snapshot?.rows).toBe(56);

    // A resize the server accepts updates the projection, so a later
    // subscriber (tab switch, remount) still learns the current PTY size.
    transport.noteResize('term-size', 120, 40);
    const replayEvents: TerminalStreamEvent[] = [];
    transport.subscribe('term-size', { onEvent: (event) => replayEvents.push(event) });
    await tick();

    const replay = replayEvents.find((event) => event.type === 'snapshot');
    expect(replay?.cols).toBe(120);
    expect(replay?.rows).toBe(40);
    unsubscribe();
    transport.dispose();
  });
});

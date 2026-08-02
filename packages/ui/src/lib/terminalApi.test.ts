import { describe, expect, test } from "bun:test";

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
});

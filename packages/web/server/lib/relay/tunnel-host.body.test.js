import { describe, expect, test } from 'bun:test';
import http from 'node:http';

import { createTunnelHost } from './tunnel-host.js';
import {
  decodeTunnelFrame,
  encodeJsonPayload,
  encodeTunnelFrame,
  TunnelFrameType,
} from './tunnel-codec.js';

const startLoopback = () => new Promise((resolve) => {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: req.method, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    requests,
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  }));
});

const createHarness = async (overrides = {}) => {
  const loopback = await startLoopback();
  const sentFrames = [];
  const host = createTunnelHost({
    connectionId: 'body-test',
    getLocalPort: () => loopback.port,
    sendFrame: async (frame) => sentFrames.push(decodeTunnelFrame(frame)),
    getBufferedAmount: () => 0,
    ...overrides,
  });
  return { host, loopback, sentFrames };
};

const requestHead = (overrides = {}) => encodeTunnelFrame(
  TunnelFrameType.HttpRequest,
  1,
  encodeJsonPayload({
    method: 'POST',
    path: '/api/submit',
    query: '',
    headers: { 'content-type': 'application/json' },
    ...overrides,
  }),
);

const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
};

describe('relay tunnel request body delivery', () => {
  test('buffers small bodies and forwards only the complete bytes', async () => {
    const { host, loopback } = await createHarness();
    await host.handleFrame(requestHead({ hasBody: true }));
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.HttpBody, 1, new TextEncoder().encode('alpha')));
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.HttpBody, 1, new TextEncoder().encode('beta')));
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.StreamEnd, 1, new Uint8Array()));

    expect(await waitFor(() => loopback.requests.length === 1)).toBe(true);
    expect(loopback.requests[0]).toEqual({ method: 'POST', body: 'alphabeta' });
    await loopback.stop();
  });

  test('aborts an expected body with no delivered body frame', async () => {
    const { host, loopback, sentFrames } = await createHarness();
    await host.handleFrame(requestHead({ hasBody: true }));
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.StreamEnd, 1, new Uint8Array()));

    expect(await waitFor(() => sentFrames.some((frame) => frame.frameType === TunnelFrameType.StreamAbort))).toBe(true);
    expect(loopback.requests).toEqual([]);
    await loopback.stop();
  });

  test('keeps legacy/bodyless POST compatibility', async () => {
    const { host, loopback } = await createHarness();
    await host.handleFrame(requestHead());
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.StreamEnd, 1, new Uint8Array()));

    expect(await waitFor(() => loopback.requests.length === 1)).toBe(true);
    expect(loopback.requests[0]?.body).toBe('');
    await loopback.stop();
  });

  test('forwards an explicitly delivered empty body', async () => {
    const { host, loopback } = await createHarness();
    await host.handleFrame(requestHead({ hasBody: true }));
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.HttpBody, 1, new Uint8Array()));
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.StreamEnd, 1, new Uint8Array()));

    expect(await waitFor(() => loopback.requests.length === 1)).toBe(true);
    expect(loopback.requests[0]?.body).toBe('');
    await loopback.stop();
  });

  test('times out an incomplete buffered body without forwarding it', async () => {
    const { host, loopback, sentFrames } = await createHarness({ bodyDeliveryTimeoutMs: 50 });
    await host.handleFrame(requestHead({ hasBody: true }));
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.HttpBody, 1, new TextEncoder().encode('partial')));

    expect(await waitFor(() => sentFrames.some((frame) => frame.frameType === TunnelFrameType.StreamAbort))).toBe(true);
    expect(loopback.requests).toEqual([]);
    await host.handleFrame(encodeTunnelFrame(TunnelFrameType.StreamEnd, 1, new Uint8Array()));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sentFrames.filter((frame) => frame.frameType === TunnelFrameType.StreamAbort).length).toBe(1);
    await loopback.stop();
  });
});

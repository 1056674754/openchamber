import { describe, expect, test } from 'bun:test';
import { isLoopbackBindHost, isNetworkExposedBindHost } from './bind-host.js';

describe('bind-host classification', () => {
  test('loopback hosts', () => {
    expect(isLoopbackBindHost('127.0.0.1')).toBe(true);
    expect(isLoopbackBindHost('127.254.0.9')).toBe(true);
    expect(isLoopbackBindHost('localhost')).toBe(true);
    expect(isLoopbackBindHost('::1')).toBe(true);
    expect(isLoopbackBindHost('[::1]')).toBe(true);
    expect(isLoopbackBindHost('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackBindHost(' LOCALHOST ')).toBe(true);
  });

  test('network-exposed hosts', () => {
    expect(isNetworkExposedBindHost('0.0.0.0')).toBe(true);
    expect(isNetworkExposedBindHost('::')).toBe(true);
    expect(isNetworkExposedBindHost('192.168.1.130')).toBe(true);
    expect(isNetworkExposedBindHost('::ffff:192.168.1.130')).toBe(true);
    expect(isNetworkExposedBindHost('openchamber.example.com')).toBe(true);
  });

  test('empty and garbage inputs are network-exposed, never trusted as loopback', () => {
    expect(isLoopbackBindHost('')).toBe(false);
    expect(isLoopbackBindHost(undefined)).toBe(false);
    expect(isLoopbackBindHost('127')).toBe(false);
    expect(isNetworkExposedBindHost('')).toBe(true);
  });

  test('the two classifiers are complements', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::', '10.0.0.4', '']) {
      expect(isNetworkExposedBindHost(host)).toBe(!isLoopbackBindHost(host));
    }
  });
});

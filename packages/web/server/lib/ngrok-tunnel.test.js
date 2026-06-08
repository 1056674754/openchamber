import { describe, expect, it } from 'bun:test';

import {
  extractNgrokPublicUrlFromText,
  summarizeNgrokOutput,
} from './ngrok-tunnel.js';

describe('extractNgrokPublicUrlFromText', () => {
  it('extracts ngrok URLs from JSON log output', () => {
    const text = JSON.stringify({
      lvl: 'info',
      msg: 'started tunnel',
      url: 'https://demo.ngrok-free.app/',
    });

    expect(extractNgrokPublicUrlFromText(text)).toBe('https://demo.ngrok-free.app');
  });

  it('extracts ngrok URLs from plain text diagnostics', () => {
    const text = 'Forwarding https://demo.ngrok-free.app -> http://127.0.0.1:3000';

    expect(extractNgrokPublicUrlFromText(text)).toBe('https://demo.ngrok-free.app');
  });

  it('ignores non-ngrok https URLs', () => {
    expect(extractNgrokPublicUrlFromText('https://example.com')).toBeNull();
  });
});

describe('summarizeNgrokOutput', () => {
  it('prefers JSON error details', () => {
    const summary = summarizeNgrokOutput([
      JSON.stringify({ lvl: 'info', msg: 'starting' }),
      JSON.stringify({ lvl: 'eror', err: 'authentication failed' }),
    ]);

    expect(summary).toBe('authentication failed');
  });

  it('summarizes plain ERROR lines', () => {
    const summary = summarizeNgrokOutput([
      'INFO starting tunnel',
      'ERROR: authtoken not configured',
    ]);

    expect(summary).toBe('authtoken not configured');
  });
});

import { describe, expect, test } from 'bun:test';

import { resolvePreviewHeaderDisplayUrl } from './previewDisplayUrl';

describe('resolvePreviewHeaderDisplayUrl', () => {
  test('keeps internal preview proxy URLs out of the visible header', () => {
    expect(resolvePreviewHeaderDisplayUrl({
      rawUrl: 'http://localhost:3000/',
      directSrc: 'http://127.0.0.1:3000/',
      effectiveSrc: '/api/preview/proxy/dd9eb634b798b7fdaff703d2af920660/?ocPreview=1',
    })).toBe('http://127.0.0.1:3000/');
  });

  test('falls back to the raw URL when the direct URL is unavailable', () => {
    expect(resolvePreviewHeaderDisplayUrl({
      rawUrl: 'notaurl',
      directSrc: '',
      effectiveSrc: '',
    })).toBe('notaurl');
  });
});

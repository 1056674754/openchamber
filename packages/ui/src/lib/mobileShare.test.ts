import { describe, expect, test } from 'bun:test';

import { shareDataUrlAsFile } from './mobileShare';

describe('mobile file sharing', () => {
  test('shares the generated image as a named file', async () => {
    const shared: ShareData[] = [];
    await shareDataUrlAsFile('data:image/png;base64,AA==', 'message.png', {
      fetchImpl: async () => new Response(new Blob(['png'], { type: 'image/png' })),
      navigatorImpl: {
        canShare: (data) => data?.files?.[0]?.name === 'message.png',
        share: async (data) => { if (data) shared.push(data); },
      },
    });
    expect(shared[0]?.files?.[0]?.name).toBe('message.png');
    expect(shared[0]?.files?.[0]?.type).toBe('image/png');
  });

  test('fails explicitly when the runtime cannot share files', async () => {
    await expect(shareDataUrlAsFile('data:image/png;base64,AA==', 'message.png', {
      fetchImpl: async () => new Response(new Blob(['png'], { type: 'image/png' })),
      navigatorImpl: { canShare: () => false, share: async () => {} },
    })).rejects.toThrow('unavailable');
  });
});

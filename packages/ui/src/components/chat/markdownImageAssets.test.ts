import { beforeEach, describe, expect, mock, test } from 'bun:test';

let requestCount = 0;
const runtimeFetch = mock(async (_path: string, init?: RequestInit) => {
  requestCount += 1;
  const body = JSON.parse(String(init?.body)) as { sources: string[] };
  return new Response(JSON.stringify({
    results: body.sources.map((source) => ({ source, status: 'ready', path: `/repo/${source}` })),
  }), { status: 200, headers: { 'content-type': 'application/json' } });
});
const resolver = {
  authenticatedAsset: (path: string, query: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `${path}?${params}`;
  },
};

mock.module('@/lib/runtime-fetch', () => ({ runtimeFetch }));
mock.module('@/lib/runtime-url', () => ({ getRuntimeUrlResolver: () => resolver }));

const {
  extractMarkdownImageCandidates,
  prepareLocalMarkdownImages,
  resolveMarkdownImageSource,
} = await import('./markdownImageAssets');

describe('Markdown image gallery assets', () => {
  beforeEach(() => {
    requestCount = 0;
  });

  test('extracts unique inline and reference images but ignores fenced code', () => {
    const candidates = extractMarkdownImageCandidates([
      '![one](images/one.png)\n![one again](images/one.png)\n```md\n![hidden](hidden.png)\n```',
      '[two]: images/two.webp\n![second][two]',
    ]);

    expect(candidates.map((candidate) => candidate.source)).toEqual(['images/one.png', 'images/two.webp']);
  });

  test('caps a completed message gallery at twelve unique images', () => {
    const markdown = Array.from({ length: 20 }, (_, index) => `![${index}](${index}.png)`).join('\n');
    expect(extractMarkdownImageCandidates([markdown], 12)).toHaveLength(12);
  });

  test('prepares local images in one message-level request and builds a raw grant URL', async () => {
    const prepared = await prepareLocalMarkdownImages({
      sources: ['one.png', 'two.png'],
      directory: '/repo',
      sessionId: 'ses_gallery',
      messageId: 'msg_gallery',
      signal: new AbortController().signal,
    });

    expect(requestCount).toBe(1);
    expect(prepared.size).toBe(2);
    expect(resolveMarkdownImageSource('one.png', prepared.get('one.png'), '/repo')).toContain('/api/fs/raw?');
  });
});

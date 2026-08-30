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
  prepareVSCodeMarkdownImages,
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

  test('prepares VS Code images through the binary bridge only inside the session directory', async () => {
    let statCount = 0;
    let binaryReadCount = 0;
    const statFile = async () => {
      statCount += 1;
      return { path: '/repo/images/one.png', isFile: true, size: 3 };
    };
    const readFileBinary = async () => {
      binaryReadCount += 1;
      return { path: '/repo/images/one.png', dataUrl: 'data:image/png;base64,cG5n' };
    };
    const prepared = await prepareVSCodeMarkdownImages({
      sources: ['images/one.png', '/other/secret.png'],
      directory: '/repo',
      files: { statFile, readFileBinary } as never,
    });

    expect(prepared.get('images/one.png')?.status).toBe('ready');
    expect(resolveMarkdownImageSource('images/one.png', prepared.get('images/one.png'), '/repo'))
      .toBe('data:image/png;base64,cG5n');
    expect(prepared.get('/other/secret.png')).toEqual({ status: 'error' });
    expect(statCount).toBe(1);
    expect(binaryReadCount).toBe(1);
  });
});

import { marked, type Token, type Tokens } from 'marked';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeUrlResolver, type RuntimeUrlResolver } from '@/lib/runtime-url';
import type { FilesAPI } from '@/lib/api/types';
import {
  isResolvedFileReferenceWithinDirectory,
  resolveMarkdownImageReference,
} from './markdownFileReferences';

const MAX_MARKDOWN_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PREPARE_CACHE_ENTRIES = 1024;
const NON_READY_CACHE_MS = 30_000;

export type MarkdownImageCandidate = {
  source: string;
  alt: string;
};

export type PreparedMarkdownImage =
  | { status: 'ready'; path: string; dataUrl?: string; outsideFileGrant?: string; expiresAt?: number }
  | { status: 'missing' | 'error' };

const visitTokens = (tokens: Token[], visit: (token: Token) => void): void => {
  for (const token of tokens) {
    visit(token);
    const nested = (token as Token & { tokens?: Token[] }).tokens;
    if (Array.isArray(nested)) visitTokens(nested, visit);
    if (token.type === 'list') {
      for (const item of (token as Tokens.List).items) visitTokens(item.tokens, visit);
    }
    if (token.type === 'table') {
      const table = token as Tokens.Table;
      for (const cell of [...table.header, ...table.rows.flat()]) visitTokens(cell.tokens, visit);
    }
  }
};

export const prepareVSCodeMarkdownImages = async ({
  sources,
  directory,
  files,
}: {
  sources: readonly string[];
  directory: string;
  files: FilesAPI;
}): Promise<Map<string, PreparedMarkdownImage>> => {
  const prepared = new Map<string, PreparedMarkdownImage>();
  for (const source of sources) {
    const reference = resolveMarkdownImageReference(source, directory);
    if (!reference || !isResolvedFileReferenceWithinDirectory(reference.resolvedPath, directory)) {
      prepared.set(source, { status: 'error' });
      continue;
    }
    try {
      if (!files.readFileBinary || !files.statFile) throw new Error('Binary file reads are unavailable');
      const stat = await files.statFile(reference.resolvedPath);
      if (!stat.isFile || stat.size > MAX_MARKDOWN_IMAGE_BYTES) throw new Error('Image is too large');
      const result = await files.readFileBinary(reference.resolvedPath);
      if (!/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(result.dataUrl)) {
        throw new Error('Unsupported image data');
      }
      prepared.set(source, { status: 'ready', path: result.path, dataUrl: result.dataUrl });
    } catch {
      prepared.set(source, { status: 'error' });
    }
  }
  return prepared;
};

export const extractMarkdownImageCandidates = (contents: readonly string[], limit = 12): MarkdownImageCandidate[] => {
  const found = new Map<string, MarkdownImageCandidate>();
  for (const content of contents) {
    if (!content || found.size >= limit) continue;
    const tokens = marked.lexer(content);
    visitTokens(tokens, (token) => {
      if (found.size >= limit || token.type !== 'image') return;
      const image = token as Tokens.Image;
      const source = String(image.href || '').trim();
      if (!source || found.has(source)) return;
      found.set(source, { source, alt: String(image.text || '').trim() });
    });
  }
  return Array.from(found.values());
};

export const isLocalMarkdownImageSource = (source: string): boolean => (
  !/^(?:https?:)?\/\//i.test(source)
  && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(source)
);

type PrepareCacheEntry = { result: Map<string, PreparedMarkdownImage>; expiresAt: number };
const prepareCaches = new WeakMap<RuntimeUrlResolver, Map<string, PrepareCacheEntry>>();

export const prepareLocalMarkdownImages = async ({
  sources,
  directory,
  sessionId,
  messageId,
  signal,
}: {
  sources: readonly string[];
  directory: string;
  sessionId: string;
  messageId: string;
  signal: AbortSignal;
}): Promise<Map<string, PreparedMarkdownImage>> => {
  const resolver = getRuntimeUrlResolver();
  let cache = prepareCaches.get(resolver);
  if (!cache) {
    cache = new Map();
    prepareCaches.set(resolver, cache);
  }
  const key = `${sessionId}\0${messageId}\0${directory}\0${sources.join('\0')}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) cache.delete(key);

  const response = await runtimeFetch(`/api/openchamber/sessions/${encodeURIComponent(sessionId)}/markdown-image-grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ directory, messageId, sources }),
    signal,
  });
  if (!response.ok) throw new Error(`Unable to prepare images (${response.status})`);
  const payload = await response.json() as {
    results?: Array<{ source?: string; status?: string; path?: string; outsideFileGrant?: string; expiresAt?: number }>;
  };
  const prepared = new Map<string, PreparedMarkdownImage>();
  for (const result of payload.results ?? []) {
    if (!result.source) continue;
    if (result.status === 'ready' && result.path) {
      prepared.set(result.source, {
        status: 'ready',
        path: result.path,
        outsideFileGrant: result.outsideFileGrant,
        expiresAt: result.expiresAt,
      });
    } else {
      prepared.set(result.source, { status: result.status === 'missing' ? 'missing' : 'error' });
    }
  }
  for (const source of sources) if (!prepared.has(source)) prepared.set(source, { status: 'error' });
  while (cache.size >= MAX_PREPARE_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  const readyExpiries = Array.from(prepared.values())
    .filter((entry): entry is Extract<PreparedMarkdownImage, { status: 'ready' }> => entry.status === 'ready')
    .map((entry) => entry.expiresAt ?? Number.POSITIVE_INFINITY);
  const allReady = Array.from(prepared.values()).every((entry) => entry.status === 'ready');
  cache.set(key, {
    result: prepared,
    expiresAt: allReady ? Math.max(Date.now(), Math.min(...readyExpiries) - 5000) : Date.now() + NON_READY_CACHE_MS,
  });
  return prepared;
};

const validateDataImage = (source: string): string => {
  if (source.length > Math.ceil(MAX_MARKDOWN_IMAGE_BYTES * 4 / 3) + 64) {
    throw new Error('Image is too large');
  }
  return source;
};

export const resolveMarkdownImageSource = (
  source: string,
  prepared: PreparedMarkdownImage | undefined,
  directory: string,
): string => {
  if (/^(?:https?:)?\/\//i.test(source)) return source;
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(source)) return validateDataImage(source);
  if (prepared?.status !== 'ready') throw new Error('Local image has not been prepared');
  if (prepared.dataUrl) return validateDataImage(prepared.dataUrl);
  return getRuntimeUrlResolver().authenticatedAsset('/api/fs/raw', {
    path: prepared.path,
    directory,
    allowOutsideWorkspace: prepared.outsideFileGrant ? 'true' : undefined,
    outsideFileGrant: prepared.outsideFileGrant,
  });
};

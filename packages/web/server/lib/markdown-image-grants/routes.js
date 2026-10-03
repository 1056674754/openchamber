import express from 'express';
import { constants as fsConstants } from 'node:fs';
import { mintOutsideFileGrant } from '../fs/routes.js';
import { readMessageRecord } from '../opencode/message-records.js';
import { isV2PromptTrack } from '../opencode/v2-prompt-dispatch.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SOURCES = 12;
const asString = (value) => typeof value === 'string' ? value.trim() : '';

const isWithin = (target, root, path) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const parseFileSource = (source) => {
  if (/^file:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      if (url.protocol !== 'file:' || (url.host && url.host !== 'localhost')) return '';
      const pathname = decodeURIComponent(url.pathname);
      return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      return '';
    }
  }
  const pathname = source.split(/[?#]/, 1)[0] || '';
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

const hasImageSignature = (bytes) => {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes.subarray(1, 4).toString('ascii') === 'PNG'
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return true;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  const header = bytes.subarray(0, 12).toString('ascii');
  return header.startsWith('GIF87a')
    || header.startsWith('GIF89a')
    || (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP');
};

const normalizeLabel = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const unescapeDestination = (value) => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g, '$1');

const isEscapedAt = (value, index) => {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
};

const findClosingBracket = (value, start) => {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (value[cursor] === ']' && !isEscapedAt(value, cursor)) return cursor;
  }
  return -1;
};

const parseInlineDestination = (value, start) => {
  let cursor = start;
  while (/\s/.test(value[cursor] || '')) cursor += 1;
  const angled = value[cursor] === '<';
  if (angled) {
    const end = value.indexOf('>', cursor + 1);
    if (end < 0) return null;
    cursor = end + 1;
    while (/\s/.test(value[cursor] || '')) cursor += 1;
    while (value[cursor] && value[cursor] !== ')') cursor += 1;
    return value[cursor] === ')'
      ? { source: unescapeDestination(value.slice(start, end).trim().replace(/^</, '')), end: cursor }
      : null;
  }

  let source = '';
  let depth = 0;
  for (; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (char === '\\' && cursor + 1 < value.length) {
      source += char + value[cursor + 1];
      cursor += 1;
      continue;
    }
    if (char === '(') {
      depth += 1;
      source += char;
      continue;
    }
    if (char === ')') {
      if (depth === 0) return { source: unescapeDestination(source.trim()), end: cursor };
      depth -= 1;
      source += char;
      continue;
    }
    if (/\s/.test(char) && depth === 0) {
      while (value[cursor] && value[cursor] !== ')') cursor += 1;
      return value[cursor] === ')' ? { source: unescapeDestination(source.trim()), end: cursor } : null;
    }
    source += char;
  }
  return null;
};

const collectMarkdownLinesOutsideCode = (message) => {
  const lines = [];
  for (const part of Array.isArray(message?.parts) ? message.parts : []) {
    if (part?.type !== 'text' || typeof part.text !== 'string') continue;
    let fence = null;
    for (const line of part.text.split('\n')) {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (!fence) fence = { char: marker[0], size: marker.length };
        else if (marker[0] === fence.char && marker.length >= fence.size) fence = null;
        continue;
      }
      if (!fence) lines.push(line.replace(/`+[^`]*`+/g, ''));
    }
  }
  return lines;
};

export const markdownImageSources = (message) => {
  const sources = new Set();
  const lines = collectMarkdownLinesOutsideCode(message);
  const definitions = new Map();
  for (const line of lines) {
    const match = /^\s{0,3}\[([^\]]+)]\s*:\s*(?:<([^>]+)>|((?:\\.|\S)+))/.exec(line);
    const source = match?.[2] || match?.[3];
    if (match?.[1] && source) definitions.set(normalizeLabel(match[1]), unescapeDestination(source));
  }
  for (const line of lines) {
    for (let cursor = 0; cursor < line.length; cursor += 1) {
      if (line[cursor] !== '!' || line[cursor + 1] !== '[' || isEscapedAt(line, cursor)) continue;
      const altEnd = findClosingBracket(line, cursor + 2);
      if (altEnd < 0) continue;
      const alt = line.slice(cursor + 2, altEnd);
      if (line[altEnd + 1] === '(') {
        const parsed = parseInlineDestination(line, altEnd + 2);
        if (parsed?.source) sources.add(parsed.source);
        cursor = parsed?.end ?? altEnd;
        continue;
      }
      let label = alt;
      if (line[altEnd + 1] === '[') {
        const labelEnd = findClosingBracket(line, altEnd + 2);
        if (labelEnd < 0) continue;
        label = line.slice(altEnd + 2, labelEnd) || alt;
        cursor = labelEnd;
      }
      const source = definitions.get(normalizeLabel(label));
      if (source) sources.add(source);
    }
  }
  return sources;
};

const fetchMessage = async ({ sessionId, messageId, directory, buildOpenCodeUrl, getOpenCodeAuthHeaders, fetchImpl }) => {
  const url = new URL(buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(messageId)}`, ''));
  // v2 branch: the location middleware ignores ?directory= — scope by the
  // x-opencode-directory header (percent-encoded like the SDK wire format) and
  // unwrap the flat record from its {data} envelope; the v1 track keeps the
  // query and the bare {info, parts} record.
  const v2Track = isV2PromptTrack();
  if (!v2Track) url.searchParams.set('directory', directory);
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      ...(v2Track ? { 'x-opencode-directory': encodeURIComponent(directory) } : { 'x-opencode-directory': directory }),
      ...getOpenCodeAuthHeaders(),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`OpenCode returned ${response.status}`);
  return readMessageRecord(await response.json().catch(() => null));
};

const inspectImage = async ({ source, directory, approvedTempRoot, fsPromises, path }) => {
  const parsed = parseFileSource(source);
  if (!parsed) return { status: 'error' };
  const sourcePath = path.isAbsolute(parsed) ? parsed : path.resolve(directory, parsed);
  const workspaceRoot = path.resolve(directory);
  const outsideWorkspace = !isWithin(path.resolve(sourcePath), workspaceRoot, path);
  const root = outsideWorkspace ? approvedTempRoot : workspaceRoot;
  try {
    const [canonicalRoot, canonicalPath] = await Promise.all([fsPromises.realpath(root), fsPromises.realpath(sourcePath)]);
    if (!isWithin(canonicalPath, canonicalRoot, path)) return { status: 'error' };
    const handle = await fsPromises.open(canonicalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_IMAGE_BYTES) return { status: 'error' };
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (!hasImageSignature(header.subarray(0, bytesRead))) return { status: 'error' };
      return { status: 'ready', path: canonicalPath, outsideWorkspace };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing' };
    if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'ELOOP') return { status: 'error' };
    throw error;
  }
};

export const registerMarkdownImageGrantRoutes = (app, dependencies) => {
  const { fsPromises, path, os, crypto, validateDirectoryPath, buildOpenCodeUrl, getOpenCodeAuthHeaders } = dependencies;
  const approvedTempRoot = dependencies.approvedTempRoot ?? path.join(os.tmpdir(), 'opencode');
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  app.post('/api/openchamber/sessions/:sessionId/markdown-image-grants', express.json({ limit: '32kb' }), async (req, res) => {
    const sessionId = asString(req.params.sessionId);
    const messageId = asString(req.body?.messageId);
    const sources = Array.isArray(req.body?.sources) ? [...new Set(req.body.sources.map(asString).filter(Boolean))] : [];
    if (!sessionId || !messageId || sources.length === 0 || sources.length > MAX_IMAGE_SOURCES) {
      return res.status(400).json({ error: 'sessionId, messageId, and 1-12 sources are required' });
    }
    const validated = await validateDirectoryPath(asString(req.body?.directory));
    if (!validated.ok) return res.status(400).json({ error: validated.error || 'Invalid directory' });
    try {
      const message = await fetchMessage({
        sessionId,
        messageId,
        directory: validated.directory,
        buildOpenCodeUrl,
        getOpenCodeAuthHeaders,
        fetchImpl,
      });
      if (!message || message.info?.id !== messageId || message.info?.role !== 'assistant') {
        return res.status(404).json({ error: 'Assistant message not found' });
      }
      const referenced = markdownImageSources(message);
      const results = [];
      for (const source of sources) {
        if (!referenced.has(source)) {
          results.push({ source, status: 'error' });
          continue;
        }
        const inspected = await inspectImage({ source, directory: validated.directory, approvedTempRoot, fsPromises, path });
        if (inspected.status !== 'ready') {
          results.push({ source, status: inspected.status });
          continue;
        }
        const grant = inspected.outsideWorkspace
          ? await mintOutsideFileGrant(inspected.path, { scopes: ['raw'], fsPromises, path, crypto })
          : null;
        results.push({
          source,
          status: 'ready',
          path: inspected.path,
          outsideFileGrant: grant?.outsideFileGrant,
          expiresAt: grant?.expiresAt,
        });
      }
      return res.json({ results });
    } catch (error) {
      console.warn('[MarkdownImageGrants] failed to prepare images:', error?.message || error);
      return res.status(503).json({ error: 'Failed to prepare session images' });
    }
  });
};

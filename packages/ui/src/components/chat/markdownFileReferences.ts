import { isAbsoluteFilePath, isFilePathWithinDirectory, normalizeFilePath, toAbsoluteFilePath } from '@/lib/path-utils';
import { resolveApiUrl } from '@/lib/api/serverUrl';

export type ParsedFileReference = {
  path: string;
  line?: number;
  endLine?: number;
  column?: number;
};

export type FileReferenceTextMatch = {
  start: number;
  end: number;
  raw: string;
};

export type BlockCodeTextSegment = {
  text: string;
  isLineNumber: boolean;
};

export const buildBlockCodePathScanText = (segments: readonly BlockCodeTextSegment[]): string => (
  segments
    .filter((segment) => !segment.isLineNumber)
    .map((segment) => segment.text)
    .join('')
);

export type MarkdownImageReference = {
  source: string;
  resolvedPath: string;
  rawUrl: string;
};

export const shouldPreserveMarkdownFileUrl = (url: string, key: string): boolean => (
  (key === 'href' || key === 'src') && url.trim().toLowerCase().startsWith('file://')
);

// Matches `path[:line[:col]]` inside shell/grep-style output. Requires a file
// extension so plain words don't qualify; the path itself must contain at least
// one extension-bearing segment. Whole-line path detection below handles paths
// with spaces, because regex tokenization cannot distinguish spaces inside a
// filename from spaces between shell-output words without overmatching.
const BLOCK_PATH_TOKEN_RE = /(?:[A-Za-z]:[\\/])?[\w.\-/@+~]*[\w\-/@+~]\.[A-Za-z0-9_-]{1,32}(?::\d+(?:-\d+)?(?::\d+)?)?/g;

const IMAGE_FILE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

const KNOWN_FILE_EXTENSIONS = new Set([
  ...IMAGE_FILE_EXTENSIONS,
  'astro',
  'bash',
  'bat',
  'c',
  'cc',
  'cfg',
  'cjs',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'cts',
  'cxx',
  'd.ts',
  'dart',
  'diff',
  'dockerignore',
  'editorconfig',
  'env',
  'fish',
  'go',
  'gradle',
  'graphql',
  'gql',
  'h',
  'hcl',
  'hpp',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'json5',
  'jsonc',
  'jsx',
  'kt',
  'kts',
  'less',
  'lock',
  'lockb',
  'log',
  'lua',
  'm',
  'md',
  'mdx',
  'mjs',
  'mm',
  'mts',
  'nix',
  'patch',
  'pdf',
  'php',
  'pl',
  'pm',
  'properties',
  'proto',
  'py',
  'rb',
  'rs',
  'sass',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
]);

const KNOWN_FILE_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'readme',
  'license',
  '.env',
  '.gitignore',
  '.npmrc',
]);

const KNOWN_BASENAME_PATTERN = Array.from(KNOWN_FILE_BASENAMES)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

export const normalizePath = (value: string): string => {
  return normalizeFilePath(value);
};

export const isAbsolutePath = (value: string): boolean => {
  return isAbsoluteFilePath(value);
};

export const toAbsolutePath = (basePath: string, targetPath: string): string => {
  return toAbsoluteFilePath(basePath, targetPath);
};

export const isResolvedFileReferenceWithinDirectory = (resolvedPath: string, directory: string): boolean => {
  return isFilePathWithinDirectory(resolvedPath, directory);
};

export const buildFileRequestParams = (resolvedPath: string, effectiveDirectory: string): URLSearchParams => {
  const normalizedDirectory = normalizePath(effectiveDirectory);
  const normalizedPath = normalizePath(resolvedPath);
  const params = new URLSearchParams({ path: normalizedPath });
  if (normalizedDirectory && isResolvedFileReferenceWithinDirectory(normalizedPath, normalizedDirectory)) {
    params.set('directory', normalizedDirectory);
  } else {
    params.set('allowOutsideWorkspace', 'true');
  }
  return params;
};

export const buildFileRawUrl = (resolvedPath: string, effectiveDirectory: string, fileReferenceBaseUrl?: string): string => {
  const params = buildFileRequestParams(resolvedPath, effectiveDirectory);
  return `${resolveApiUrl('/api/fs/raw', fileReferenceBaseUrl)}?${params.toString()}`;
};

export const trimPathCandidate = (value: string): string => {
  let next = (value || '').trim();
  if (!next) {
    return '';
  }

  if ((next.startsWith('`') && next.endsWith('`')) || (next.startsWith('"') && next.endsWith('"')) || (next.startsWith("'") && next.endsWith("'"))) {
    next = next.slice(1, -1).trim();
  }

  next = next.replace(/[.,;!?]+$/g, '');

  if (next.endsWith(')') && !next.includes('(')) {
    next = next.slice(0, -1);
  }
  if (next.endsWith(']') && !next.includes('[')) {
    next = next.slice(0, -1);
  }

  return next;
};

const decodeUriPathComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeFileUrlPathCandidate = (value: string): string => {
  const raw = (value || '').trim();
  if (!raw.toLowerCase().startsWith('file://')) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    const pathname = decodeUriPathComponent(parsed.pathname || '');
    const path = parsed.hostname && parsed.hostname !== 'localhost'
      ? `//${parsed.hostname}${pathname}`
      : /^\/[A-Za-z]:\//.test(pathname)
        ? pathname.slice(1)
        : pathname;
    const normalizedPath = normalizePath(path);
    const lineHash = /^#L\d+(?:C\d+)?$/i.test(parsed.hash) ? parsed.hash : '';
    return `${normalizedPath}${lineHash}`;
  } catch {
    return raw;
  }
};

const stripTrailingReference = (value: string): string => {
  let next = trimPathCandidate(value);
  if (!next) {
    return '';
  }

  const semicolonIndex = next.indexOf(';');
  if (semicolonIndex >= 0) {
    next = next.slice(0, semicolonIndex);
  }

  next = next.replace(/#.*$/, '');

  const extensionSuffixMatch = next.match(/^(.*\.[A-Za-z0-9_-]{1,16}):.*$/);
  if (extensionSuffixMatch) {
    next = extensionSuffixMatch[1] ?? next;
  }

  const basenameSuffixMatch = KNOWN_BASENAME_PATTERN.length > 0
    ? next.match(new RegExp(`^(.*(?:/|^)(${KNOWN_BASENAME_PATTERN})):.*$`, 'i'))
    : null;
  if (basenameSuffixMatch) {
    next = basenameSuffixMatch[1] ?? next;
  }

  return trimPathCandidate(next);
};

export const parseFileReference = (value: string): ParsedFileReference | null => {
  const trimmed = trimPathCandidate(normalizeFileUrlPathCandidate(value));
  if (!trimmed) {
    return null;
  }

  const semicolonIndex = trimmed.indexOf(';');
  const withoutSemicolonSuffix = semicolonIndex >= 0
    ? trimPathCandidate(trimmed.slice(0, semicolonIndex))
    : trimmed;
  if (!withoutSemicolonSuffix) {
    return null;
  }

  const hashMatch = withoutSemicolonSuffix.match(/^(.*)#L(\d+)(?:-L?(\d+))?(?:C(\d+))?$/i);
  if (hashMatch) {
    const path = stripTrailingReference(hashMatch[1] ?? '');
    const line = Number.parseInt(hashMatch[2] ?? '', 10);
    const endLine = hashMatch[3] ? Number.parseInt(hashMatch[3], 10) : undefined;
    const column = hashMatch[4] ? Number.parseInt(hashMatch[4], 10) : undefined;
    if (!path || !Number.isFinite(line)) {
      return null;
    }

    return {
      path,
      line,
      endLine: Number.isFinite(endLine ?? Number.NaN) ? endLine : undefined,
      column: Number.isFinite(column ?? Number.NaN) ? column : undefined,
    };
  }

  const colonMatch = withoutSemicolonSuffix.match(/^(.*):(\d+)(?:-(\d+))?(?::(\d+))?$/);
  if (colonMatch) {
    const path = stripTrailingReference(colonMatch[1] ?? '');
    const line = Number.parseInt(colonMatch[2] ?? '', 10);
    const endLine = colonMatch[3] ? Number.parseInt(colonMatch[3], 10) : undefined;
    const column = colonMatch[4] ? Number.parseInt(colonMatch[4], 10) : undefined;
    if (!path || !Number.isFinite(line)) {
      return null;
    }

    return {
      path,
      line,
      endLine: Number.isFinite(endLine ?? Number.NaN) ? endLine : undefined,
      column: Number.isFinite(column ?? Number.NaN) ? column : undefined,
    };
  }

  const pathOnly = stripTrailingReference(withoutSemicolonSuffix);
  if (!pathOnly) {
    return null;
  }

  return { path: pathOnly };
};

const hasFileExtension = (path: string): boolean => {
  const base = path.split('/').filter(Boolean).pop() ?? '';
  if (!base || base.endsWith('.')) {
    return false;
  }
  return /\.[A-Za-z0-9_-]{1,16}$/.test(base);
};

const getBareFileExtension = (path: string): string => {
  const base = normalizePath(path).split('/').filter(Boolean).pop() ?? '';
  const lowerBase = base.toLowerCase();
  if (lowerBase.endsWith('.d.ts')) {
    return 'd.ts';
  }

  const dotIndex = lowerBase.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === lowerBase.length - 1) {
    return '';
  }
  return lowerBase.slice(dotIndex + 1);
};

const isRelativeOrPathLikeReference = (path: string): boolean => {
  const normalized = normalizePath(path);
  return normalized.includes('/')
    || normalized.startsWith('./')
    || normalized.startsWith('../')
    || isAbsolutePath(normalized);
};

export const isLikelyFilePathValue = (path: string): boolean => {
  if (!path || path.startsWith('--') || path.includes('://')) {
    return false;
  }

  if (/[<>]/.test(path) || /\s{2,}/.test(path)) {
    return false;
  }

  const normalized = normalizePath(path);
  const baseName = normalized.split('/').filter(Boolean).pop() ?? normalized;
  if (!baseName || baseName === '.' || baseName === '..') {
    return false;
  }

  const base = baseName.toLowerCase();
  if (KNOWN_FILE_BASENAMES.has(base) || (base.startsWith('.') && base.length > 1)) {
    return true;
  }

  if (!hasFileExtension(normalized)) {
    return false;
  }

  if (isRelativeOrPathLikeReference(normalized)) {
    return true;
  }

  return KNOWN_FILE_EXTENSIONS.has(getBareFileExtension(normalized));
};

export const isLikelyFilePath = (value: string): boolean => {
  const parsed = parseFileReference(value);
  if (!parsed) {
    return false;
  }
  return isLikelyFilePathValue(parsed.path);
};

export const shouldInterceptMarkdownFileHref = (href: string): boolean => (
  isLikelyFilePath(href)
);

const overlapsExistingMatch = (start: number, end: number, matches: FileReferenceTextMatch[]): boolean => {
  return matches.some((match) => start < match.end && end > match.start);
};

const startsWithExplicitFileReferencePrefix = (value: string): boolean => {
  return value.startsWith('/')
    || value.startsWith('./')
    || value.startsWith('../')
    || value.startsWith('~/')
    || isAbsolutePath(value);
};

const addWholeLineFileReferenceMatches = (text: string, matches: FileReferenceTextMatch[]): void => {
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newlineIndex = text.indexOf('\n', lineStart);
    const lineEnd = newlineIndex === -1 ? text.length : newlineIndex;
    const rawLine = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    const leadingWhitespaceLength = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = rawLine.trim();

    if (trimmed && startsWithExplicitFileReferencePrefix(trimmed) && isLikelyFilePath(trimmed)) {
      matches.push({
        start: lineStart + leadingWhitespaceLength,
        end: lineStart + leadingWhitespaceLength + trimmed.length,
        raw: trimmed,
      });
    }

    if (newlineIndex === -1) {
      break;
    }
    lineStart = newlineIndex + 1;
  }
};

export const findFileReferenceTextMatches = (text: string): FileReferenceTextMatch[] => {
  if (!text.includes('.')) {
    return [];
  }

  const matches: FileReferenceTextMatch[] = [];
  addWholeLineFileReferenceMatches(text, matches);

  BLOCK_PATH_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = BLOCK_PATH_TOKEN_RE.exec(text);
  while (match) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;
    if (raw && isLikelyFilePath(raw) && !overlapsExistingMatch(start, end, matches)) {
      matches.push({ start, end, raw });
    }
    match = BLOCK_PATH_TOKEN_RE.exec(text);
  }

  return matches.sort((left, right) => left.start - right.start);
};

export const getResolvedReference = (rawValue: string, effectiveDirectory: string): (ParsedFileReference & { resolvedPath: string }) | null => {
  const parsed = parseFileReference(rawValue);
  if (!parsed || !isLikelyFilePathValue(parsed.path)) {
    return null;
  }

  const resolvedPath = isAbsolutePath(parsed.path)
    ? normalizePath(parsed.path)
    : toAbsolutePath(effectiveDirectory, parsed.path);
  if (!resolvedPath) {
    return null;
  }

  return {
    ...parsed,
    resolvedPath,
  };
};

export const normalizeMarkdownImageSource = (value: string): string => {
  const raw = (value || '').trim();
  if (!raw) {
    return '';
  }

  if (raw.toLowerCase().startsWith('file://')) {
    return normalizeFileUrlPathCandidate(raw).replace(/#L\d+(?:C\d+)?$/i, '');
  }

  return decodeUriPathComponent(raw);
};

export const getLowerFileExtension = (path: string): string => {
  return getBareFileExtension(path);
};

export const getFileNameFromPath = (path: string): string => {
  return normalizePath(path).split('/').filter(Boolean).pop() ?? '';
};

export const isLikelyImageFilePath = (path: string): boolean => {
  return IMAGE_FILE_EXTENSIONS.has(getLowerFileExtension(path));
};

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

export const resolveMarkdownImageReference = (
  rawSrc: string,
  effectiveDirectory: string,
  fileReferenceBaseUrl?: string,
): MarkdownImageReference | null => {
  const source = normalizeMarkdownImageSource(rawSrc);
  if (!source || isHttpUrl(source) || source.startsWith('data:') || source.startsWith('blob:')) {
    return null;
  }

  const parsed = parseFileReference(source);
  if (!parsed || !isLikelyFilePathValue(parsed.path) || !isLikelyImageFilePath(parsed.path)) {
    return null;
  }

  const normalizedDirectory = normalizePath(effectiveDirectory);
  if (!isAbsolutePath(parsed.path) && !normalizedDirectory) {
    return null;
  }

  const resolvedPath = isAbsolutePath(parsed.path)
    ? normalizePath(parsed.path)
    : toAbsolutePath(normalizedDirectory, parsed.path);
  if (!resolvedPath || !isAbsolutePath(resolvedPath)) {
    return null;
  }

  return {
    source,
    resolvedPath,
    rawUrl: buildFileRawUrl(resolvedPath, normalizedDirectory, fileReferenceBaseUrl),
  };
};

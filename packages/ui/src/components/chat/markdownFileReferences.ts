import { isAbsoluteFilePath, normalizeFilePath, toAbsoluteFilePath } from '@/lib/path-utils';

export type ParsedFileReference = {
  path: string;
  line?: number;
  column?: number;
};

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
  const trimmed = trimPathCandidate(value);
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

  const hashMatch = withoutSemicolonSuffix.match(/^(.*)#L(\d+)(?:C(\d+))?$/i);
  if (hashMatch) {
    const path = stripTrailingReference(hashMatch[1] ?? '');
    const line = Number.parseInt(hashMatch[2] ?? '', 10);
    const column = hashMatch[3] ? Number.parseInt(hashMatch[3], 10) : undefined;
    if (!path || !Number.isFinite(line)) {
      return null;
    }

    return {
      path,
      line,
      column: Number.isFinite(column ?? Number.NaN) ? column : undefined,
    };
  }

  const colonMatch = withoutSemicolonSuffix.match(/^(.*):(\d+)(?::(\d+))?$/);
  if (colonMatch) {
    const path = stripTrailingReference(colonMatch[1] ?? '');
    const line = Number.parseInt(colonMatch[2] ?? '', 10);
    const column = colonMatch[3] ? Number.parseInt(colonMatch[3], 10) : undefined;
    if (!path || !Number.isFinite(line)) {
      return null;
    }

    return {
      path,
      line,
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

const decodeUriPathComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const normalizeMarkdownImageSource = (value: string): string => {
  const raw = (value || '').trim();
  if (!raw) {
    return '';
  }

  if (raw.toLowerCase().startsWith('file://')) {
    try {
      const parsed = new URL(raw);
      const pathname = decodeUriPathComponent(parsed.pathname || '');
      if (parsed.hostname && parsed.hostname !== 'localhost') {
        return normalizePath(`//${parsed.hostname}${pathname}`);
      }
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        return normalizePath(pathname.slice(1));
      }
      return normalizePath(pathname);
    } catch {
      return raw;
    }
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

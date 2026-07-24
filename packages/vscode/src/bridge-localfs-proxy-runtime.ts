import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getFsMimeType, normalizeFsPath, resolveFileReadPath, type FsReadPathResolution } from './bridge-fs-helpers-runtime';

type ApiProxyResponsePayload = {
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
};

export const base64EncodeUtf8 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

export const collectHeaders = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

export const buildUnavailableApiResponse = (): ApiProxyResponsePayload => {
  const body = JSON.stringify({ error: 'OpenCode API unavailable' });
  return {
    status: 503,
    headers: { 'content-type': 'application/json' },
    bodyBase64: base64EncodeUtf8(body),
  };
};

export const sanitizeForwardHeaders = (input: Record<string, string> | undefined): Record<string, string> => {
  const headers: Record<string, string> = { ...(input || {}) };
  delete headers['content-length'];
  delete headers['host'];
  delete headers['connection'];
  return headers;
};

const buildProxyJsonError = (status: number, error: string): ApiProxyResponsePayload => ({
  status,
  headers: { 'content-type': 'application/json' },
  bodyBase64: base64EncodeUtf8(JSON.stringify({ error })),
});

const ARTIFACT_ROUTE_PATTERN = /^\/api\/artifacts\/([a-f0-9]{64})\/content$/;
const SAFE_INLINE_ARTIFACT_MIME_PATTERN = /^(?:image\/(?:avif|bmp|gif|jpeg|png|webp)|text\/plain|application\/pdf)$/;

type ArtifactManifest = {
  readonly name: string;
  readonly mime: string;
  readonly size: number;
};

const parseArtifactManifest = (value: unknown, artifactId: string): ArtifactManifest | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!('version' in value) || value.version !== 1) return null;
  if (!('id' in value) || value.id !== artifactId) return null;
  if (!('name' in value) || typeof value.name !== 'string' || !value.name.trim()) return null;
  if (!('mime' in value) || typeof value.mime !== 'string' || !value.mime.includes('/')) return null;
  if (!('size' in value) || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0) return null;
  return {
    name: value.name,
    mime: value.mime,
    size: value.size,
  };
};

const buildArtifactContentDisposition = (fileName: string): string => {
  const asciiOnly = fileName
    .replace(/[^\u0020-\u007E]/g, '')
    .replace(/["\\]/g, '_');
  const fallback = asciiOnly || 'artifact';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

const tryHandleLocalArtifactProxy = async (
  parsed: URL,
): Promise<ApiProxyResponsePayload | null> => {
  const match = ARTIFACT_ROUTE_PATTERN.exec(parsed.pathname);
  const artifactId = match?.[1];
  if (!artifactId) return null;

  const dataDirectory = process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber');
  const artifactDirectory = path.join(dataDirectory, 'artifacts', artifactId);

  try {
    const manifestText = await fs.promises.readFile(path.join(artifactDirectory, 'manifest.json'), 'utf8');
    const manifest = parseArtifactManifest(JSON.parse(manifestText), artifactId);
    if (!manifest) return buildProxyJsonError(500, 'Artifact manifest is invalid');

    const contentPath = path.join(artifactDirectory, 'content');
    const [stats, content] = await Promise.all([
      fs.promises.stat(contentPath),
      fs.promises.readFile(contentPath),
    ]);
    if (!stats.isFile() || stats.size !== manifest.size) {
      return buildProxyJsonError(500, 'Artifact content is invalid');
    }

    const headers: Record<string, string> = {
      'cache-control': 'private, max-age=31536000, immutable',
      'content-security-policy': "sandbox; default-src 'none'",
      'content-type': manifest.mime,
      'x-content-type-options': 'nosniff',
    };
    if (parsed.searchParams.get('download') === 'true' || !SAFE_INLINE_ARTIFACT_MIME_PATTERN.test(manifest.mime)) {
      headers['content-disposition'] = buildArtifactContentDisposition(path.basename(manifest.name));
    }
    return {
      status: 200,
      headers,
      bodyBase64: content.toString('base64'),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return buildProxyJsonError(500, 'Artifact manifest is invalid');
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return buildProxyJsonError(404, 'Artifact not found');
    }
    if (error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      return buildProxyJsonError(403, 'Access to artifact denied');
    }
    return buildProxyJsonError(500, 'Unable to read artifact');
  }
};

export const tryHandleLocalFsProxy = async (method: string, requestPath: string): Promise<ApiProxyResponsePayload | null> => {
  let parsed: URL;
  try {
    parsed = new URL(requestPath, 'https://openchamber.local');
  } catch {
    return buildProxyJsonError(400, 'Invalid request path');
  }

  const isFilesystemRoute = parsed.pathname === '/api/fs/stat'
    || parsed.pathname === '/api/fs/read'
    || parsed.pathname === '/api/fs/raw';
  if (!isFilesystemRoute && !ARTIFACT_ROUTE_PATTERN.test(parsed.pathname)) {
    return null;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    return buildProxyJsonError(405, 'Method not allowed');
  }

  const artifactResponse = await tryHandleLocalArtifactProxy(parsed);
  if (artifactResponse) return artifactResponse;

  if (!isFilesystemRoute) {
    return null;
  }

  const targetPath = parsed.searchParams.get('path') || '';
  const resolution: FsReadPathResolution = await resolveFileReadPath(targetPath);
  if (!resolution.ok) {
    return buildProxyJsonError(resolution.status, resolution.error);
  }

  try {
    const stats = await fs.promises.stat(resolution.resolvedPath);
    if (!stats.isFile()) {
      return buildProxyJsonError(400, 'Specified path is not a file');
    }

    if (parsed.pathname === '/api/fs/stat') {
      return {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        bodyBase64: base64EncodeUtf8(JSON.stringify({
          path: normalizeFsPath(resolution.resolvedPath),
          isFile: true,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        })),
      };
    }

    if (parsed.pathname === '/api/fs/read') {
      const content = await fs.promises.readFile(resolution.resolvedPath, 'utf8');
      return {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
        bodyBase64: base64EncodeUtf8(content),
      };
    }

    const raw = await fs.promises.readFile(resolution.resolvedPath);
    return {
      status: 200,
      headers: {
        'content-type': getFsMimeType(resolution.resolvedPath),
        'cache-control': 'no-store',
      },
      bodyBase64: Buffer.from(raw).toString('base64'),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return buildProxyJsonError(404, 'File not found');
    }
    if (parsed.pathname === '/api/fs/stat') {
      return buildProxyJsonError(500, 'Unable to stat file');
    }
    return buildProxyJsonError(500, 'Unable to read file');
  }
};

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

type UploadResult = {
  status: number;
  body: {
    success?: boolean;
    path?: string;
    error?: string;
    reason?: string;
  };
};

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const failure = (status: number, error: string, reason: string): UploadResult => ({
  status,
  body: { error, reason },
});

export const writeVSCodeUploadedFile = async (input: {
  directory: string;
  targetPath: string;
  bodyBase64: string;
  overwrite?: boolean;
  maxBytes?: number;
}): Promise<UploadResult> => {
  const owner = path.resolve(input.directory);
  const target = path.resolve(input.targetPath);
  const parent = path.dirname(target);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.bodyBase64, 'base64');
  } catch {
    return failure(400, 'Invalid upload body', 'invalid-body');
  }
  if (bytes.length > maxBytes) {
    return failure(413, 'Upload is too large', 'too-large');
  }

  let ownerReal: string;
  let parentReal: string;
  try {
    ownerReal = await fs.promises.realpath(owner);
    parentReal = await fs.promises.realpath(parent);
  } catch {
    return failure(404, 'Upload directory was not found', 'missing-parent');
  }
  if (!isWithin(ownerReal, parentReal)) {
    return failure(403, 'Upload target is outside the owning directory', 'outside-workspace');
  }

  try {
    const targetStats = await fs.promises.lstat(target);
    if (targetStats.isSymbolicLink()) {
      return failure(403, 'Upload target cannot be a symbolic link', 'outside-workspace');
    }
    if (!input.overwrite) {
      return failure(409, 'File already exists', 'already-exists');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return failure(500, 'Failed to inspect upload target', 'io-error');
    }
  }

  const tempPath = path.join(parent, `.openchamber-upload-${crypto.randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(tempPath, bytes, { flag: 'wx' });
    if (input.overwrite) {
      await fs.promises.rename(tempPath, target);
    } else {
      try {
        await fs.promises.link(tempPath, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return failure(409, 'File already exists', 'already-exists');
        }
        throw error;
      }
      await fs.promises.unlink(tempPath);
    }
    return { status: 200, body: { success: true, path: target } };
  } catch (error) {
    return failure(500, error instanceof Error ? error.message : 'Failed to upload file', 'io-error');
  } finally {
    await fs.promises.unlink(tempPath).catch(() => undefined);
  }
};

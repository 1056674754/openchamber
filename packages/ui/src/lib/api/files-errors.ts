export type FilesystemErrorReason =
  | 'os-permission'
  | 'not-found'
  | 'not-directory'
  | 'invalid-response'
  | 'unknown';

export class FilesystemError extends Error {
  readonly reason: FilesystemErrorReason;
  readonly status?: number;

  constructor(message: string, options: { readonly reason?: FilesystemErrorReason; readonly status?: number } = {}) {
    super(message);
    this.name = 'FilesystemError';
    this.reason = options.reason ?? 'unknown';
    this.status = options.status;
  }
}

export const isFilesystemError = (error: unknown): error is FilesystemError => {
  if (error instanceof FilesystemError) return true;
  if (!error || typeof error !== 'object') return false;
  return typeof Reflect.get(error, 'reason') === 'string';
};

export const parseFilesystemErrorReason = (value: unknown): FilesystemErrorReason => {
  switch (value) {
    case 'os-permission':
    case 'not-found':
    case 'not-directory':
    case 'invalid-response':
      return value;
    default:
      return 'unknown';
  }
};

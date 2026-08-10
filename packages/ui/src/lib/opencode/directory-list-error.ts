import { isFilesystemError } from '@/lib/api/files-errors';

const formatErrorDetail = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string') return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export function createDirectoryListError(error: unknown, directoryPath: string): Error {
  if (isFilesystemError(error)) return error;
  const directory = directoryPath.trim().replace(/\\/g, '/') || '<default>';
  const detail = formatErrorDetail(error) || 'Unknown error';
  return new Error(`Failed to list directory "${directory}": ${detail}`);
}

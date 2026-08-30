type FileContentInvalidation = {
  scopeKey: string;
  paths: readonly string[];
};

type FileContentInvalidationListener = (invalidation: FileContentInvalidation) => void;

const listeners = new Set<FileContentInvalidationListener>();

export const createFileContentScopeKey = (runtimeKey: string, serverBaseUrl: string): string => (
  JSON.stringify([runtimeKey.trim(), serverBaseUrl.trim().replace(/\/+$/, '')])
);

export const notifyFileContentInvalidated = (invalidation: FileContentInvalidation): void => {
  const scopeKey = invalidation.scopeKey.trim();
  const paths = Array.from(new Set(invalidation.paths.map((path) => path.trim()).filter(Boolean)));
  if (!scopeKey || paths.length === 0) return;

  for (const listener of listeners) {
    listener({ scopeKey, paths });
  }
};

export const subscribeToFileContentInvalidation = (
  listener: FileContentInvalidationListener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

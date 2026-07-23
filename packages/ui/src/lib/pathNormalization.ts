export const normalizePath = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const replaced = trimmed
    .replace(/\\/g, '/')
    .replace(/^([a-z]):/, (_, letter: string) => `${letter.toUpperCase()}:`);

  if (replaced === '/') return '/';
  const stripped = replaced.length > 1 ? replaced.replace(/\/+$/, '') : replaced;
  return stripped || null;
};

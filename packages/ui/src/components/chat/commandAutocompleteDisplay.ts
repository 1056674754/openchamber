export type CommandNameDisplayParts = {
  readonly mutedPrefix: string;
  readonly emphasis: string;
};

const MIN_PREFIX_QUERY_LENGTH = 2;

const normalizeCommandQuery = (query: string): string => query.trim().replace(/^\/+/, '').toLowerCase();

export const getCommandNameDisplayParts = (name: string, searchQuery: string): CommandNameDisplayParts => {
  const normalizedQuery = normalizeCommandQuery(searchQuery);
  if (normalizedQuery.length < MIN_PREFIX_QUERY_LENGTH) {
    return { mutedPrefix: '', emphasis: name };
  }

  const lowerName = name.toLowerCase();
  if (!lowerName.startsWith(normalizedQuery) || name.length <= normalizedQuery.length) {
    return { mutedPrefix: '', emphasis: name };
  }

  const nextCharacter = name[normalizedQuery.length];
  const prefixEnd = nextCharacter === '-' || nextCharacter === ':' || nextCharacter === '/'
    ? normalizedQuery.length + 1
    : normalizedQuery.length;
  const mutedPrefix = name.slice(0, prefixEnd);
  const emphasis = name.slice(prefixEnd);

  if (!emphasis) {
    return { mutedPrefix: '', emphasis: name };
  }

  return { mutedPrefix, emphasis };
};

export type CommandAutocompleteDedupeEntry = {
  readonly name: string;
  readonly source?: string;
  readonly description?: string;
  readonly isBuiltIn?: boolean;
  readonly isOpenChamber?: boolean;
  readonly isSkill?: boolean;
  readonly scope?: string;
};

const scopePriority = (scope?: string): number => {
  if (scope === 'project') return 2;
  if (scope === 'user') return 1;
  return 0;
};

const entryPriority = (entry: CommandAutocompleteDedupeEntry): number => {
  const isSystem = entry.isBuiltIn || entry.isOpenChamber || entry.source === 'openchamber';
  const isRealCommand = !entry.isSkill;
  const isSkillEntry = entry.source === 'skill';

  if (isSystem) return 400 + scopePriority(entry.scope);
  if (isRealCommand) return 300 + scopePriority(entry.scope);
  if (isSkillEntry) return 200 + scopePriority(entry.scope);
  return 100 + scopePriority(entry.scope) + (entry.description?.trim() ? 1 : 0);
};

const commandKey = (entry: CommandAutocompleteDedupeEntry): string => entry.name.trim().toLowerCase();

export const dedupeCommandAutocompleteEntries = <T extends CommandAutocompleteDedupeEntry>(entries: readonly T[]): T[] => {
  const winners = new Map<string, T>();

  for (const entry of entries) {
    const key = commandKey(entry);
    if (!key) continue;
    const current = winners.get(key);
    if (!current || entryPriority(entry) > entryPriority(current)) {
      winners.set(key, entry);
    }
  }

  return entries.filter((entry) => winners.get(commandKey(entry)) === entry);
};

export type CommandSource = 'openchamber' | 'opencode' | 'skill';

export type CommandInfo = {
  readonly id: string;
  readonly name: string;
  readonly source: CommandSource;
  readonly description?: string;
  readonly agent?: string;
  readonly model?: string;
  readonly isBuiltIn?: boolean;
  readonly isOpenChamber?: boolean;
  readonly isSkill?: boolean;
  readonly scope?: string;
};

export type CommandAutocompleteHandle = {
  readonly handleKeyDown: (key: string) => void;
};

export type AutocompleteTab = 'commands' | 'agents' | 'files';

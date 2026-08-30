import { fuzzyMatch } from '@/lib/utils';
import { dedupeCommandAutocompleteEntries } from './commandAutocompleteDedupe';
import type { CommandInfo } from './commandAutocompleteTypes';

export type CommandAutocompleteDescriptions = {
  readonly init: string;
  readonly undo: string;
  readonly redo: string;
  readonly timeline: string;
  readonly compact: string;
  readonly btw: string;
  readonly summary: string;
  readonly workspaceReview: string;
  readonly handoffReview: string;
  readonly featurePlan: string;
  readonly craftGoal: string;
  readonly scheduleTask: string;
  readonly catchUp: string;
  readonly debug: string;
  readonly weigh: string;
  readonly explore: string;
};

type CommandMetadata = {
  readonly name: string;
  readonly description?: string;
  readonly agent?: string | null;
  readonly model?: string | null;
  readonly source?: string;
  readonly scope?: string;
};

type SkillMetadata = {
  readonly name: string;
  readonly description?: string;
  readonly scope: string;
  readonly source?: string;
};

type CommandBuildOptions = {
  readonly commandsWithMetadata: readonly CommandMetadata[];
  readonly skills: readonly SkillMetadata[];
  readonly searchQuery: string;
  readonly hasSession: boolean;
  readonly hasMessagesInCurrentSession: boolean;
  readonly canStartSessionCommand: boolean;
  readonly canUseReviewHandoffFlow: boolean;
  readonly canUseCraftGoal: boolean;
  readonly canUseScheduleTask: boolean;
  readonly descriptions: CommandAutocompleteDescriptions;
};

type BuiltInCommandOptions = {
  readonly hasSession: boolean;
  readonly hasMessagesInCurrentSession: boolean;
  readonly canStartSessionCommand: boolean;
  readonly canUseReviewHandoffFlow: boolean;
  readonly canUseCraftGoal: boolean;
  readonly canUseScheduleTask: boolean;
  readonly descriptions: CommandAutocompleteDescriptions;
};

const createBuiltInCommands = ({
  hasSession,
  hasMessagesInCurrentSession,
  canStartSessionCommand,
  canUseReviewHandoffFlow,
  canUseCraftGoal,
  canUseScheduleTask,
  descriptions,
}: BuiltInCommandOptions): CommandInfo[] => [
  ...(hasSession && !hasMessagesInCurrentSession
    ? [{ id: 'openchamber:init', name: 'init', source: 'openchamber' as const, description: descriptions.init, isBuiltIn: true }]
    : []
  ),
  ...(hasSession
    ? [
        { id: 'openchamber:undo', name: 'undo', source: 'openchamber' as const, description: descriptions.undo, isBuiltIn: true },
        { id: 'openchamber:redo', name: 'redo', source: 'openchamber' as const, description: descriptions.redo, isBuiltIn: true },
        { id: 'openchamber:timeline', name: 'timeline', source: 'openchamber' as const, description: descriptions.timeline, isBuiltIn: true },
      ]
    : []
  ),
  { id: 'openchamber:compact', name: 'compact', source: 'openchamber' as const, description: descriptions.compact, isBuiltIn: true },
  ...(hasSession
    ? [{ id: 'openchamber:btw', name: 'btw', source: 'openchamber' as const, description: descriptions.btw, isOpenChamber: true }]
    : []
  ),
  ...(hasSession
    ? [{ id: 'openchamber:summary', name: 'summary', source: 'openchamber' as const, description: descriptions.summary, isOpenChamber: true }]
    : []
  ),
  ...(canStartSessionCommand
    ? [{ id: 'openchamber:workspace-review', name: 'workspace-review', source: 'openchamber' as const, description: descriptions.workspaceReview, isOpenChamber: true }]
    : []
  ),
  ...(canUseReviewHandoffFlow
    ? [{ id: 'openchamber:handoff-review', name: 'handoff-review', source: 'openchamber' as const, description: descriptions.handoffReview, isOpenChamber: true }]
    : []
  ),
  ...(canStartSessionCommand
    ? [{ id: 'openchamber:plan-feature', name: 'plan-feature', source: 'openchamber' as const, description: descriptions.featurePlan, isOpenChamber: true }]
    : []
  ),
  ...(canUseCraftGoal
    ? [{ id: 'openchamber:craft-goal', name: 'craft-goal', source: 'openchamber' as const, description: descriptions.craftGoal, isOpenChamber: true }]
    : []
  ),
  ...(canUseScheduleTask
    ? [{ id: 'openchamber:schedule-task', name: 'schedule-task', source: 'openchamber' as const, description: descriptions.scheduleTask, isOpenChamber: true }]
    : []
  ),
  ...(canStartSessionCommand
    ? [{ id: 'openchamber:catch-up', name: 'catch-up', source: 'openchamber' as const, description: descriptions.catchUp, isOpenChamber: true }]
    : []
  ),
  ...(canStartSessionCommand
    ? [{ id: 'openchamber:debug', name: 'debug', source: 'openchamber' as const, description: descriptions.debug, isOpenChamber: true }]
    : []
  ),
  ...(canStartSessionCommand
    ? [{ id: 'openchamber:weigh', name: 'weigh', source: 'openchamber' as const, description: descriptions.weigh, isOpenChamber: true }]
    : []
  ),
  ...(canStartSessionCommand
    ? [{ id: 'openchamber:explore', name: 'explore', source: 'openchamber' as const, description: descriptions.explore, isOpenChamber: true }]
    : []
  ),
];

const filterCommandEntries = (
  commands: readonly CommandInfo[],
  searchQuery: string,
  allowInitCommand: boolean
): CommandInfo[] => {
  const query = searchQuery.toLowerCase();
  const filtered = dedupeCommandAutocompleteEntries(searchQuery
    ? commands.filter((command) =>
        fuzzyMatch(command.name, searchQuery) ||
        (command.description ? fuzzyMatch(command.description, searchQuery) : false)
      )
    : commands
  ).filter((command) => allowInitCommand || command.name !== 'init');

  return filtered.sort((a, b) => {
    const aStartsWith = a.name.toLowerCase().startsWith(query);
    const bStartsWith = b.name.toLowerCase().startsWith(query);
    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;
    return a.name.localeCompare(b.name);
  });
};

export const buildCommandAutocompleteEntries = ({
  commandsWithMetadata,
  skills,
  searchQuery,
  hasSession,
  hasMessagesInCurrentSession,
  canStartSessionCommand,
  canUseReviewHandoffFlow,
  canUseCraftGoal,
  canUseScheduleTask,
  descriptions,
}: CommandBuildOptions): CommandInfo[] => {
  const skillNames = new Set(skills.map((skill) => skill.name));
  const customCommands: CommandInfo[] = commandsWithMetadata.map((command, index) => ({
    id: `opencode:${command.scope ?? 'global'}:${command.name}:${command.agent ?? ''}:${command.model ?? ''}:${index}`,
    name: command.name,
    source: 'opencode',
    description: command.description,
    agent: command.agent ?? undefined,
    model: command.model ?? undefined,
    isBuiltIn: command.name === 'init' || command.name === 'review',
    isSkill: command.source === 'skill' || skillNames.has(command.name),
    scope: command.scope,
  }));
  const skillCommands: CommandInfo[] = skills.map((skill, index) => ({
    id: `skill:${skill.scope}:${skill.source ?? 'opencode'}:${skill.name}:${index}`,
    name: skill.name,
    source: 'skill',
    description: skill.description,
    isSkill: true,
    scope: skill.scope,
  }));
  const allCommands = [
    ...createBuiltInCommands({ hasSession, hasMessagesInCurrentSession, canStartSessionCommand, canUseReviewHandoffFlow, canUseCraftGoal, canUseScheduleTask, descriptions }),
    ...customCommands,
    ...skillCommands,
  ];

  return filterCommandEntries(allCommands, searchQuery, !hasMessagesInCurrentSession);
};

export const buildFallbackCommandAutocompleteEntries = ({
  searchQuery,
  hasSession,
  hasMessagesInCurrentSession,
  canStartSessionCommand,
  canUseReviewHandoffFlow,
  canUseCraftGoal,
  canUseScheduleTask,
  descriptions,
}: Omit<CommandBuildOptions, 'commandsWithMetadata' | 'skills'>): CommandInfo[] => filterCommandEntries(
  createBuiltInCommands({ hasSession, hasMessagesInCurrentSession, canStartSessionCommand, canUseReviewHandoffFlow, canUseCraftGoal, canUseScheduleTask, descriptions }),
  searchQuery,
  !hasMessagesInCurrentSession
);

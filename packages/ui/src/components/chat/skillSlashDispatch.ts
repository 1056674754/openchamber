import { parseSlashInvocation } from '@/sync/slash-routing';

export type SlashSkillDispatchCommand = {
    readonly name: string;
    readonly source?: string;
};

export type SlashSkillDispatchSkill = {
    readonly name: string;
    readonly opencodeSynced?: boolean;
};

type SlashSkillDispatchSources = {
    readonly commands: readonly SlashSkillDispatchCommand[];
    readonly skills: readonly SlashSkillDispatchSkill[];
};

export type SlashSkillDispatch =
    | {
        readonly kind: 'dispatch';
        readonly skillName: string;
        readonly visibleText: string;
        readonly instructionText: string;
    }
    | {
        readonly kind: 'unsynced';
        readonly skillName: string;
    };

const normalizeSlashName = (name: string): string => name.trim().toLowerCase();

const findSkill = (rawName: string, sources: SlashSkillDispatchSources): SlashSkillDispatchSkill | null => {
    const normalizedName = normalizeSlashName(rawName);
    if (!normalizedName) return null;

    for (const skill of sources.skills) {
        if (normalizeSlashName(skill.name) === normalizedName) {
            return skill;
        }
    }

    for (const command of sources.commands) {
        if (command.source === 'skill' && normalizeSlashName(command.name) === normalizedName) {
            return { name: command.name };
        }
    }

    return null;
};

const hasRealCommand = (rawName: string, sources: SlashSkillDispatchSources): boolean => {
    const normalizedName = normalizeSlashName(rawName);
    return sources.commands.some((command) => (
        command.source !== 'skill' && normalizeSlashName(command.name) === normalizedName
    ));
};

export const buildSlashSkillDispatch = (
    content: string,
    sources: SlashSkillDispatchSources,
): SlashSkillDispatch | null => {
    const invocation = parseSlashInvocation(content.trimStart());
    if (!invocation || hasRealCommand(invocation.name, sources)) {
        return null;
    }

    const skill = findSkill(invocation.name, sources);
    if (!skill) return null;

    if (skill.opencodeSynced === false) {
        return { kind: 'unsynced', skillName: skill.name };
    }

    const userRequest = invocation.arguments.trim();
    const visibleText = userRequest || `Use the ${skill.name} skill.`;

    return {
        kind: 'dispatch',
        skillName: skill.name,
        visibleText,
        instructionText: [
            `The user selected the \`${skill.name}\` skill via slash syntax.`,
            `Call the skill tool with the exact skill name \`${skill.name}\` before responding.`,
            'Treat the visible user request as the arguments or context for that skill.',
        ].join(' '),
    };
};

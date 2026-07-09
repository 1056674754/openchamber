import { parseSlashInvocation } from '@/sync/slash-routing';

export type SlashSkillDispatchCommand = {
    readonly name: string;
    readonly source?: string;
};

export type SlashSkillDispatchSkill = {
    readonly name: string;
};

type SlashSkillDispatchSources = {
    readonly commands: readonly SlashSkillDispatchCommand[];
    readonly skills: readonly SlashSkillDispatchSkill[];
};

export type SlashSkillDispatch = {
    readonly skillName: string;
    readonly visibleText: string;
    readonly instructionText: string;
};

const normalizeSlashName = (name: string): string => name.trim().toLowerCase();

const findSkillName = (rawName: string, sources: SlashSkillDispatchSources): string | null => {
    const normalizedName = normalizeSlashName(rawName);
    if (!normalizedName) return null;

    for (const skill of sources.skills) {
        if (normalizeSlashName(skill.name) === normalizedName) {
            return skill.name;
        }
    }

    for (const command of sources.commands) {
        if (command.source === 'skill' && normalizeSlashName(command.name) === normalizedName) {
            return command.name;
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

    const skillName = findSkillName(invocation.name, sources);
    if (!skillName) return null;

    const userRequest = invocation.arguments.trim();
    const visibleText = userRequest || `Use the ${skillName} skill.`;

    return {
        skillName,
        visibleText,
        instructionText: [
            `The user selected the \`${skillName}\` skill via slash syntax.`,
            `Call the skill tool with the exact skill name \`${skillName}\` before responding.`,
            'Treat the visible user request as the arguments or context for that skill.',
        ].join(' '),
    };
};

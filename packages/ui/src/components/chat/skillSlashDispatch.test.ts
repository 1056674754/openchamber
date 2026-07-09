import { describe, expect, test } from 'bun:test';

import { buildSlashSkillDispatch } from './skillSlashDispatch';

describe('skill slash dispatch', () => {
    test('rewrites a leading slash skill into a visible request plus skill instruction', () => {
        const dispatch = buildSlashSkillDispatch('/saas-app-ui-guardrail 用这个skill 重新计划', {
            commands: [],
            skills: [{ name: 'saas-app-ui-guardrail' }],
        });

        expect(dispatch?.skillName).toBe('saas-app-ui-guardrail');
        expect(dispatch?.visibleText).toBe('用这个skill 重新计划');
        expect(dispatch?.visibleText.startsWith('/')).toBe(false);
        expect(dispatch?.instructionText).toContain('`saas-app-ui-guardrail`');
        expect(dispatch?.instructionText).toContain('Call the skill tool');
    });

    test('uses a visible fallback when the slash skill has no arguments', () => {
        const dispatch = buildSlashSkillDispatch('/saas-app-ui-guardrail ', {
            commands: [],
            skills: [{ name: 'saas-app-ui-guardrail' }],
        });

        expect(dispatch?.visibleText).toBe('Use the saas-app-ui-guardrail skill.');
    });

    test('does not rewrite a real slash command with the same name', () => {
        const dispatch = buildSlashSkillDispatch('/deploy production', {
            commands: [{ name: 'deploy', source: 'opencode' }],
            skills: [{ name: 'deploy' }],
        });

        expect(dispatch).toBeNull();
    });

    test('rewrites skill-shaped command entries when no real command shadows them', () => {
        const dispatch = buildSlashSkillDispatch('/project-review check these docs', {
            commands: [{ name: 'project-review', source: 'skill' }],
            skills: [],
        });

        expect(dispatch?.skillName).toBe('project-review');
        expect(dispatch?.visibleText).toBe('check these docs');
    });

    test('resolves skill names case-insensitively while preserving canonical casing', () => {
        const dispatch = buildSlashSkillDispatch('/lark-openapi-explorer list approvals', {
            commands: [],
            skills: [{ name: 'Lark-OpenApi-Explorer' }],
        });

        expect(dispatch?.skillName).toBe('Lark-OpenApi-Explorer');
    });
});

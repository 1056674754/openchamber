import { describe, expect, test } from 'bun:test';

import { buildSlashSkillDispatch } from './skillSlashDispatch';

describe('skill slash dispatch', () => {
    test('returns unsynced when the matched skill is known to be missing from OpenCode', () => {
        const dispatch = buildSlashSkillDispatch('/foo arg', {
            commands: [],
            skills: [{ name: 'foo', opencodeSynced: false }],
        });

        expect(dispatch).toEqual({ kind: 'unsynced', skillName: 'foo' });
    });

    test('dispatches when the matched skill is synced with OpenCode', () => {
        const dispatch = buildSlashSkillDispatch('/foo arg', {
            commands: [],
            skills: [{ name: 'foo', opencodeSynced: true }],
        });

        expect(dispatch?.kind).toBe('dispatch');
        if (dispatch?.kind !== 'dispatch') return;
        expect(dispatch.skillName).toBe('foo');
        expect(dispatch.visibleText).toBe('arg');
        expect(typeof dispatch.instructionText).toBe('string');
    });

    test('dispatches when the matched skill sync status is unknown', () => {
        const dispatch = buildSlashSkillDispatch('/foo arg', {
            commands: [],
            skills: [{ name: 'foo' }],
        });

        expect(dispatch?.kind).toBe('dispatch');
        if (dispatch?.kind !== 'dispatch') return;
        expect(dispatch.skillName).toBe('foo');
        expect(dispatch.visibleText).toBe('arg');
        expect(typeof dispatch.instructionText).toBe('string');
    });

    test('returns null when no skill matches the invocation', () => {
        const dispatch = buildSlashSkillDispatch('/foo arg', {
            commands: [],
            skills: [],
        });

        expect(dispatch).toBeNull();
    });

    test('returns null when a real command shadows a matching skill', () => {
        const dispatch = buildSlashSkillDispatch('/undo', {
            commands: [{ name: 'undo', source: 'opencode' }],
            skills: [{ name: 'undo', opencodeSynced: false }],
        });

        expect(dispatch).toBeNull();
    });

    test('rewrites a leading slash skill into a visible request plus skill instruction', () => {
        const dispatch = buildSlashSkillDispatch('/saas-app-ui-guardrail 用这个skill 重新计划', {
            commands: [],
            skills: [{ name: 'saas-app-ui-guardrail' }],
        });

        expect(dispatch?.kind).toBe('dispatch');
        if (dispatch?.kind !== 'dispatch') return;
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

        expect(dispatch?.kind).toBe('dispatch');
        if (dispatch?.kind !== 'dispatch') return;
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

        expect(dispatch?.kind).toBe('dispatch');
        if (dispatch?.kind !== 'dispatch') return;
        expect(dispatch?.skillName).toBe('project-review');
        expect(dispatch?.visibleText).toBe('check these docs');
    });

    test('resolves skill names case-insensitively while preserving canonical casing', () => {
        const dispatch = buildSlashSkillDispatch('/lark-openapi-explorer list approvals', {
            commands: [],
            skills: [{ name: 'Lark-OpenApi-Explorer' }],
        });

        expect(dispatch?.kind).toBe('dispatch');
        if (dispatch?.kind !== 'dispatch') return;
        expect(dispatch?.skillName).toBe('Lark-OpenApi-Explorer');
    });
});

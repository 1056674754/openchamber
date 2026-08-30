import { describe, expect, test } from 'bun:test';

import { buildPullRequestTemplateBlock, formatRecentCommitSubjects, PULL_REQUEST_TEMPLATE_PATHS } from './gitApi';
import { renderMagicPrompt } from './magicPrompts';

describe('repository-aware generated Git text', () => {
  test('samples repository commit style without inventing history', () => {
    expect(formatRecentCommitSubjects([{ message: 'feat: one' }, { message: '修复：二' }]))
      .toBe('- feat: one\n- 修复：二');
    expect(formatRecentCommitSubjects([])).toBe('(no commits yet)');
  });

  test('includes GitHub and GitLab default template locations', () => {
    expect(PULL_REQUEST_TEMPLATE_PATHS).toContain('.github/PULL_REQUEST_TEMPLATE.md');
    expect(PULL_REQUEST_TEMPLATE_PATHS).toContain('.gitlab/merge_request_templates/Default.md');
  });

  test('isolates template content from generation instructions', () => {
    const block = buildPullRequestTemplateBlock('.github/PULL_REQUEST_TEMPLATE.md', '# Summary\n- [ ] Tested');
    expect(block.startsWith('\n\nRepository pull request template')).toBe(true);
    expect(block).toContain('----- BEGIN PULL REQUEST TEMPLATE -----\n# Summary\n- [ ] Tested\n----- END PULL REQUEST TEMPLATE -----');
  });

  test('renders recent commits and separated PR context/template blocks', async () => {
    const commit = await renderMagicPrompt('git.commit.generate.instructions', {
      selected_files: '- src/a.ts',
      recent_commits: '- fix: recent',
    });
    expect(commit).toContain('Recent commits on this branch (newest first):\n- fix: recent');

    const pr = await renderMagicPrompt('git.pr.generate.instructions', {
      base_branch: 'main', head_branch: 'feature', commits: '- abc change', changed_files: '- src/a.ts',
      additional_context_block: '\n\nAdditional context:\ncontext',
      pr_template_block: '\n\n----- BEGIN PULL REQUEST TEMPLATE -----\n# Summary\n----- END PULL REQUEST TEMPLATE -----',
    });
    expect(pr).toContain('- src/a.ts\n\nAdditional context:');
    expect(pr).toContain('\n\n----- BEGIN PULL REQUEST TEMPLATE -----');
  });
});

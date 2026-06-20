import { describe, expect, test } from 'bun:test';
import { getMainWorkspaceSectionForRender } from './mainWorkspaceSection';

type TestSection = {
  project: {
    id: string;
  };
};

const section = (id: string): TestSection => ({
  project: { id },
});

describe('getMainWorkspaceSectionForRender', () => {
  test('does not fall back to another project while searching an active workspace', () => {
    expect(getMainWorkspaceSectionForRender([section('project-b')], 'project-a', true)).toBeNull();
  });

  test('keeps the active project when it is present in filtered search results', () => {
    const activeSection = section('project-a');

    expect(getMainWorkspaceSectionForRender([activeSection, section('project-b')], 'project-a', true)).toBe(activeSection);
  });

  test('keeps the old first-section fallback outside search', () => {
    const fallbackSection = section('project-b');

    expect(getMainWorkspaceSectionForRender([fallbackSection], 'project-a', false)).toBe(fallbackSection);
  });
});

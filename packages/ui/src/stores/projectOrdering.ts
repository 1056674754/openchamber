type OrderedProject = {
  id: string;
};

export const reorderProjectList = <T extends OrderedProject>(
  projects: T[],
  fromIndex: number,
  toIndex: number,
): T[] | null => {
  if (
    fromIndex < 0 ||
    fromIndex >= projects.length ||
    toIndex < 0 ||
    toIndex >= projects.length ||
    fromIndex === toIndex
  ) {
    return null;
  }

  const nextProjects = [...projects];
  const [moved] = nextProjects.splice(fromIndex, 1);
  if (!moved) {
    return null;
  }

  nextProjects.splice(toIndex, 0, moved);
  return nextProjects;
};

export const reorderProjectListById = <T extends OrderedProject>(
  projects: T[],
  activeProjectId: string,
  overProjectId: string,
): T[] | null => {
  if (!activeProjectId || !overProjectId || activeProjectId === overProjectId) {
    return null;
  }

  const fromIndex = projects.findIndex((project) => project.id === activeProjectId);
  const toIndex = projects.findIndex((project) => project.id === overProjectId);
  return reorderProjectList(projects, fromIndex, toIndex);
};

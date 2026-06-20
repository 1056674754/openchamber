type ProjectSectionRef = {
  project: {
    id: string;
  };
};

export const getMainWorkspaceSectionForRender = <T extends ProjectSectionRef>(
  sectionsForRender: readonly T[],
  activeProjectId: string | null,
  hasSessionSearchQuery: boolean,
): T | null => {
  if (activeProjectId) {
    const activeSection = sectionsForRender.find((section) => section.project.id === activeProjectId);
    if (activeSection) return activeSection;
    if (hasSessionSearchQuery) return null;
  }

  return sectionsForRender[0] ?? null;
};

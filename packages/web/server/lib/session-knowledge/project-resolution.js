import path from 'path';

const normalize = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const resolved = path.resolve(value.trim()).replace(/\\/g, '/');
  return resolved.length > 1 ? resolved.replace(/\/+$/, '') : resolved;
};

const contains = (root, candidate) => candidate === root || candidate.startsWith(`${root}/`);

/** Resolve a Session/worktree directory to the registered project that owns knowledge. */
export const resolveProjectKnowledgeOwnerPath = async ({
  directory,
  projects,
  resolvePrimaryWorktreeRoot,
}) => {
  const candidate = normalize(directory);
  if (!candidate) return null;

  const normalizedProjects = (Array.isArray(projects) ? projects : [])
    .map((project) => ({ project, path: normalize(project?.path) }))
    .filter((entry) => entry.path);
  const direct = normalizedProjects
    .filter((entry) => contains(entry.path, candidate))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (direct) return direct.project.path;

  const primary = await resolvePrimaryWorktreeRoot(candidate).catch(() => ({ root: candidate }));
  const primaryRoot = normalize(primary?.root);
  if (!primaryRoot) return null;
  return normalizedProjects.find((entry) => entry.path === primaryRoot)?.project.path ?? null;
};

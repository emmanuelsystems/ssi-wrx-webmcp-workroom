export const PROJECTS_STORAGE_KEY = "ssi-wrx-workroom-projects-v1";

export function normalizeProject(project, index = 0) {
  return {
    id: project?.id ?? `project-${index + 1}`,
    name: project?.name?.trim() || `Project ${index + 1}`,
    description: project?.description?.trim() || "",
    createdAt: project?.createdAt ?? new Date().toISOString(),
    archived: project?.archived === true,
  };
}

export function normalizeProjects(projects) {
  if (!Array.isArray(projects)) return [];
  const seen = new Set();
  return projects
    .map((project, index) => normalizeProject(project, index))
    .filter((project) => {
      if (seen.has(project.id)) return false;
      seen.add(project.id);
      return true;
    });
}

// Projects organize Episodes only; future project context sources must never
// be injected into an Episode without an explicit, Episode-scoped proposal.

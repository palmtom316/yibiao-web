export function resolveActiveProjectId(input: {
  projectsLoading: boolean;
  configLoading: boolean;
  configError: boolean;
  projects: Array<{ id: number }> | undefined;
  hint: number | null | undefined;
}): { ready: boolean; id: number | null | undefined; fallbackToFirst: boolean } {
  if (input.projectsLoading || input.configLoading) return { ready: false, id: undefined, fallbackToFirst: false };
  if (input.configError && input.hint === undefined) return { ready: false, id: undefined, fallbackToFirst: false };
  const list = input.projects ?? [];
  const hint = input.hint ?? null;
  if (hint != null && list.some((project) => project.id === hint)) return { ready: true, id: hint, fallbackToFirst: false };
  if (list.length > 0) return { ready: true, id: list[0]!.id, fallbackToFirst: true };
  return { ready: true, id: null, fallbackToFirst: false };
}

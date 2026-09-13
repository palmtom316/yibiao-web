// 项目上下文：持当前活跃项目 id，注入到 http X-Project-Id 头 + SSE ?projectId= 查询。
// 登录后挂载（AppProviders 内）。boot 时按 config.activeProjectId 提示 → 否则首个项目 → 否则 null。
// 切换项目：POST /projects/:id/activate 持久化 → 更新模块变量 + SSE 重连 + invalidate 工作区查询。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activateProject,
  createProject,
  fetchProjects,
  type Project,
} from '../shared/api/projects';
import { setActiveProjectId } from '../shared/api/http';
import { sseManager } from '../shared/api/sse';
import { useConfig } from '../shared/api/config';
import { resolveActiveProjectId } from './resolveActiveProject';

interface ProjectContextValue {
  projects: Project[];
  activeProjectId: number | null;
  activeProject: Project | null;
  loading: boolean;
  resolved: boolean;
  projectEpoch: number;
  switchTo: (id: number) => Promise<void>;
  createAndSwitch: (name: string, description?: string) => Promise<Project>;
  refresh: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: config, isLoading: configLoading, isError: configError } = useConfig();
  const { data: projects, isLoading: projectsLoading, isError: projectsError } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });
  const list = projects ?? [];

  // undefined = 尚未完成首次解析；number = 已选定；null = 无项目。
  const [activeId, setActiveId] = useState<number | null | undefined>(undefined);
  const [epoch, setEpoch] = useState(0);
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (resolvedRef.current) return;
    const resolved = resolveActiveProjectId({
      projectsLoading: projectsLoading || (projectsError && !projects),
      configLoading: configLoading || (configError && config === undefined),
      configError,
      projects,
      hint: config?.activeProjectId,
    });
    if (!resolved.ready) return;
    resolvedRef.current = true;
    if (resolved.fallbackToFirst && resolved.id != null) {
      void activateProject(resolved.id).catch(() => undefined);
    }
    setActiveId(resolved.id ?? null);
  }, [projectsLoading, projectsError, projects, configLoading, configError, config, config?.activeProjectId]);

  useEffect(() => {
    if (activeId === undefined || projectsLoading) return;
    if (activeId != null && list.some((project) => project.id === activeId)) return;
    if (list.length > 0) {
      const target = list[0]!.id;
      void activateProject(target).catch(() => undefined);
      setActiveId(target);
      return;
    }
    if (activeId != null) setActiveId(null);
  }, [activeId, list, projectsLoading]);

  // 应用 activeId 变更：模块变量 + SSE 重连 + 工作区查询失效重取。
  useEffect(() => {
    if (activeId === undefined) return;
    setActiveProjectId(activeId);
    sseManager.reconnect();
    void qc.invalidateQueries();
    setEpoch((e) => e + 1);
  }, [activeId, qc]);

  const switchTo = useCallback(
    async (id: number): Promise<void> => {
      await activateProject(id);
      // 同步置 http header，避免新挂载的子页（如技术方案/汇总页）mount 效应在 context effect 之前读到旧 projectId。
      setActiveProjectId(id);
      setActiveId(id);
    },
    [],
  );

  const createAndSwitch = useCallback(
    async (name: string, description?: string): Promise<Project> => {
      const created = await createProject({ name, description });
      await qc.invalidateQueries({ queryKey: ['projects'] });
      await switchTo(created.id);
      return created;
    },
    [qc, switchTo],
  );

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['projects'] });
  }, [qc]);

  const value = useMemo<ProjectContextValue>(() => {
    const active = activeId != null ? list.find((p) => p.id === activeId) ?? null : null;
    return {
      projects: list,
      activeProjectId: activeId ?? null,
      activeProject: active,
      loading: projectsLoading || configLoading || activeId === undefined,
      resolved: activeId !== undefined,
      projectEpoch: epoch,
      switchTo,
      createAndSwitch,
      refresh,
    };
  }, [list, activeId, projectsLoading, epoch, switchTo, createAndSwitch, refresh]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject 必须在 ProjectProvider 内使用');
  return ctx;
}

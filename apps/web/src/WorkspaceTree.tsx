import { lazy, Suspense, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  FolderOpen,
  Loader2,
} from "lucide-react";

import type { ThreadSummary } from "@napier/contracts";
import { listRecentWorkspaces } from "./api";
import { formatApiErrorMessage } from "./api-error";
import { copy } from "./copy";
import { pickWorkspaceDirectory } from "./workspace-directory-api";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";
import { listWorkspaceThreads } from "./workspace-tree-api";
import { WorkspaceThreadPreviews } from "./WorkspaceThreadPreviews";

const LazyThreadList = lazy(() =>
  import("./ThreadList").then(({ ThreadList }) => ({ default: ThreadList })),
);

interface RecentWorkspace {
  root: string;
  name: string;
}

/**
 * Merged workspace + sessions sidebar tree (DeepSeek-Harness style). The active
 * workspace keeps a stable position and can expand independently. Inactive
 * folders use a read-only summary endpoint, so browsing them never rebinds the
 * runtime. Selecting one of their sessions performs one atomic workspace +
 * thread switch while the app shell remains mounted.
 */
export interface WorkspaceTreeProps {
  currentRoot: string;
  threads: ThreadSummary[];
  selectedThreadId: string | undefined;
  busyThreadId: string | undefined;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
  onWorkspaceSwitch(root: string, threadId?: string): Promise<void>;
  searchQuery?: string;
}

export function WorkspaceTree({
  currentRoot,
  threads,
  selectedThreadId,
  busyThreadId,
  onSelect,
  onTrash,
  onWorkspaceSwitch,
  searchQuery = "",
}: WorkspaceTreeProps) {
  const [projects, setProjects] = useState<RecentWorkspace[]>([]);
  const [switching, setSwitching] = useState<string | undefined>(undefined);
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(
    () => new Set([currentRoot]),
  );
  const [threadCache, setThreadCache] = useState<
    Record<string, ThreadSummary[]>
  >({});
  const [loadingRoots, setLoadingRoots] = useState<Set<string>>(new Set());
  const [failedRoots, setFailedRoots] = useState<Set<string>>(new Set());
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
  const [pickerError, setPickerError] = useState<string>();

  useEffect(() => {
    let active = true;
    void listRecentWorkspaces()
      .then((entries) => {
        if (active) setProjects(entries);
      })
      .catch(() => {
        if (active) setProjects([]);
      });
    return () => {
      active = false;
    };
  }, [currentRoot]);

  useEffect(() => {
    setExpandedRoots((current) => new Set(current).add(currentRoot));
    setThreadCache((current) => ({ ...current, [currentRoot]: threads }));
  }, [currentRoot, threads]);

  const orderedProjects = stableWorkspaceProjects(currentRoot, projects);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleProjects = normalizedSearch
    ? orderedProjects.filter((project) => {
        const projectThreads =
          project.root === currentRoot ? threads : threadCache[project.root];
        return (
          `${project.name} ${project.root}`
            .toLocaleLowerCase()
            .includes(normalizedSearch) ||
          projectThreads === undefined ||
          projectThreads.some((thread) =>
            `${thread.title} ${thread.lastMessage}`
              .toLocaleLowerCase()
              .includes(normalizedSearch),
          )
        );
      })
    : orderedProjects;

  const switchTo = async (root: string, threadId?: string) => {
    if (root === currentRoot || switching || pickingWorkspace) return;
    setSwitching(root);
    try {
      await onWorkspaceSwitch(root, threadId);
      setSwitching(undefined);
    } catch {
      setSwitching(undefined);
    }
  };

  const toggleRoot = async (root: string) => {
    const open = expandedRoots.has(root);
    setExpandedRoots((current) => {
      const next = new Set(current);
      if (open) next.delete(root);
      else next.add(root);
      return next;
    });
    if (open || root === currentRoot || threadCache[root]) return;
    setLoadingRoots((current) => new Set(current).add(root));
    setFailedRoots((current) => {
      const next = new Set(current);
      next.delete(root);
      return next;
    });
    try {
      const summaries = await listWorkspaceThreads(root);
      setThreadCache((current) => ({ ...current, [root]: summaries }));
    } catch {
      setFailedRoots((current) => new Set(current).add(root));
    } finally {
      setLoadingRoots((current) => {
        const next = new Set(current);
        next.delete(root);
        return next;
      });
    }
  };

  const chooseWorkspace = async () => {
    if (pickingWorkspace || switching) return;
    setPickingWorkspace(true);
    setPickerError(undefined);
    try {
      const selection = await pickWorkspaceDirectory();
      if (
        !selection.cancelled &&
        selection.path &&
        selection.path !== currentRoot
      ) {
        setSwitching(selection.path);
        await onWorkspaceSwitch(selection.path);
      }
    } catch (error) {
      setPickerError(formatApiErrorMessage(error));
    } finally {
      setSwitching(undefined);
      setPickingWorkspace(false);
    }
  };

  return (
    <div className="workspace-tree">
      <div className="nav-section-heading">
        <span>{copy.workspaceSurface.chipLabel}</span>
        <span className="workspace-tree-heading-actions">
          <button
            type="button"
            className="workspace-tree-add"
            aria-label={t.addWorkspace}
            aria-busy={pickingWorkspace}
            disabled={pickingWorkspace || Boolean(switching)}
            onClick={() => void chooseWorkspace()}
          >
            {pickingWorkspace ? (
              <Loader2 size={15} aria-hidden="true" className="spin" />
            ) : (
              <FolderPlus size={15} aria-hidden="true" />
            )}
            <span role="tooltip">{t.addWorkspace}</span>
          </button>
        </span>
      </div>
      {pickerError ? (
        <p className="workspace-tree-picker-error" role="alert">
          {pickerError}
        </p>
      ) : null}
      <ul className="workspace-tree-list">
        {visibleProjects.map((project) => {
          const current = project.root === currentRoot;
          const open = expandedRoots.has(project.root);
          const isSwitching = switching === project.root;
          const isLoading = loadingRoots.has(project.root);
          const allProjectThreads = current
            ? threads
            : (threadCache[project.root] ?? []);
          const projectThreads = normalizedSearch
            ? allProjectThreads.filter((thread) =>
                `${thread.title} ${thread.lastMessage}`
                  .toLocaleLowerCase()
                  .includes(normalizedSearch),
              )
            : allProjectThreads;
          return (
            <li
              className={`workspace-tree-node ${current ? "is-current" : ""}`}
              key={project.root}
            >
              <div
                className={`workspace-tree-folder ${current ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  className="workspace-tree-toggle"
                  aria-expanded={open}
                  aria-label={`${
                    open ? t.collapseWorkspace : t.expandWorkspace
                  } ${project.name}`}
                  onClick={() => void toggleRoot(project.root)}
                >
                  {open ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                <button
                  type="button"
                  className="workspace-tree-project"
                  title={project.root}
                  disabled={Boolean(switching) || pickingWorkspace}
                  onClick={() =>
                    current
                      ? void toggleRoot(project.root)
                      : void switchTo(project.root)
                  }
                >
                  {isSwitching || isLoading ? (
                    <Loader2 size={15} aria-hidden="true" className="spin" />
                  ) : open ? (
                    <FolderOpen size={15} aria-hidden="true" />
                  ) : (
                    <Folder size={15} aria-hidden="true" />
                  )}
                  <span>{project.name}</span>
                </button>
              </div>
              {open ? (
                <div
                  className={`workspace-tree-threads ${current ? "is-current" : "is-preview"}`}
                >
                  {failedRoots.has(project.root) ? (
                    <p className="workspace-tree-message">
                      {t.loadSessionsError}
                    </p>
                  ) : isLoading && projectThreads.length === 0 ? (
                    <p className="workspace-tree-message">
                      {t.loadingSessions}
                    </p>
                  ) : current ? (
                    <Suspense fallback={<div className="thread-list" />}>
                      <LazyThreadList
                        threads={projectThreads}
                        selectedThreadId={selectedThreadId}
                        busyThreadId={busyThreadId}
                        onSelect={onSelect}
                        onTrash={onTrash}
                      />
                    </Suspense>
                  ) : (
                    <WorkspaceThreadPreviews
                      threads={projectThreads}
                      onSelect={(threadId) =>
                        void switchTo(project.root, threadId)
                      }
                    />
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function stableWorkspaceProjects(
  currentRoot: string,
  projects: RecentWorkspace[],
): RecentWorkspace[] {
  const seen = new Set<string>();
  const ordered: RecentWorkspace[] = [];
  for (const project of projects) {
    if (seen.has(project.root)) continue;
    seen.add(project.root);
    ordered.push(project);
  }
  if (!seen.has(currentRoot)) {
    ordered.push({ root: currentRoot, name: basename(currentRoot) });
  }
  return ordered;
}

function basename(root: string): string {
  const parts = root.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) ?? root;
}

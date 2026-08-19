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
import { copy } from "./copy";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";
import type { TrashedThreadReceipt } from "./use-thread-trash";
import { listWorkspaceThreads } from "./workspace-tree-api";
import { WorkspaceThreadPreviews } from "./WorkspaceThreadPreviews";

const LazyThreadList = lazy(() => import("./ThreadList"));
const LazyWorkspaceFolderPicker = lazy(() => import("./WorkspaceFolderPicker"));

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
  trashedThread: TrashedThreadReceipt | undefined;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
  onRestore(): void;
  onWorkspaceSwitch(root: string, threadId?: string): Promise<void>;
  onOpenWorkspaceSettings(): void;
}

export function WorkspaceTree({
  currentRoot,
  threads,
  selectedThreadId,
  busyThreadId,
  trashedThread,
  onSelect,
  onTrash,
  onRestore,
  onWorkspaceSwitch,
  onOpenWorkspaceSettings,
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
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const switchTo = async (root: string, threadId?: string) => {
    if (root === currentRoot || switching) return;
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

  return (
    <div className="workspace-tree">
      <div className="nav-section-heading">
        <span>{copy.workspaceSurface.chipLabel}</span>
        <span className="workspace-tree-heading-actions">
          <span className="workspace-tree-heading-count">
            {String(orderedProjects.length).padStart(2, "0")}
          </span>
          <button
            type="button"
            className="workspace-tree-add"
            aria-label={t.addWorkspace}
            onClick={() => setPickerOpen(true)}
          >
            <FolderPlus size={15} aria-hidden="true" />
            <span role="tooltip">{t.addWorkspace}</span>
          </button>
        </span>
      </div>
      <ul className="workspace-tree-list">
        {orderedProjects.map((project) => {
          const current = project.root === currentRoot;
          const open = expandedRoots.has(project.root);
          const isSwitching = switching === project.root;
          const isLoading = loadingRoots.has(project.root);
          const projectThreads = current
            ? threads
            : (threadCache[project.root] ?? []);
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
                  disabled={Boolean(switching)}
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
                  {current ? <i>{t.currentBadge}</i> : null}
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
                        trashedThread={trashedThread}
                        onSelect={onSelect}
                        onTrash={onTrash}
                        onRestore={onRestore}
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
      {pickerOpen ? (
        <Suspense fallback={null}>
          <LazyWorkspaceFolderPicker
            currentRoot={currentRoot}
            onClose={() => setPickerOpen(false)}
            onManualEntry={onOpenWorkspaceSettings}
            onWorkspaceSwitch={onWorkspaceSwitch}
          />
        </Suspense>
      ) : null}
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
  const parts = root.split("/").filter(Boolean);
  return parts.at(-1) ?? root;
}

export default WorkspaceTree;

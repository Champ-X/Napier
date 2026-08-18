import { lazy, Suspense, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";

import type { ThreadSummary } from "@napier/contracts";
import { listRecentWorkspaces, rebindWorkspaceRoot } from "./api";
import { copy } from "./copy";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";
import type { TrashedThreadReceipt } from "./use-thread-trash";

const LazyThreadList = lazy(() => import("./ThreadList"));

interface RecentWorkspace {
  root: string;
  name: string;
}

/**
 * Merged workspace + sessions sidebar tree (DeepSeek-Harness style). The active
 * workspace root renders as an expanded folder whose sessions nest directly
 * beneath it; every other recently opened folder is a collapsed leaf that
 * switches the runtime onto that folder when clicked (a full rebind + reload,
 * since each workspace keeps its own ledger). This replaces the previously
 * separate "sessions" list and "projects" switcher.
 */
export function WorkspaceTree({
  currentRoot,
  threads,
  selectedThreadId,
  busyThreadId,
  trashedThread,
  onSelect,
  onTrash,
  onRestore,
}: {
  currentRoot: string;
  threads: ThreadSummary[];
  selectedThreadId: string | undefined;
  busyThreadId: string | undefined;
  trashedThread: TrashedThreadReceipt | undefined;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
  onRestore(): void;
}) {
  const [projects, setProjects] = useState<RecentWorkspace[]>([]);
  const [switching, setSwitching] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(true);

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

  const others = dedupeOthers(currentRoot, projects);

  const switchTo = async (root: string) => {
    if (root === currentRoot || switching) return;
    setSwitching(root);
    try {
      await rebindWorkspaceRoot(root);
      window.location.assign(window.location.pathname);
    } catch {
      setSwitching(undefined);
    }
  };

  return (
    <div className="workspace-tree">
      <div className="nav-section-heading">
        <span>{copy.workspaceSurface.chipLabel}</span>
        <span>{String(others.length + 1).padStart(2, "0")}</span>
      </div>
      <ul className="workspace-tree-list">
        <li className="workspace-tree-node is-current">
          <button
            type="button"
            className="workspace-tree-folder is-active"
            aria-expanded={expanded}
            title={currentRoot}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown size={13} aria-hidden="true" className="tree-caret" />
            ) : (
              <ChevronRight
                size={13}
                aria-hidden="true"
                className="tree-caret"
              />
            )}
            <FolderOpen size={14} aria-hidden="true" />
            <span>{basename(currentRoot)}</span>
            <i>{t.currentBadge}</i>
          </button>
          {expanded ? (
            <div className="workspace-tree-threads">
              <Suspense fallback={<div className="thread-list" />}>
                <LazyThreadList
                  threads={threads}
                  selectedThreadId={selectedThreadId}
                  busyThreadId={busyThreadId}
                  trashedThread={trashedThread}
                  onSelect={onSelect}
                  onTrash={onTrash}
                  onRestore={onRestore}
                />
              </Suspense>
            </div>
          ) : null}
        </li>
        {others.map((project) => {
          const isSwitching = switching === project.root;
          return (
            <li className="workspace-tree-node" key={project.root}>
              <button
                type="button"
                className="workspace-tree-folder"
                title={project.root}
                disabled={Boolean(switching)}
                onClick={() => void switchTo(project.root)}
              >
                <span className="tree-caret" aria-hidden="true" />
                {isSwitching ? (
                  <Loader2 size={14} aria-hidden="true" className="spin" />
                ) : (
                  <Folder size={14} aria-hidden="true" />
                )}
                <span>{project.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function dedupeOthers(
  currentRoot: string,
  projects: RecentWorkspace[],
): RecentWorkspace[] {
  const seen = new Set<string>([currentRoot]);
  const others: RecentWorkspace[] = [];
  for (const project of projects) {
    if (seen.has(project.root)) continue;
    seen.add(project.root);
    others.push(project);
  }
  return others;
}

function basename(root: string): string {
  const parts = root.split("/").filter(Boolean);
  return parts.at(-1) ?? root;
}

export default WorkspaceTree;

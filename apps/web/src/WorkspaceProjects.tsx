import { useEffect, useState } from "react";
import { Folder, FolderOpen, Loader2 } from "lucide-react";

import { listRecentWorkspaces, rebindWorkspaceRoot } from "./api";
import { copy } from "./copy";

interface RecentWorkspace {
  root: string;
  name: string;
}

/**
 * Recent-workspaces switcher. Each workspace keeps its own ledger, so the
 * active project's threads render in the ledger list above; this section lists
 * every recently opened folder and switches to one on click (a full runtime
 * rebind + reload), matching the Codex/DeepSeek project switcher.
 */
export function WorkspaceProjects({ currentRoot }: { currentRoot: string }) {
  const [projects, setProjects] = useState<RecentWorkspace[]>([]);
  const [switching, setSwitching] = useState<string | undefined>(undefined);

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

  // Always include the current root even before the registry write lands.
  const seen = new Set<string>();
  const ordered = [
    { root: currentRoot, name: basename(currentRoot) },
    ...projects,
  ].filter((entry) => {
    if (seen.has(entry.root)) return false;
    seen.add(entry.root);
    return true;
  });

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
    <div className="workspace-projects">
      <div className="nav-section-heading">
        <span>{copy.projects.heading}</span>
        <span>{String(ordered.length).padStart(2, "0")}</span>
      </div>
      <ul className="workspace-projects-list">
        {ordered.map((project) => {
          const isCurrent = project.root === currentRoot;
          const isSwitching = switching === project.root;
          return (
            <li key={project.root}>
              <button
                type="button"
                className={isCurrent ? "is-current" : ""}
                title={project.root}
                disabled={isCurrent || Boolean(switching)}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => void switchTo(project.root)}
              >
                {isSwitching ? (
                  <Loader2 size={14} aria-hidden="true" className="spin" />
                ) : isCurrent ? (
                  <FolderOpen size={14} aria-hidden="true" />
                ) : (
                  <Folder size={14} aria-hidden="true" />
                )}
                <span>{project.name}</span>
                {isCurrent ? <i>{copy.projects.current}</i> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function basename(root: string): string {
  const parts = root.split("/").filter(Boolean);
  return parts.at(-1) ?? root;
}

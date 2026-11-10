import { useId } from "react";
import { ChevronDown, Folder } from "lucide-react";

import type { TaskArtifactTarget } from "./task-completion-output-paths";
import { workspaceEvidenceCopy as t } from "./workspace-evidence-copy";
import { WorkspaceFileTree } from "./WorkspaceFileTree";
import { useWorkspaceEvidenceDisclosure } from "./use-workspace-evidence-disclosure";

export function WorkspaceEvidenceFiles({
  workspaceRoot,
  targets,
  secondary,
  onOpenArtifact,
}: {
  workspaceRoot: string;
  targets: TaskArtifactTarget[];
  secondary: boolean;
  onOpenArtifact(path: string): void;
}) {
  const contentId = useId();
  const { contentRef, open, toggle } =
    useWorkspaceEvidenceDisclosure(secondary);
  const name =
    workspaceRoot.split(/[\\/]/u).filter(Boolean).at(-1) ?? workspaceRoot;
  return (
    <section className={`workspace-card${secondary ? " is-secondary" : ""}`}>
      <h3 className="workspace-files-heading">
        {secondary ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={toggle}
          >
            <Folder size={15} aria-hidden="true" />
            <span>{t.files}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        ) : (
          <>
            <Folder size={15} aria-hidden="true" />
            <span>{t.files}</span>
          </>
        )}
      </h3>
      <div className="workspace-card-meta" title={workspaceRoot}>
        <strong>{name}</strong>
        <code>{workspaceRoot}</code>
      </div>
      <div ref={contentRef} id={contentId} hidden={!open}>
        <WorkspaceFileTree
          workspaceRoot={workspaceRoot}
          openablePaths={targets.map((target) => target.path)}
          onOpenFile={onOpenArtifact}
        />
      </div>
    </section>
  );
}

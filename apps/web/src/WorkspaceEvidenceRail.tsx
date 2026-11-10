import { useLayoutEffect, useRef } from "react";
import { Files, PanelRightClose } from "lucide-react";

import type { BootstrapResponse, ThreadDetail } from "@napier/contracts";
import { taskArtifactTargets } from "./task-completion-output-paths";
import { taskNarrative } from "./task-narrative-view-model";
import { workspaceEvidenceCopy as t } from "./workspace-evidence-copy";
import { trapFocusKeyDown } from "./focus-trap";
import { WorkspaceEvidenceFiles } from "./WorkspaceEvidenceFiles";
import { WorkspaceEvidenceResults } from "./WorkspaceEvidenceResults";
import "./workspace-evidence-rail.css";

export interface WorkspaceEvidenceRailProps {
  workspace: BootstrapResponse["workspace"];
  detail: ThreadDetail | undefined;
  onLedgerChanged(): void | Promise<void>;
  onOpenArtifact(path: string): void;
  onClose(): void;
  open?: boolean;
  overlay?: boolean;
}

export function WorkspaceEvidenceRail({
  workspace,
  detail,
  onLedgerChanged,
  onOpenArtifact,
  onClose,
  open = true,
  overlay = false,
}: WorkspaceEvidenceRailProps) {
  const railRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const narrative = detail ? taskNarrative(detail) : undefined;
  const targets = detail
    ? taskArtifactTargets(detail.plans, detail.activePlan, detail.taskNarrative?.deliverables)
    : [];
  const completedItems =
    (narrative?.execution === "ended" || narrative?.phase === "completed") ? narrative.completedItems : [];
  const hasResults = targets.length > 0 || completedItems.length > 0;

  useLayoutEffect(() => {
    if (!open || !overlay || !railRef.current) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    railRef.current.querySelector<HTMLElement>("button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (railRef.current) trapFocusKeyDown(event, railRef.current);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open, overlay]);

  const titleId = "workspace-evidence-rail-title";
  return (
    <aside
      ref={railRef}
      id="workspace-evidence-rail"
      className="workspace-evidence-rail"
      aria-label={overlay ? undefined : t.railLabel}
      aria-labelledby={overlay ? titleId : undefined}
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay ? "true" : undefined}
      hidden={!open}
    >
      <header className="workspace-evidence-heading">
        <Files size={16} aria-hidden="true" />
        <h2 id={titleId}>{t.railTitle}</h2>
        <button
          type="button"
          aria-label={t.hideRail}
          title={t.hideRail}
          onClick={onClose}
        >
          <PanelRightClose size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="workspace-evidence-scroll">
        {hasResults && detail ? (
          <WorkspaceEvidenceResults
            key={detail.thread.id}
            detail={detail}
            workspaceRoot={workspace.root}
            targets={targets}
            completedItems={completedItems}
            completed={(narrative?.execution === "ended" || narrative?.phase === "completed")}
            onLedgerChanged={onLedgerChanged}
            onOpenArtifact={onOpenArtifact}
          />
        ) : (
          <p className="workspace-evidence-empty">{t.noEvidence}</p>
        )}
        <WorkspaceEvidenceFiles
          key={`${workspace.root}:${detail?.thread.id ?? "idle"}`}
          workspaceRoot={workspace.root}
          targets={targets}
          secondary={hasResults}
          onOpenArtifact={onOpenArtifact}
        />
      </div>
    </aside>
  );
}

import { lazy, Suspense, useEffect, useRef } from "react";
import { Files, PanelRightClose } from "lucide-react";

import type { BootstrapResponse, ThreadDetail } from "@napier/contracts";
import { taskArtifactTargets } from "./task-completion-output-paths";
import { taskNarrative } from "./task-narrative-view-model";
import { workspaceEvidenceCopy as t } from "./workspace-evidence-copy";
import { WorkspaceFileTree } from "./WorkspaceFileTree";
import "./workspace-evidence-rail.css";

const LazyTaskCompletionSummary = lazy(() => import("./TaskCompletionSummary"));

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
    ? taskArtifactTargets(detail.plans, detail.activePlan)
    : [];
  const completed = narrative?.phase === "completed";

  useEffect(() => {
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
      if (event.key !== "Tab" || !railRef.current) return;
      const focusable = focusableElements(railRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open, overlay]);

  return (
    <aside
      ref={railRef}
      id="workspace-evidence-rail"
      className="workspace-evidence-rail"
      aria-label={t.railLabel}
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay ? "true" : undefined}
      hidden={!open}
    >
      <div className="workspace-evidence-scroll">
        <section className="workspace-card">
          <header className="workspace-card-heading">
            <div>
              <strong>{t.title}</strong>
              <span>
                <i aria-hidden="true" />
                {t.local}
              </span>
            </div>
            <button
              type="button"
              aria-label={t.hideRail}
              title={t.hideRail}
              onClick={onClose}
            >
              <PanelRightClose size={15} aria-hidden="true" />
            </button>
          </header>
          <div className="workspace-card-meta" title={workspace.root}>
            <strong>{basename(workspace.root)}</strong>
            <code>{workspace.root}</code>
          </div>
          <WorkspaceFileTree
            workspaceRoot={workspace.root}
            openablePaths={targets.map((target) => target.path)}
            onOpenFile={onOpenArtifact}
          />
        </section>

        <section className="workspace-evidence-results">
          <header>
            <Files size={14} aria-hidden="true" />
            <strong>{t.evidence}</strong>
            {targets.length > 0 ? <span>{targets.length}</span> : null}
          </header>
          {completed &&
          detail &&
          narrative &&
          (narrative.completedItems.length > 0 || targets.length > 0) ? (
            <Suspense fallback={null}>
              <LazyTaskCompletionSummary
                completedItems={narrative.completedItems}
                plans={detail.plans}
                activePlan={detail.activePlan}
                threadId={detail.thread.id}
                onLedgerChanged={onLedgerChanged}
                onOpenArtifact={onOpenArtifact}
              />
            </Suspense>
          ) : targets.length > 0 ? (
            <div className="workspace-evidence-output-list">
              {targets.map((target) => (
                <button
                  type="button"
                  key={target.path}
                  title={`${t.openOutput}: ${target.path}`}
                  onClick={() => onOpenArtifact(target.path)}
                >
                  <Files size={14} aria-hidden="true" />
                  <span>{basename(target.path)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="workspace-evidence-empty">{t.noEvidence}</p>
          )}
        </section>
      </div>
    </aside>
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

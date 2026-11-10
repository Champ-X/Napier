import { lazy, Suspense, useId } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileText,
} from "lucide-react";

import type { ThreadDetail } from "@napier/contracts";
import type { TaskArtifactTarget } from "./task-completion-output-paths";
import { workspaceEvidenceCopy as t } from "./workspace-evidence-copy";
import { useWorkspaceEvidenceDisclosure } from "./use-workspace-evidence-disclosure";

const LazyTaskCompletionSummary = lazy(() => import("./TaskCompletionSummary"));

export function WorkspaceEvidenceResults({
  detail,
  workspaceRoot,
  targets,
  completedItems,
  completed,
  onLedgerChanged,
  onOpenArtifact,
}: {
  detail: ThreadDetail;
  workspaceRoot: string;
  targets: TaskArtifactTarget[];
  completedItems: string[];
  completed: boolean;
  onLedgerChanged(): void | Promise<void>;
  onOpenArtifact(path: string): void;
}) {
  const {
    contentRef,
    open: recordOpen,
    toggle,
  } = useWorkspaceEvidenceDisclosure(targets.length > 0);
  const recordId = useId();
  const showRecord =
    completed && (completedItems.length > 0 || targets.length > 0);
  return (
    <section className="workspace-evidence-results">
      <header>
        <h3>{t.results}</h3>
        {targets.length > 0 ? <span>{targets.length}</span> : null}
      </header>
      {targets.length > 0 ? (
        <ul className="workspace-evidence-output-list" role="list">
          {targets.map((target) => {
            const { name, directory, extension, Icon } = outputDisplay(
              target.path,
              workspaceRoot,
            );
            return (
              <li key={target.path}>
                <button
                  type="button"
                  title={target.path}
                  aria-label={`${t.openOutput}: ${target.path}`}
                  onClick={() => onOpenArtifact(target.path)}
                >
                  <span className="workspace-output-icon" aria-hidden="true">
                    <Icon size={20} strokeWidth={1.5} />
                  </span>
                  <span className="workspace-output-copy">
                    <span className="workspace-output-type">
                      {extension || t.file}
                    </span>
                    <strong>{name}</strong>
                    <code>{directory || t.workspaceRoot}</code>
                  </span>
                  <ChevronRight
                    className="workspace-output-open"
                    size={15}
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {showRecord ? (
        <div className="workspace-evidence-record">
          {targets.length > 0 ? (
            <button
              className="workspace-evidence-record-toggle"
              type="button"
              aria-expanded={recordOpen}
              aria-controls={recordId}
              onClick={toggle}
            >
              <span>{t.completionRecord}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          ) : null}
          <div ref={contentRef} id={recordId} hidden={!recordOpen}>
            <Suspense
              fallback={
                <p className="workspace-evidence-empty">{t.loadingRecord}</p>
              }
            >
              <LazyTaskCompletionSummary
                completedItems={completedItems}
                narrative={detail.taskNarrative}
                plans={detail.plans}
                activePlan={detail.activePlan}
                threadId={detail.thread.id}
                onLedgerChanged={onLedgerChanged}
                onOpenArtifact={onOpenArtifact}
              />
            </Suspense>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function outputDisplay(path: string, workspaceRoot: string) {
  const normalized = path.replace(/\\/gu, "/");
  const root = workspaceRoot.replace(/\\/gu, "/").replace(/\/$/u, "");
  const relative = normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
  const segments = relative.split("/");
  const name = segments.pop() || path;
  const extension =
    name.match(/\.([a-z\d]{1,12})$/iu)?.[1]?.toUpperCase() ?? "";
  const Icon = /^(PNG|JPG|JPEG|GIF|WEBP|SVG|AVIF)$/u.test(extension)
    ? FileImage
    : /^(HTML|CSS|JS|TS|TSX|JSX|JSON|PY|SH)$/u.test(extension)
      ? FileCode2
      : /^(MD|TXT|PDF|DOCX|RTF|CSV)$/u.test(extension)
        ? FileText
        : File;
  return { name, directory: segments.join("/"), extension, Icon };
}

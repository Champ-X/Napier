import { RotateCcw, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  WorkspaceProcessRollbackPreview,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
} from "@napier/contracts";

import {
  applyWorkspaceProcessRollback,
  previewWorkspaceProcessRollback,
} from "./workspace-process-api";
import { workspaceProcessCopy as copy } from "./workspace-process-copy";

export function WorkspaceProcessRollback({
  threadId,
  session,
  onApplied,
}: {
  threadId: string;
  session: WorkspaceProcessSession;
  onApplied(): void | Promise<void>;
}) {
  const [preview, setPreview] = useState<WorkspaceProcessRollbackPreview>();
  const [result, setResult] = useState<WorkspaceProcessRollbackResult>();
  const [busy, setBusy] = useState<"preview" | "apply">();
  const [error, setError] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    setPreview(undefined);
    setResult(undefined);
    setBusy(undefined);
    setError(false);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = undefined;
    };
  }, [threadId, session.id]);

  const review = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("preview");
    setPreview(undefined);
    setResult(undefined);
    setError(false);
    try {
      const next = await previewWorkspaceProcessRollback(
        threadId,
        session.id,
        controller.signal,
      );
      if (!controller.signal.aborted) setPreview(next);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setBusy(undefined);
      }
    }
  };

  const apply = async () => {
    if (!preview) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("apply");
    setError(false);
    try {
      const next = await applyWorkspaceProcessRollback(
        threadId,
        session.id,
        preview.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPreview(undefined);
      setResult(next);
      await onApplied();
    } catch {
      if (!controller.signal.aborted) {
        setPreview(undefined);
        setError(true);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setBusy(undefined);
      }
    }
  };

  if (
    session.workspaceRollbackAvailable !== true &&
    !preview &&
    !result &&
    !error
  ) {
    return null;
  }

  return (
    <div className="process-rollback">
      {session.workspaceRollbackAvailable === true && !preview && !result ? (
        <button
          type="button"
          className="secondary-button"
          disabled={busy !== undefined}
          onClick={() => void review()}
        >
          <RotateCcw size={12} aria-hidden="true" />
          {busy === "preview" ? copy.reviewingRollback : copy.reviewRollback}
        </button>
      ) : null}
      {preview ? (
        <section aria-labelledby={`process-rollback-${session.id}`}>
          <header>
            <ShieldAlert size={14} aria-hidden="true" />
            <div>
              <strong id={`process-rollback-${session.id}`}>
                {copy.rollbackTitle}
              </strong>
              <span>{preview.contentSha256.slice(0, 12)}</span>
            </div>
          </header>
          <p>{copy.rollbackBody}</p>
          {session.workspaceWriteScopeStatus !== "within_scope" ? (
            <p className="process-rollback-warning">
              {copy.rollbackOutsideScope}
            </p>
          ) : null}
          <dl>
            <div>
              <dt>{copy.rollbackScopeCount}</dt>
              <dd>{preview.scopeCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{copy.rollbackEntryCount}</dt>
              <dd>
                {(preview.fileCount + preview.directoryCount).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>{copy.rollbackBytes}</dt>
              <dd>{preview.bytes.toLocaleString()}</dd>
            </div>
          </dl>
          <div className="process-rollback-actions">
            <button
              type="button"
              className="secondary-button danger"
              disabled={busy !== undefined}
              onClick={() => void apply()}
            >
              <RotateCcw size={12} aria-hidden="true" />
              {busy === "apply" ? copy.applyingRollback : copy.confirmRollback}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy !== undefined}
              onClick={() => setPreview(undefined)}
            >
              {copy.cancelRollback}
            </button>
          </div>
        </section>
      ) : null}
      {result ? (
        <p
          className={`process-rollback-result is-${result.status}`}
          role="status"
        >
          <strong>
            {result.status === "restored"
              ? copy.rollbackRestored
              : result.status === "reverted"
                ? copy.rollbackReverted
                : copy.rollbackIndeterminate}
          </strong>
          <span>
            {copy.rollbackEvidence} {result.contentSha256.slice(0, 12)}
          </span>
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {copy.rollbackError}
        </p>
      ) : null}
    </div>
  );
}

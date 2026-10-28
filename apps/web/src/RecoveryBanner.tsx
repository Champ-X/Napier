import { RotateCcw, Search, ArrowRight } from "lucide-react";
import type { RunRecord } from "@napier/contracts";
import type { RunRecoveryCheckpoint } from "@napier/contracts/manual-run-recovery";
import { copy } from "./copy";
import { recoveryOperationsCopy as text } from "./recovery-operations-copy";
import { RecoveryOperations } from "./RecoveryOperations";
import "./recovery-operations.css";

export interface RecoveryBannerProps {
  run: RunRecord;
  checkpoint?: RunRecoveryCheckpoint | undefined;
  running: boolean;
  modelConfigured: boolean;
  canResume?: boolean;
  decisionId?: string | undefined;
  onResume: (readOnly: boolean) => void;
  onInspect: () => void;
  onOpenWorkflow: () => void;
}

export function RecoveryBanner({
  run,
  checkpoint,
  running,
  modelConfigured,
  canResume = true,
  decisionId,
  onResume,
  onInspect,
  onOpenWorkflow,
}: RecoveryBannerProps) {
  const facts = checkpoint?.runId === run.id ? checkpoint : undefined;
  const workflow =
    Boolean(run.workflowPlanId) || Boolean(run.source?.startsWith("workflow"));
  const needsInspection = recoveryNeedsInspection(facts);
  const descriptionId = `recovery-description-${run.id}`;
  const unavailableId = `recovery-unavailable-${run.id}`;
  const focusDecision = () => {
    const heading = document.getElementById(`operator-decision-${decisionId}`);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  };
  return (
    <section
      className="recovery-workspace"
      aria-labelledby={`recovery-title-${run.id}`}
      aria-busy={running}
    >
      <header>
        <RotateCcw size={17} aria-hidden="true" />
        <h2 id={`recovery-title-${run.id}`}>{text.title}</h2>
      </header>
      <p id={descriptionId}>
        {decisionId
          ? text.decisionHint
          : workflow
            ? text.workflowHint
            : needsInspection
              ? text.inspectHint
              : text.continueHint}
      </p>
      <RecoveryOperations checkpoint={facts} />
      {run.error ? (
        <details className="recovery-stop">
          <summary>{copy.recovery.failureReason}</summary>
          <p>{run.error}</p>
        </details>
      ) : null}
      <footer>
        <details className="recovery-receipt">
          <summary>{text.receipt}</summary>
          <code>{run.id}</code>
          {facts && facts.sourceRunId !== run.id ? (
            <code>{facts.sourceRunId}</code>
          ) : null}
          {facts ? (
            <p>
              {text.throughSeq}: {facts.throughSeq}
            </p>
          ) : null}
        </details>
        <div className="recovery-next-actions">
          {canResume && !workflow && !decisionId && !modelConfigured ? (
            <p id={unavailableId}>{copy.modelUnavailableHint}</p>
          ) : null}
          <button type="button" onClick={onInspect}>
            {text.inspectTrace}
          </button>
          {decisionId ? (
            <button type="button" onClick={focusDecision}>
              {text.openDecision}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : workflow ? (
            <button type="button" onClick={onOpenWorkflow}>
              {text.openWorkflow}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : canResume ? (
            <button
              className="recovery-primary"
              type="button"
              disabled={running || !modelConfigured}
              aria-describedby={`${descriptionId}${!modelConfigured ? ` ${unavailableId}` : ""}`}
              onClick={() => onResume(needsInspection)}
            >
              <Search size={14} aria-hidden="true" />
              {running
                ? text.starting
                : needsInspection
                  ? text.inspectReadOnly
                  : text.continueTask}
            </button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

function recoveryNeedsInspection(
  facts: RunRecoveryCheckpoint | undefined,
): boolean {
  return (
    !facts ||
    facts.evidenceLimited ||
    facts.omitted > 0 ||
    facts.counts.needs_reconciliation > 0 ||
    facts.counts.not_executed > 0 ||
    facts.counts.not_replayable > 0 ||
    facts.operations.some((operation) => operation.reason.startsWith("patch_"))
  );
}

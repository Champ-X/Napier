import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, ShieldAlert } from "lucide-react";

import type { EvaluationCasebook, RunRecord } from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";
import type {
  ReleaseProductGateProjection,
  ReleaseProductTrialFailureReason,
  ReleaseProductTrialStatus,
} from "@napier/contracts/release-product-trial";

import {
  getReleaseProductGate,
  recordReleaseProductTrial,
} from "./release-product-trial-api";

const FAILURE_REASONS: Array<{
  value: ReleaseProductTrialFailureReason;
  label: string;
}> = [
  { value: "task_result", label: "Task result" },
  { value: "tool_failure", label: "Tool failure" },
  { value: "configuration", label: "Configuration" },
  { value: "manual_intervention", label: "Manual intervention" },
  { value: "recovery_failure", label: "Recovery failure" },
  { value: "ux_blocker", label: "UX blocker" },
];

export function ReleaseProductTrialControl({
  threadId,
  casebook,
  template,
  selectedCaseId,
  runs,
  loadGate = getReleaseProductGate,
  submitTrial = recordReleaseProductTrial,
}: {
  threadId: string;
  casebook: EvaluationCasebook;
  template: EvaluationCasebookTemplate | undefined;
  selectedCaseId: string;
  runs: RunRecord[];
  loadGate?(
    threadId: string,
    casebookId: string,
  ): Promise<ReleaseProductGateProjection>;
  submitTrial?: typeof recordReleaseProductTrial;
}) {
  const terminalRuns = useMemo(
    () =>
      runs
        .filter(
          (run) =>
            !["queued", "running"].includes(run.status) &&
            Boolean(run.finishedAt),
        )
        .slice()
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [runs],
  );
  const [projection, setProjection] = useState<ReleaseProductGateProjection>();
  const [runId, setRunId] = useState(terminalRuns[0]?.id ?? "");
  const [productVersion, setProductVersion] = useState("");
  const [status, setStatus] = useState<ReleaseProductTrialStatus>("passed");
  const [failureReason, setFailureReason] =
    useState<ReleaseProductTrialFailureReason>("task_result");
  const [configurationInterventions, setConfigurationInterventions] =
    useState(0);
  const [humanInterventions, setHumanInterventions] = useState(0);
  const [recoveryEvents, setRecoveryEvents] = useState(0);
  const [uxScore, setUxScore] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (terminalRuns.some((run) => run.id === runId)) return;
    setRunId(terminalRuns[0]?.id ?? "");
  }, [runId, terminalRuns]);

  useEffect(() => {
    if (!casebook.templateId || !template) {
      setProjection(undefined);
      setError(undefined);
      return;
    }
    let cancelled = false;
    setProjection(undefined);
    setError(undefined);
    void loadGate(threadId, casebook.id)
      .then((next) => {
        if (cancelled) return;
        setProjection(next);
        setProductVersion((current) => current || next.currentProductVersion);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [casebook.id, casebook.templateId, loadGate, template, threadId]);

  if (!casebook.templateId || !template) return null;
  const currentVersion = projection?.versions.find(
    (version) => version.productVersion === productVersion,
  );
  const selectedRun = terminalRuns.find((run) => run.id === runId);
  const duplicate = projection?.trials.some(
    (trial) => trial.runId === runId && trial.productVersion === productVersion,
  );
  const canRecord =
    Boolean(selectedCaseId) &&
    Boolean(selectedRun) &&
    Boolean(productVersion.trim()) &&
    !duplicate &&
    !busy &&
    (status !== "passed" || selectedRun?.status === "completed");

  async function record(): Promise<void> {
    if (!canRecord) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await submitTrial(threadId, {
        casebookId: casebook.id,
        templateCaseId: selectedCaseId,
        runId,
        productVersion: productVersion.trim(),
        status,
        ...(status === "passed" ? {} : { failureReason }),
        configurationInterventions,
        humanInterventions,
        recoveryEvents,
        uxScore,
      });
      setProjection(result.gate);
    } catch (recordError) {
      setError(toErrorMessage(recordError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="release-product-trial"
      aria-labelledby={`release-product-trial-${casebook.id}`}
    >
      <header>
        <div>
          <span>DEFAULT PRODUCT TRACK</span>
          <h6 id={`release-product-trial-${casebook.id}`}>
            Versioned Run evidence
          </h6>
        </div>
        <strong
          className={projection?.defaultTrackReady ? "is-ready" : "is-blocked"}
        >
          {projection?.consecutivePassingVersions.length ?? 0}/
          {projection?.requiredConsecutiveVersions ?? 3} versions
        </strong>
      </header>
      <p>
        Record a real terminal Run. The gate requires every fixed Case, at least
        90% success, and every critical Case passing.
      </p>
      <div className="release-product-trial-grid">
        <label>
          <span>Product version</span>
          <input
            aria-label="Release product version"
            value={productVersion}
            maxLength={32}
            readOnly
          />
        </label>
        <label>
          <span>Terminal Run</span>
          <select
            aria-label="Release product Run"
            value={runId}
            onChange={(event) => setRunId(event.currentTarget.value)}
          >
            <option value="">No terminal Run</option>
            {terminalRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.status} · {shortId(run.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Outcome</span>
          <select
            aria-label="Release product outcome"
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as ReleaseProductTrialStatus)
            }
          >
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="inconclusive">Inconclusive</option>
          </select>
        </label>
        {status === "passed" ? null : (
          <label>
            <span>Failure class</span>
            <select
              aria-label="Release product failure reason"
              value={failureReason}
              onChange={(event) =>
                setFailureReason(
                  event.currentTarget.value as ReleaseProductTrialFailureReason,
                )
              }
            >
              {FAILURE_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <MetricInput
          label="Configuration interventions"
          value={configurationInterventions}
          onChange={setConfigurationInterventions}
        />
        <MetricInput
          label="Human interventions"
          value={humanInterventions}
          onChange={setHumanInterventions}
        />
        <MetricInput
          label="Recovery events"
          value={recoveryEvents}
          onChange={setRecoveryEvents}
        />
        <label>
          <span>UX score</span>
          <select
            aria-label="Release product UX score"
            value={uxScore}
            onChange={(event) => setUxScore(Number(event.currentTarget.value))}
          >
            {[1, 2, 3, 4, 5].map((score) => (
              <option key={score} value={score}>
                {score}/5
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" disabled={!canRecord} onClick={() => void record()}>
        <ClipboardCheck size={12} aria-hidden="true" />
        {busy ? "Recording Run…" : "Record product trial"}
      </button>
      {duplicate ? (
        <p role="status">This Run is already recorded for {productVersion}.</p>
      ) : null}
      {selectedRun &&
      status === "passed" &&
      selectedRun.status !== "completed" ? (
        <p role="status">Only a completed Run can be recorded as passed.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {currentVersion ? (
        <div
          className={`release-product-version release-product-version-${currentVersion.status}`}
        >
          <strong>
            {currentVersion.productVersion} · {currentVersion.status}
          </strong>
          <span>
            {currentVersion.coveredCaseCount}/{currentVersion.caseCount} Cases ·{" "}
            {Math.round(currentVersion.successRate * 100)}% success · UX{" "}
            {currentVersion.meanUxScore}/5
          </span>
          <small>
            {currentVersion.trialCount} Trials ·{" "}
            {currentVersion.humanInterventions} human ·{" "}
            {currentVersion.configurationInterventions} config ·{" "}
            {currentVersion.recoveryEvents} recovery
          </small>
          {currentVersion.failedCriticalCaseIds.length ? (
            <small>
              Critical pending:{" "}
              {currentVersion.failedCriticalCaseIds.join(", ")}
            </small>
          ) : null}
        </div>
      ) : null}
      <footer>
        <ShieldAlert size={12} aria-hidden="true" />
        <small>
          This gate covers the Default Product Track only; cross-platform,
          supply-chain, safety, and competitor gates remain independent.
        </small>
      </footer>
    </section>
  );
}

function MetricInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function shortId(value: string): string {
  return value.slice(-10);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

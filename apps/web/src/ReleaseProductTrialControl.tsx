import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, ShieldAlert } from "lucide-react";

import type { EvaluationCasebook, RunRecord } from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";
import type {
  ReleaseProductGateProjection,
  ReleaseProductTrialFailureReason,
  ReleaseProductTrialStatus,
} from "@napier/contracts/release-product-trial";

import { advancedSurfaceCopy } from "./advanced-surface-copy";
import {
  getReleaseProductGate,
  recordReleaseProductTrial,
} from "./release-product-trial-api";
import {
  ReleaseProductMetricInput,
  ReleaseProductVersionSummary,
} from "./ReleaseProductTrialEvidence";

const FAILURE_REASONS: ReleaseProductTrialFailureReason[] = [
  "task_result",
  "tool_failure",
  "configuration",
  "manual_intervention",
  "recovery_failure",
  "ux_blocker",
];

export interface ReleaseProductTrialControlProps {
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
}

export function ReleaseProductTrialControl({
  threadId,
  casebook,
  template,
  selectedCaseId,
  runs,
  loadGate = getReleaseProductGate,
  submitTrial = recordReleaseProductTrial,
}: ReleaseProductTrialControlProps) {
  const copy = advancedSurfaceCopy.releaseTrial;
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
          <span>{copy.track}</span>
          <h6 id={`release-product-trial-${casebook.id}`}>{copy.title}</h6>
        </div>
        <strong
          className={projection?.defaultTrackReady ? "is-ready" : "is-blocked"}
        >
          {projection?.consecutivePassingVersions.length ?? 0}/
          {projection?.requiredConsecutiveVersions ?? 3} {copy.versions}
        </strong>
      </header>
      <p>{copy.body}</p>
      <div className="release-product-trial-grid">
        <label>
          <span>{copy.productVersion}</span>
          <input
            aria-label={copy.productVersionLabel}
            value={productVersion}
            maxLength={32}
            readOnly
          />
        </label>
        <label>
          <span>{copy.terminalRun}</span>
          <select
            aria-label={copy.terminalRunLabel}
            value={runId}
            onChange={(event) => setRunId(event.currentTarget.value)}
          >
            <option value="">{copy.noTerminalRun}</option>
            {terminalRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.status} · {shortId(run.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{copy.outcome}</span>
          <select
            aria-label={copy.outcomeLabel}
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as ReleaseProductTrialStatus)
            }
          >
            <option value="passed">{copy.passed}</option>
            <option value="failed">{copy.failed}</option>
            <option value="inconclusive">{copy.inconclusive}</option>
          </select>
        </label>
        {status === "passed" ? null : (
          <label>
            <span>{copy.failureClass}</span>
            <select
              aria-label={copy.failureReasonLabel}
              value={failureReason}
              onChange={(event) =>
                setFailureReason(
                  event.currentTarget.value as ReleaseProductTrialFailureReason,
                )
              }
            >
              {FAILURE_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {copy.failureReasons[reason]}
                </option>
              ))}
            </select>
          </label>
        )}
        <ReleaseProductMetricInput
          label={copy.configurationInterventions}
          value={configurationInterventions}
          onChange={setConfigurationInterventions}
        />
        <ReleaseProductMetricInput
          label={copy.humanInterventions}
          value={humanInterventions}
          onChange={setHumanInterventions}
        />
        <ReleaseProductMetricInput
          label={copy.recoveryEvents}
          value={recoveryEvents}
          onChange={setRecoveryEvents}
        />
        <label>
          <span>{copy.uxScore}</span>
          <select
            aria-label={copy.uxScoreLabel}
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
        {busy ? copy.recording : copy.record}
      </button>
      {duplicate ? (
        <p role="status">
          {copy.duplicatePrefix} {productVersion}.
        </p>
      ) : null}
      {selectedRun &&
      status === "passed" &&
      selectedRun.status !== "completed" ? (
        <p role="status">{copy.completedOnly}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {currentVersion ? (
        <ReleaseProductVersionSummary version={currentVersion} />
      ) : null}
      <footer>
        <ShieldAlert size={12} aria-hidden="true" />
        <small>{copy.footer}</small>
      </footer>
    </section>
  );
}

function shortId(value: string): string {
  return value.slice(-10);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { useEffect, useState } from "react";
import { FlaskConical, Upload } from "lucide-react";

import type { EvaluationCasebook } from "@napier/contracts";
import type {
  ControlledHarnessComparisonDomain,
  ControlledHarnessEvidence,
  ControlledHarnessGateProjection,
} from "@napier/contracts/controlled-harness-evidence";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import { advancedSurfaceCopy } from "./advanced-surface-copy";
import {
  getControlledHarnessGate,
  recordControlledHarnessEvidence,
} from "./controlled-harness-evidence-api";

const DOMAIN_LABELS: Record<ControlledHarnessComparisonDomain, string> = {
  ...advancedSurfaceCopy.controlled.domains,
};

export interface ControlledHarnessEvidenceControlProps {
  threadId: string;
  casebook: EvaluationCasebook;
  template: EvaluationCasebookTemplate | undefined;
  loadGate?(
    threadId: string,
    casebookId: string,
  ): Promise<ControlledHarnessGateProjection>;
  submitEvidence?: typeof recordControlledHarnessEvidence;
}

export function ControlledHarnessEvidenceControl({
  threadId,
  casebook,
  template,
  loadGate = getControlledHarnessGate,
  submitEvidence = recordControlledHarnessEvidence,
}: ControlledHarnessEvidenceControlProps) {
  const copy = advancedSurfaceCopy.controlled;
  const smallCopy = advancedSurfaceCopy.smallLabels;
  const [projection, setProjection] =
    useState<ControlledHarnessGateProjection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
      .then((gate) => {
        if (!cancelled) setProjection(gate);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [casebook.id, casebook.templateId, loadGate, template, threadId]);

  if (!casebook.templateId || !template) return null;

  async function importEvidence(file: File): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      if (file.size > 512 * 1024) throw new Error(copy.sizeError);
      const input = JSON.parse(await file.text()) as ControlledHarnessEvidence;
      const result = await submitEvidence(threadId, casebook.id, input);
      setProjection(result.gate);
    } catch (importError) {
      setError(toErrorMessage(importError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="controlled-harness-evidence"
      aria-labelledby={`controlled-harness-${casebook.id}`}
    >
      <header>
        <div>
          <span>{copy.track}</span>
          <h6 id={`controlled-harness-${casebook.id}`}>{copy.title}</h6>
        </div>
        <strong
          className={
            projection?.controlledTrackReady ? "is-ready" : "is-blocked"
          }
        >
          {projection?.controlledTrackReady ? copy.ready : copy.notProven}
        </strong>
      </header>
      <p>{copy.body}</p>
      <label className="controlled-harness-import">
        <Upload size={12} aria-hidden="true" />
        <span>{busy ? copy.verifying : copy.import}</span>
        <input
          aria-label={copy.bundleLabel}
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importEvidence(file);
          }}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {projection?.evidence ? (
        <>
          <div className="controlled-harness-meta">
            <code>{projection.evidence.productVersion}</code>
            <span>
              {projection.evidence.model.provider}/
              {projection.evidence.model.id}
            </span>
            <code>{shortHash(projection.evidence.contentSha256)}</code>
          </div>
          <div className="controlled-harness-grid">
            {projection.comparisonGates.map((gate) => (
              <article
                key={gate.domain}
                className={gate.comparisonReady ? "is-ready" : "is-blocked"}
              >
                <strong>{DOMAIN_LABELS[gate.domain]}</strong>
                <span>
                  {gate.napierPassed}/{gate.baselinePassed} {copy.passed} ·{" "}
                  {gate.decisiveTrialCount}/{gate.trialCount} {copy.decisive}
                </span>
                <small>
                  {copy.verdicts[gate.verdict]} · {copy.minimum}{" "}
                  {gate.minimumDecisiveTrialCount} {copy.trials} ·{" "}
                  {Math.ceil(gate.minimumDecisiveCoverage * 100)}%{" "}
                  {copy.coverage}
                </small>
              </article>
            ))}
          </div>
          <div
            className={
              projection.advantageGate?.advantageReady
                ? "controlled-harness-advantage is-ready"
                : "controlled-harness-advantage is-blocked"
            }
          >
            <strong>{copy.advantage}</strong>
            <span>
              {copy.metrics[projection.advantageGate?.metric ?? "recovery"]}{" "}
              {smallCopy.comparisonSeparator}{" "}
              {baselineLabel(projection.advantageGate?.baseline)} ·{" "}
              {projection.advantageGate?.advantageReady
                ? copy.proven
                : copy.notProven}
              {projection.advantageGate?.napierValue !== null &&
              projection.advantageGate?.napierValue !== undefined &&
              projection.advantageGate.baselineValue !== null
                ? ` · Napier ${projection.advantageGate.napierValue.toFixed(3)} ${smallCopy.comparisonSeparator} ${baselineLabel(projection.advantageGate.baseline)} ${projection.advantageGate.baselineValue.toFixed(3)} ${unitLabel(projection.advantageGate.unit)} · ${smallCopy.sampleSize}=${projection.advantageGate.napierSampleCount}/${projection.advantageGate.baselineSampleCount}`
                : ""}
            </span>
          </div>
          {projection.blockers.length > 0 ? (
            <ul className="controlled-harness-blockers">
              {projection.blockers.map((blocker) => (
                <li key={blocker}>{blockerLabel(blocker)}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p role="status">{copy.empty}</p>
      )}
      <footer>
        <FlaskConical size={12} aria-hidden="true" />
        <small>{copy.footer}</small>
      </footer>
    </section>
  );
}

function shortHash(value: string): string {
  return value.slice(0, 12);
}

function baselineLabel(value: "omp" | "browser_use" | undefined): string {
  return value === "browser_use" ? "Browser Use" : "OMP";
}

function unitLabel(value: string): string {
  return (
    advancedSurfaceCopy.controlled.units[
      value as keyof typeof advancedSurfaceCopy.controlled.units
    ] ?? value.replaceAll("_", " ")
  );
}

function blockerLabel(value: string): string {
  const [reason, domain] = value.split(":", 2);
  const reasonLabel =
    advancedSurfaceCopy.controlled.blockers[
      reason as keyof typeof advancedSurfaceCopy.controlled.blockers
    ] ??
    reason?.replaceAll("_", " ") ??
    value;
  return domain && domain in DOMAIN_LABELS
    ? `${reasonLabel}: ${DOMAIN_LABELS[domain as ControlledHarnessComparisonDomain]}`
    : reasonLabel;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

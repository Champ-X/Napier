import { useEffect, useState } from "react";
import { FlaskConical, Upload } from "lucide-react";

import type { EvaluationCasebook } from "@napier/contracts";
import type {
  ControlledHarnessComparisonDomain,
  ControlledHarnessEvidence,
  ControlledHarnessGateProjection,
} from "@napier/contracts/controlled-harness-evidence";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import {
  getControlledHarnessGate,
  recordControlledHarnessEvidence,
} from "./controlled-harness-evidence-api";

const DOMAIN_LABELS: Record<ControlledHarnessComparisonDomain, string> = {
  search: "Search vs OMP",
  browser_omp: "Browser vs OMP",
  coding: "Coding vs OMP",
  browser_autonomy: "Browser autonomy vs Browser Use",
};

export function ControlledHarnessEvidenceControl({
  threadId,
  casebook,
  template,
  loadGate = getControlledHarnessGate,
  submitEvidence = recordControlledHarnessEvidence,
}: {
  threadId: string;
  casebook: EvaluationCasebook;
  template: EvaluationCasebookTemplate | undefined;
  loadGate?(
    threadId: string,
    casebookId: string,
  ): Promise<ControlledHarnessGateProjection>;
  submitEvidence?: typeof recordControlledHarnessEvidence;
}) {
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
      if (file.size > 512 * 1024)
        throw new Error("Controlled Harness evidence exceeds 512 KiB");
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
          <span>CONTROLLED HARNESS TRACK</span>
          <h6 id={`controlled-harness-${casebook.id}`}>
            Competitor evidence gate
          </h6>
        </div>
        <strong
          className={
            projection?.controlledTrackReady ? "is-ready" : "is-blocked"
          }
        >
          {projection?.controlledTrackReady ? "ready" : "not proven"}
        </strong>
      </header>
      <p>
        Import the sanitized, hash-verified bundle generated from same-model,
        equivalent-Prompt, isolated comparison Trials. Narrow wins remain
        blocked until their fixed sample thresholds are met.
      </p>
      <label className="controlled-harness-import">
        <Upload size={12} aria-hidden="true" />
        <span>{busy ? "Verifying evidence…" : "Import evidence bundle"}</span>
        <input
          aria-label="Controlled Harness evidence bundle"
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
                  {gate.napierPassed}/{gate.baselinePassed} passed ·{" "}
                  {gate.decisiveTrialCount}/{gate.trialCount} decisive
                </span>
                <small>
                  {gate.verdict.replaceAll("_", " ")} · minimum{" "}
                  {gate.minimumDecisiveTrialCount} decisive Trials ·{" "}
                  {Math.ceil(gate.minimumDecisiveCoverage * 100)}% decisive
                  coverage
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
            <strong>Quantified advantage</strong>
            <span>
              {projection.advantageGate?.metric ?? "recovery"} vs{" "}
              {baselineLabel(projection.advantageGate?.baseline)} ·{" "}
              {projection.advantageGate?.advantageReady
                ? "proven"
                : "not proven"}
              {projection.advantageGate?.napierValue !== null &&
              projection.advantageGate?.napierValue !== undefined &&
              projection.advantageGate.baselineValue !== null
                ? ` · Napier ${projection.advantageGate.napierValue.toFixed(3)} vs ${baselineLabel(projection.advantageGate.baseline)} ${projection.advantageGate.baselineValue.toFixed(3)} ${projection.advantageGate.unit.replaceAll("_", " ")} · n=${projection.advantageGate.napierSampleCount}/${projection.advantageGate.baselineSampleCount}`
                : ""}
            </span>
          </div>
          {projection.blockers.length > 0 ? (
            <ul className="controlled-harness-blockers">
              {projection.blockers.map((blocker) => (
                <li key={blocker}>{blocker.replaceAll("_", " ")}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p role="status">No controlled comparison evidence recorded.</p>
      )}
      <footer>
        <FlaskConical size={12} aria-hidden="true" />
        <small>
          This covers competitor comparisons only; the Default Product, safety,
          cross-platform, and supply-chain gates remain independent.
        </small>
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

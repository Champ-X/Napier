import { Download, KeyRound, ShieldCheck } from "lucide-react";

import { CasebookQualificationTrialControl } from "./CasebookQualificationTrialControl";
import { copy } from "./copy";
import { toErrorMessage } from "./evaluation-casebook-artifacts";
import { evaluationCasebookQualificationDisabled } from "./evaluation-casebook-template-view-model";
import { EvaluationQualificationResults } from "./EvaluationQualificationResults";
import type { useEvaluationCasebook } from "./use-evaluation-casebook";

type EvaluationCasebookState = ReturnType<typeof useEvaluationCasebook>;

export interface EvaluationCasebookQualificationProps {
  state: EvaluationCasebookState;
}

export function EvaluationCasebookQualification({
  state,
}: EvaluationCasebookQualificationProps) {
  const {
    selected,
    revision,
    currentQualification,
    qualifierModelKey,
    setQualifierModelKey,
    qualificationModelGroups,
    minimumAgreementRate,
    setMinimumAgreementRate,
    allowQualificationInconclusive,
    setAllowQualificationInconclusive,
    busyId,
    currentCases,
    templateCoverageComplete,
    runQualificationTrial,
    setQualifications,
    setBusyId,
    setError,
    onRefresh,
    currentBaseline,
    baselineState,
    baselineUpToDate,
    selectedTrustAnchorId,
    exportQualificationReceipt,
    exportSignedQualificationReceipt,
    promoteBaseline,
  } = state;
  if (!selected || !revision) return null;
  return (
    <section
      className="casebook-qualification"
      aria-labelledby={`casebook-qualification-${selected.id}`}
    >
      <header>
        <div>
          <span>{copy.lab.casebook.qualification.eyebrow}</span>
          <h6 id={`casebook-qualification-${selected.id}`}>
            {copy.lab.casebook.qualification.title}
          </h6>
        </div>
        <strong
          className={`casebook-qualification-status casebook-qualification-status-${currentQualification?.status ?? "idle"}`}
          role="status"
        >
          {currentQualification
            ? copy.lab.casebook.qualification.statuses[
                currentQualification.status
              ]
            : copy.lab.casebook.qualification.neverRun}
        </strong>
      </header>
      <p>{copy.lab.casebook.qualification.body}</p>

      <div className="casebook-qualification-compose">
        <label>
          <span>{copy.lab.casebook.qualification.evaluator}</span>
          <select
            value={qualifierModelKey}
            disabled={Boolean(busyId)}
            onChange={(event) => setQualifierModelKey(event.target.value)}
          >
            {qualificationModelGroups.map((group) => (
              <optgroup key={group.provider} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="casebook-qualification-rate">
          <span>{copy.lab.casebook.qualification.minimumAgreement}</span>
          <output>{minimumAgreementRate}%</output>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minimumAgreementRate}
            disabled={Boolean(busyId)}
            onChange={(event) =>
              setMinimumAgreementRate(event.currentTarget.valueAsNumber)
            }
          />
        </label>
        <label className="casebook-qualification-toggle">
          <input
            type="checkbox"
            checked={allowQualificationInconclusive}
            disabled={Boolean(busyId)}
            onChange={(event) =>
              setAllowQualificationInconclusive(event.target.checked)
            }
          />
          <span>{copy.lab.casebook.qualification.allowInconclusive}</span>
        </label>
        <CasebookQualificationTrialControl
          key={selected.id}
          disabled={evaluationCasebookQualificationDisabled(
            currentCases,
            templateCoverageComplete,
            qualifierModelKey,
            busyId,
          )}
          runTrial={runQualificationTrial}
          onExecution={(execution) =>
            setQualifications((current) => [
              ...current.filter((item) => item.id !== execution.id),
              execution,
            ])
          }
          onBusyChange={(busy) => {
            setBusyId(busy ? `qualify:${selected.id}` : undefined);
            if (busy) setError(undefined);
          }}
          onSettled={onRefresh}
          onError={(trialError) => setError(toErrorMessage(trialError))}
        />
      </div>

      <EvaluationQualificationResults state={state} />

      <section
        className={`qualification-baseline baseline-${baselineState}`}
        aria-label={copy.lab.casebook.qualification.baseline}
      >
        <header>
          <span>{copy.lab.casebook.qualification.baseline}</span>
          <strong>
            {baselineState === "missing"
              ? copy.lab.casebook.qualification.noBaseline
              : baselineState === "revoked"
                ? copy.lab.casebook.qualification.baselineRevoked
                : baselineState === "stale"
                  ? copy.lab.casebook.qualification.baselineStale
                  : copy.lab.casebook.qualification.baselineCurrent}
          </strong>
        </header>
        {currentBaseline ? (
          <div>
            <span>
              <small>{copy.lab.casebook.qualification.baselineHash}</small>
              <code title={currentBaseline.contentSha256}>
                {currentBaseline.contentSha256.slice(0, 12)}
              </code>
            </span>
            <span>
              <small>{copy.lab.casebook.qualification.signer}</small>
              <code title={currentBaseline.envelope.signature.keyId}>
                {currentBaseline.envelope.signature.keyId.slice(0, 12)}
              </code>
            </span>
            <span>
              <small>{copy.lab.casebook.currentRevision}</small>
              <code>r{currentBaseline.casebookRevision}</code>
            </span>
          </div>
        ) : null}
      </section>

      <footer>
        <code title={revision.contentSha256}>
          r{revision.revision} · {revision.contentSha256.slice(0, 10)}
        </code>
        <button
          type="button"
          disabled={Boolean(busyId)}
          onClick={() => void exportQualificationReceipt()}
        >
          <Download size={11} aria-hidden="true" />
          {busyId === `qualification-receipt:${selected.id}`
            ? copy.lab.casebook.qualification.exportingReceipt
            : copy.lab.casebook.qualification.receipt}
        </button>
        <button
          type="button"
          title={
            selectedTrustAnchorId
              ? copy.lab.casebook.qualification.signedReceipt
              : copy.lab.casebook.qualification.noSigner
          }
          disabled={Boolean(busyId) || !selectedTrustAnchorId}
          onClick={() => void exportSignedQualificationReceipt()}
        >
          <KeyRound size={11} aria-hidden="true" />
          {busyId === `signed-qualification-receipt:${selected.id}`
            ? copy.lab.casebook.qualification.exportingSignedReceipt
            : copy.lab.casebook.qualification.signedReceipt}
        </button>
        <button
          className="qualification-baseline-promote"
          type="button"
          title={
            selectedTrustAnchorId
              ? copy.lab.casebook.qualification.promoteBaseline
              : copy.lab.casebook.qualification.noSigner
          }
          disabled={
            Boolean(busyId) ||
            !selectedTrustAnchorId ||
            currentQualification?.status !== "passed" ||
            baselineUpToDate
          }
          onClick={() => void promoteBaseline()}
        >
          <ShieldCheck size={11} aria-hidden="true" />
          {busyId === `promote-baseline:${selected.id}`
            ? copy.lab.casebook.qualification.promotingBaseline
            : copy.lab.casebook.qualification.promoteBaseline}
        </button>
      </footer>
    </section>
  );
}

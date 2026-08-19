import { Check, Save, X } from "lucide-react";

import { copy } from "./copy";
import { runLabel } from "./evaluation-suite-artifacts";
import type { useEvaluationSuite } from "./use-evaluation-suite";

type EvaluationSuiteState = ReturnType<typeof useEvaluationSuite>;

export interface EvaluationSuiteComposeProps {
  state: EvaluationSuiteState;
}

export function EvaluationSuiteCompose({ state }: EvaluationSuiteComposeProps) {
  const {
    editingSuiteId,
    name,
    setName,
    baselineRunId,
    setBaselineRunId,
    candidateRunIds,
    setCandidateRunIds,
    minimumPassRate,
    setMinimumPassRate,
    minimumCandidateScore,
    setMinimumCandidateScore,
    allowInconclusive,
    setAllowInconclusive,
    evaluatorModelKey,
    setEvaluatorModelKey,
    evaluatorModelGroups,
    evaluatorModel,
    busyId,
    error,
    runs,
    canSubmit,
    resetForm,
    toggleCandidate,
    submit,
  } = state;
  return (
    <div className="suite-compose">
      <div className="suite-compose-heading">
        <strong>
          {editingSuiteId ? copy.lab.suite.update : copy.lab.suite.create}
        </strong>
        <code>{evaluatorModelKey}</code>
      </div>
      <label>
        <span>{copy.lab.suite.name}</span>
        <input
          type="text"
          maxLength={100}
          value={name}
          placeholder={copy.lab.suite.namePlaceholder}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>{copy.lab.suite.evaluator}</span>
        <select
          value={evaluatorModelKey}
          disabled={Boolean(busyId)}
          onChange={(event) => setEvaluatorModelKey(event.target.value)}
        >
          {evaluatorModelGroups.map((group) => (
            <optgroup key={group.provider} label={group.label}>
              {group.options.map((option) => (
                <option
                  key={option.key}
                  value={option.key}
                  disabled={!option.configured}
                >
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {!evaluatorModel.configured ? (
        <p className="suite-error" role="status">
          {copy.modelUnavailableHint}
        </p>
      ) : null}
      <label>
        <span>{copy.lab.suite.baseline}</span>
        <select
          value={baselineRunId}
          onChange={(event) => {
            const runId = event.target.value;
            setBaselineRunId(runId);
            setCandidateRunIds((current) =>
              current.filter((candidate) => candidate !== runId),
            );
          }}
        >
          <option value="">{copy.lab.selectRun}</option>
          {runs.map((run, index) => (
            <option key={run.id} value={run.id}>
              {runLabel(run, index)}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="suite-candidate-register">
        <legend>{copy.lab.suite.candidates}</legend>
        <small>{copy.lab.suite.candidatesHint}</small>
        <div>
          {runs.map((run, index) => (
            <label key={run.id}>
              <input
                type="checkbox"
                checked={candidateRunIds.includes(run.id)}
                disabled={run.id === baselineRunId}
                onChange={() => toggleCandidate(run.id)}
              />
              <span>{runLabel(run, index)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="suite-gate-grid">
        <label>
          <span>{copy.lab.suite.passRate}</span>
          <output>{minimumPassRate}%</output>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minimumPassRate}
            onChange={(event) =>
              setMinimumPassRate(event.currentTarget.valueAsNumber)
            }
          />
        </label>
        <label>
          <span>{copy.lab.suite.candidateScore}</span>
          <output>{minimumCandidateScore.toFixed(1)}</output>
          <input
            type="range"
            min={1}
            max={5}
            step={0.25}
            value={minimumCandidateScore}
            onChange={(event) =>
              setMinimumCandidateScore(event.currentTarget.valueAsNumber)
            }
          />
        </label>
      </div>
      <label className="suite-inconclusive-toggle">
        <input
          type="checkbox"
          checked={allowInconclusive}
          onChange={(event) => setAllowInconclusive(event.target.checked)}
        />
        <span>{copy.lab.suite.allowInconclusive}</span>
      </label>
      {error ? <p className="suite-error">{error}</p> : null}
      <div className="suite-compose-actions">
        {editingSuiteId ? (
          <button type="button" disabled={Boolean(busyId)} onClick={resetForm}>
            <X size={11} aria-hidden="true" />
            {copy.lab.suite.cancel}
          </button>
        ) : null}
        <button
          className="suite-primary-action"
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {editingSuiteId ? (
            <Save size={11} aria-hidden="true" />
          ) : (
            <Check size={11} aria-hidden="true" />
          )}
          {editingSuiteId ? copy.lab.suite.update : copy.lab.suite.create}
        </button>
      </div>
    </div>
  );
}

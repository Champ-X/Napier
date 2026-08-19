import { useState } from "react";
import { Play } from "lucide-react";

import type { EvaluationCasebookQualificationExecution } from "@napier/contracts";
import { advancedSurfaceCopy } from "./advanced-surface-copy";

export interface CasebookQualificationTrialControlProps {
  disabled: boolean;
  runTrial(): Promise<EvaluationCasebookQualificationExecution>;
  onExecution(execution: EvaluationCasebookQualificationExecution): void;
  onBusyChange(busy: boolean): void;
  onSettled(): Promise<void>;
  onError(error: unknown): void;
}

const TRIAL_COUNTS = [1, 2, 3, 5, 10] as const;

export function CasebookQualificationTrialControl({
  disabled,
  runTrial,
  onExecution,
  onBusyChange,
  onSettled,
  onError,
}: CasebookQualificationTrialControlProps) {
  const copy = advancedSurfaceCopy.qualification;
  const [trialCount, setTrialCount] = useState(1);
  const [progress, setProgress] = useState<number>();
  const [latest, setLatest] = useState<
    EvaluationCasebookQualificationExecution[]
  >([]);

  async function run(): Promise<void> {
    if (disabled || progress !== undefined) return;
    const completed: EvaluationCasebookQualificationExecution[] = [];
    setLatest([]);
    onBusyChange(true);
    try {
      for (let trial = 1; trial <= trialCount; trial += 1) {
        setProgress(trial);
        const execution = await runTrial();
        completed.push(execution);
        setLatest([...completed]);
        onExecution(execution);
      }
      await onSettled();
    } catch (error) {
      onError(error);
    } finally {
      setProgress(undefined);
      onBusyChange(false);
    }
  }

  const passed = latest.filter(
    (execution) => execution.status === "passed",
  ).length;
  const meanAgreement = latest.length
    ? Math.round(
        (latest.reduce(
          (total, execution) => total + execution.agreementRate,
          0,
        ) /
          latest.length) *
          100,
      )
    : 0;

  return (
    <>
      <label className="casebook-qualification-trials">
        <span>{copy.trials}</span>
        <select
          aria-label={copy.trialCount}
          value={trialCount}
          disabled={disabled || progress !== undefined}
          onChange={(event) => setTrialCount(Number(event.currentTarget.value))}
        >
          {TRIAL_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
        <small>{copy.trialHelp}</small>
      </label>
      <button
        className="casebook-qualification-run"
        type="button"
        disabled={disabled || progress !== undefined}
        onClick={() => void run()}
      >
        <Play size={11} aria-hidden="true" />
        {progress === undefined
          ? trialCount === 1
            ? copy.qualify
            : `${copy.runTrialsPrefix} ${String(trialCount)} ${copy.runTrialsSuffix}`
          : `${copy.trialProgress} ${String(progress)} ${copy.of} ${String(trialCount)}…`}
      </button>
      {latest.length ? (
        <p className="casebook-qualification-trial-summary" role="status">
          {copy.latestBatch} · {latest.length}/{trialCount} {copy.completed} ·{" "}
          {passed} {copy.passed} · {meanAgreement}% {copy.meanAgreement}
        </p>
      ) : null}
    </>
  );
}

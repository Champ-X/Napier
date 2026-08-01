import type { ExecutionPlanWorkflowExperimentMode } from "@napier/contracts";

import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";

export function WorkflowExperimentModeField({
  mode,
  simulatedOutput,
  disabled,
  onModeChange,
  onSimulatedOutputChange,
}: {
  mode: ExecutionPlanWorkflowExperimentMode;
  simulatedOutput: string;
  disabled: boolean;
  onModeChange: (mode: ExecutionPlanWorkflowExperimentMode) => void;
  onSimulatedOutputChange: (value: string) => void;
}) {
  const hint =
    mode === "single_node"
      ? copy.singleNodeHint
      : mode === "simulate_node"
        ? copy.simulateNodeHint
        : copy.subgraphHint;
  return (
    <>
      <label className="workflow-experiment-model">
        <span>
          <small>{copy.executionMode}</small>
        </span>
        <select
          value={mode}
          disabled={disabled}
          onChange={(event) =>
            onModeChange(
              event.target.value as ExecutionPlanWorkflowExperimentMode,
            )
          }
        >
          <option value="subgraph">{copy.subgraphMode}</option>
          <option value="single_node">{copy.singleNodeMode}</option>
          <option value="simulate_node">{copy.simulateNodeMode}</option>
        </select>
      </label>
      <p className="workflow-experiment-model-hint">{hint}</p>
      {mode === "simulate_node" ? (
        <>
          <label>
            <span>{copy.simulatedOutput}</span>
            <textarea
              rows={5}
              value={simulatedOutput}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => onSimulatedOutputChange(event.target.value)}
            />
          </label>
          <p className="workflow-experiment-model-hint">
            {copy.simulatedOutputHint}
          </p>
        </>
      ) : null}
    </>
  );
}

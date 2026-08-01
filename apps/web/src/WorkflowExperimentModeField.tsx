import type { ExecutionPlanWorkflowExperimentMode } from "@napier/contracts";

import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";

export function WorkflowExperimentModeField({
  mode,
  simulatedOutput,
  replacementInput,
  disabled,
  onModeChange,
  onSimulatedOutputChange,
  onReplacementInputChange,
}: {
  mode: ExecutionPlanWorkflowExperimentMode;
  simulatedOutput: string;
  replacementInput: string;
  disabled: boolean;
  onModeChange: (mode: ExecutionPlanWorkflowExperimentMode) => void;
  onSimulatedOutputChange: (value: string) => void;
  onReplacementInputChange: (value: string) => void;
}) {
  const hint =
    mode === "single_node"
      ? copy.singleNodeHint
      : mode === "step_nodes"
        ? copy.stepNodesHint
        : mode === "simulate_node"
          ? copy.simulateNodeHint
          : mode === "replace_input"
            ? copy.replaceInputHint
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
          <option value="step_nodes">{copy.stepNodesMode}</option>
          <option value="simulate_node">{copy.simulateNodeMode}</option>
          <option value="replace_input">{copy.replaceInputMode}</option>
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
      {mode === "replace_input" ? (
        <>
          <label>
            <span>{copy.replacementInput}</span>
            <textarea
              rows={5}
              value={replacementInput}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => onReplacementInputChange(event.target.value)}
            />
          </label>
          <p className="workflow-experiment-model-hint">
            {copy.replacementInputHint}
          </p>
        </>
      ) : null}
    </>
  );
}

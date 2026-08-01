import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";

export function WorkflowExperimentModeField({
  singleNode,
  disabled,
  onChange,
}: {
  singleNode: boolean;
  disabled: boolean;
  onChange: (singleNode: boolean) => void;
}) {
  return (
    <>
      <label className="workflow-experiment-model">
        <input
          type="checkbox"
          checked={singleNode}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <small>{copy.executionMode}</small>
          <strong>
            {singleNode ? copy.singleNodeMode : copy.subgraphMode}
          </strong>
        </span>
      </label>
      <p className="workflow-experiment-model-hint">
        {singleNode ? copy.singleNodeHint : copy.subgraphHint}
      </p>
    </>
  );
}

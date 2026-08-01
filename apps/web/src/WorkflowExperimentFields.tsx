import type {
  ExecutionPlanWorkflowExperimentMode,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";
import { Upload } from "lucide-react";

import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";

export function WorkflowExperimentManifestField({
  busy,
  filename,
  manifestAvailable,
  onFile,
}: {
  busy: boolean;
  filename: string;
  manifestAvailable: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className="workflow-experiment-file">
      <input
        type="file"
        accept="application/json,.json"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <Upload size={13} aria-hidden="true" />
      <span>
        <small>{copy.manifest}</small>
        <strong>
          {busy
            ? copy.previewing
            : filename ||
              (manifestAvailable ? copy.manifestReady : copy.loadManifest)}
        </strong>
      </span>
    </label>
  );
}

export function WorkflowExperimentCheckpointField({
  manifest,
  mode,
  value,
  busy,
  onChange,
}: {
  manifest: ExecutionPlanWorkflowManifest | undefined;
  mode: ExecutionPlanWorkflowExperimentMode;
  value: string;
  busy: boolean;
  onChange: (nodeId: string) => void;
}) {
  return (
    <label>
      <span>{copy.checkpoint}</span>
      <select
        value={value}
        disabled={!manifest || mode === "replace_workflow_input" || busy}
        onChange={(event) => onChange(event.target.value)}
      >
        {(manifest?.nodes ?? []).map((node) => (
          <option key={node.id} value={node.id}>
            {node.id} / {node.type === "tool" ? node.tool : node.type}
          </option>
        ))}
      </select>
    </label>
  );
}

export function WorkflowExperimentModelField({
  mode,
  manifestAvailable,
  canReplaceModel,
  selectedModelConfigured,
  selectedModelKey,
  checked,
  busy,
  onChange,
}: {
  mode: ExecutionPlanWorkflowExperimentMode;
  manifestAvailable: boolean;
  canReplaceModel: boolean;
  selectedModelConfigured: boolean;
  selectedModelKey: string;
  checked: boolean;
  busy: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <>
      <label className="workflow-experiment-model">
        <input
          type="checkbox"
          checked={checked && canReplaceModel}
          disabled={
            !manifestAvailable ||
            !canReplaceModel ||
            !selectedModelConfigured ||
            busy
          }
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <small>{copy.overrideModel}</small>
          <strong>{selectedModelKey}</strong>
        </span>
      </label>
      <p className="workflow-experiment-model-hint">
        {mode === "replace_workflow_input"
          ? copy.workflowInputModelUnavailable
          : !canReplaceModel
            ? copy.toolModelUnavailable
            : selectedModelConfigured
              ? copy.overrideHint
              : copy.unavailableModel}
      </p>
    </>
  );
}

import { FlaskConical, GitCompareArrows, RotateCcw } from "lucide-react";

import type { ExecutionPlan } from "@napier/contracts";

import { useWorkflowExperimentDesk } from "./use-workflow-experiment-desk";
import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";
import { shortWorkflowExperimentId } from "./workflow-experiment-desk-helpers";
import {
  WorkflowExperimentComparisonDocket,
  WorkflowExperimentPreviewDocket,
} from "./WorkflowExperimentDockets";
import {
  WorkflowExperimentCheckpointField,
  WorkflowExperimentManifestField,
  WorkflowExperimentModelField,
} from "./WorkflowExperimentFields";
import { WorkflowExperimentModeField } from "./WorkflowExperimentModeField";
import "./workflow-experiment.css";

export interface WorkflowExperimentDeskProps {
  threadId: string;
  plans: ExecutionPlan[];
  running: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onOpenThread: (threadId: string) => void | Promise<void>;
}

export default function WorkflowExperimentDesk({
  threadId,
  plans,
  running,
  selectedModelKey,
  selectedModelConfigured,
  onOpenThread,
}: WorkflowExperimentDeskProps) {
  const desk = useWorkflowExperimentDesk({
    threadId,
    plans,
    running,
    selectedModelKey,
    selectedModelConfigured,
  });
  const disabled = Boolean(desk.busy);

  return (
    <article
      className="workflow-experiment-desk"
      aria-labelledby="workflow-experiment-title"
      aria-busy={disabled}
    >
      <header className="workflow-experiment-heading">
        <div className="workflow-experiment-seal" aria-hidden="true">
          <FlaskConical size={17} />
        </div>
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="workflow-experiment-title">{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <span className="workflow-experiment-folio">
          {desk.manifest
            ? desk.manifest.nodeCount.toString().padStart(2, "0")
            : "--"}
        </span>
      </header>

      <div className="workflow-experiment-controls">
        <WorkflowExperimentManifestField
          busy={disabled}
          filename={desk.manifestFilename}
          manifestAvailable={Boolean(desk.manifest)}
          onFile={(file) => void desk.loadManifest(file)}
        />
        <label>
          <span>{copy.sourcePlan}</span>
          <select
            value={desk.sourcePlanId}
            disabled={disabled}
            onChange={(event) => {
              desk.setSourcePlanId(event.target.value);
              desk.invalidatePreview();
            }}
          >
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {shortWorkflowExperimentId(plan.id)} / {plan.status} /{" "}
                {plan.objective}
              </option>
            ))}
          </select>
        </label>
        <WorkflowExperimentCheckpointField
          manifest={desk.manifest}
          mode={desk.mode}
          value={desk.fromNodeId}
          busy={disabled}
          onChange={(nodeId) => {
            desk.setFromNodeId(nodeId);
            const node = desk.manifest?.nodes.find(
              (candidate) => candidate.id === nodeId,
            );
            if (node?.type !== "agent" && node?.type !== "map") {
              desk.setReplaceModel(false);
            }
            desk.setSimulatedOutput("");
            desk.setReplacementInput("");
            desk.setReplacementWorkflowInput("");
            desk.invalidatePreview();
          }}
        />
        <WorkflowExperimentModeField
          mode={desk.mode}
          simulatedOutput={desk.simulatedOutput}
          replacementInput={desk.replacementInput}
          replacementWorkflowInput={desk.replacementWorkflowInput}
          disabled={!desk.manifest || disabled}
          onModeChange={(next) => {
            desk.setMode(next);
            if (next === "simulate_node" || next === "replace_workflow_input") {
              desk.setReplaceModel(false);
            }
            desk.invalidatePreview();
          }}
          onSimulatedOutputChange={(next) => {
            desk.setSimulatedOutput(next);
            desk.invalidatePreview();
          }}
          onReplacementInputChange={(next) => {
            desk.setReplacementInput(next);
            desk.invalidatePreview();
          }}
          onReplacementWorkflowInputChange={(next) => {
            desk.setReplacementWorkflowInput(next);
            desk.invalidatePreview();
          }}
        />
        <WorkflowExperimentModelField
          mode={desk.mode}
          manifestAvailable={Boolean(desk.manifest)}
          canReplaceModel={desk.canReplaceModel}
          selectedModelConfigured={selectedModelConfigured}
          selectedModelKey={selectedModelKey}
          checked={desk.replaceModel}
          busy={disabled}
          onChange={(checked) => {
            desk.setReplaceModel(checked);
            desk.invalidatePreview();
          }}
        />
        <div className="workflow-experiment-actions">
          <button
            type="button"
            disabled={
              !desk.manifest ||
              !desk.sourcePlanId ||
              (desk.mode !== "replace_workflow_input" && !desk.fromNodeId) ||
              (desk.mode === "simulate_node" &&
                desk.simulatedOutput.trim() === "") ||
              (desk.mode === "replace_input" &&
                desk.replacementInput.trim() === "") ||
              (desk.mode === "replace_workflow_input" &&
                desk.replacementWorkflowInput.trim() === "") ||
              running ||
              disabled
            }
            onClick={() => void desk.preview()}
          >
            <GitCompareArrows size={12} aria-hidden="true" />
            {desk.busy === "preview" ? copy.previewing : copy.preview}
          </button>
          <button
            type="button"
            className="is-secondary"
            disabled={disabled || (!desk.manifest && !desk.result)}
            onClick={desk.reset}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {copy.reset}
          </button>
        </div>
      </div>

      {!desk.manifest && !desk.previewState && !desk.result ? (
        <p className="workflow-experiment-empty">{copy.empty}</p>
      ) : null}
      {desk.previewState ? (
        <WorkflowExperimentPreviewDocket
          preview={desk.previewState.preview}
          confirmed={desk.confirmed}
          busy={disabled}
          disabled={disabled || running}
          streamedFrameCount={desk.streamedFrameCount}
          onConfirmed={desk.setConfirmed}
          onExecute={() => void desk.execute()}
        />
      ) : null}
      {desk.comparison && desk.result ? (
        <WorkflowExperimentComparisonDocket
          view={desk.comparison}
          result={desk.result}
          onOpenThread={() => void onOpenThread(desk.result!.targetThreadId)}
          onDownload={() => desk.download()}
        />
      ) : null}
      {desk.error ? (
        <p className="workflow-experiment-error" role="alert">
          {desk.error}
        </p>
      ) : null}
    </article>
  );
}

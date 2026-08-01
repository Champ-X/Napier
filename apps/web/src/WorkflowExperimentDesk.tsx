import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, GitCompareArrows, RotateCcw } from "lucide-react";

import type {
  ExecutionPlan,
  ExecutionPlanWorkflowExperimentMode,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";

import { formatApiErrorMessage } from "./api-error";
import {
  executeWorkflowExperiment,
  previewWorkflowExperiment,
  type WorkflowExperimentWebRequest,
} from "./workflow-experiment-api";
import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";
import {
  buildWorkflowExperimentRequest,
  defaultWorkflowExperimentSourcePlanId,
  downloadWorkflowExperimentResult,
  loadWorkflowExperimentManifest,
  shortWorkflowExperimentId,
} from "./workflow-experiment-desk-helpers";
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
import { projectWorkflowExperimentComparison } from "./workflow-experiment-view-model";
import "./workflow-experiment.css";

interface PreviewState {
  preview: ExecutionPlanWorkflowExperimentPreview;
  request: WorkflowExperimentWebRequest;
  planId: string;
}

export default function WorkflowExperimentDesk({
  threadId,
  plans,
  running,
  selectedModelKey,
  selectedModelConfigured,
  onOpenThread,
}: {
  threadId: string;
  plans: ExecutionPlan[];
  running: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onOpenThread: (threadId: string) => void | Promise<void>;
}) {
  const [manifest, setManifest] = useState<ExecutionPlanWorkflowManifest>();
  const [manifestFilename, setManifestFilename] = useState("");
  const [sourcePlanId, setSourcePlanId] = useState(
    defaultWorkflowExperimentSourcePlanId(plans),
  );
  const [fromNodeId, setFromNodeId] = useState("");
  const [mode, setMode] =
    useState<ExecutionPlanWorkflowExperimentMode>("subgraph");
  const [simulatedOutput, setSimulatedOutput] = useState("");
  const [replacementInput, setReplacementInput] = useState("");
  const [replacementWorkflowInput, setReplacementWorkflowInput] = useState("");
  const [replaceModel, setReplaceModel] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>();
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] =
    useState<ExecutionPlanWorkflowExperimentResultFrame>();
  const [busy, setBusy] = useState<"manifest" | "preview" | "execute">();
  const [streamedFrameCount, setStreamedFrameCount] = useState(0);
  const [error, setError] = useState<string>();
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const operationGeneration = useRef(0);
  const selectedNode = manifest?.nodes.find((node) => node.id === fromNodeId);
  const canReplaceModel =
    mode !== "simulate_node" &&
    mode !== "replace_workflow_input" &&
    (selectedNode?.type === "agent" || selectedNode?.type === "map");

  const comparison = useMemo(
    () =>
      result?.experiment.comparison
        ? projectWorkflowExperimentComparison(result.experiment.comparison)
        : undefined,
    [result],
  );

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    operationGeneration.current += 1;
    setManifest(undefined);
    setManifestFilename("");
    setSourcePlanId(defaultWorkflowExperimentSourcePlanId(plans));
    setFromNodeId("");
    setMode("subgraph");
    setSimulatedOutput("");
    setReplacementInput("");
    setReplacementWorkflowInput("");
    setReplaceModel(false);
    setPreviewState(undefined);
    setConfirmed(false);
    setResult(undefined);
    setBusy(undefined);
    setStreamedFrameCount(0);
    setError(undefined);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = undefined;
      operationGeneration.current += 1;
    };
  }, [threadId]);

  useEffect(() => {
    if (!plans.some((plan) => plan.id === sourcePlanId)) {
      setSourcePlanId(defaultWorkflowExperimentSourcePlanId(plans));
      invalidatePreview();
    }
  }, [plans, sourcePlanId]);

  useEffect(() => {
    if (replaceModel) invalidatePreview();
  }, [selectedModelKey, selectedModelConfigured]);

  const startOperation = (): {
    controller: AbortController;
    generation: number;
  } => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    const generation = operationGeneration.current + 1;
    operationGeneration.current = generation;
    activeRequest.current = controller;
    return { controller, generation };
  };

  const isCurrentOperation = (
    controller: AbortController,
    generation: number,
  ): boolean =>
    !controller.signal.aborted &&
    activeRequest.current === controller &&
    operationGeneration.current === generation;

  const finishOperation = (
    controller: AbortController,
    generation: number,
  ): void => {
    if (!isCurrentOperation(controller, generation)) return;
    activeRequest.current = undefined;
    setBusy(undefined);
  };

  const clearPreview = (): void => {
    setPreviewState(undefined);
    setConfirmed(false);
    setResult(undefined);
    setStreamedFrameCount(0);
  };

  const invalidatePreview = (): void => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    operationGeneration.current += 1;
    clearPreview();
    setBusy(undefined);
  };

  const loadManifest = async (file: File): Promise<void> => {
    const operation = startOperation();
    setBusy("manifest");
    setError(undefined);
    clearPreview();
    try {
      const parsed = await loadWorkflowExperimentManifest(file);
      if (!isCurrentOperation(operation.controller, operation.generation)) {
        return;
      }
      setManifest(parsed);
      setManifestFilename(file.name);
      setFromNodeId(parsed.outputNodeId);
      setSimulatedOutput("");
      setReplacementInput("");
      setReplacementWorkflowInput("");
    } catch (loadError) {
      if (!isCurrentOperation(operation.controller, operation.generation)) {
        return;
      }
      setManifest(undefined);
      setManifestFilename("");
      setFromNodeId("");
      setError(
        loadError instanceof Error
          ? loadError.message
          : copy.errors.manifestInvalid,
      );
    } finally {
      finishOperation(operation.controller, operation.generation);
    }
  };

  const preview = async (): Promise<void> => {
    if (!manifest || !sourcePlanId || busy) return;
    const operation = startOperation();
    setBusy("preview");
    setError(undefined);
    clearPreview();
    try {
      const request = buildWorkflowExperimentRequest({
        manifest,
        fromNodeId,
        mode,
        simulatedOutput,
        replacementInput,
        replacementWorkflowInput,
        replaceModel,
        canReplaceModel,
        selectedModelKey,
      });
      const projected = await previewWorkflowExperiment(
        threadId,
        sourcePlanId,
        request,
        operation.controller.signal,
      );
      if (!isCurrentOperation(operation.controller, operation.generation)) {
        return;
      }
      setPreviewState({ preview: projected, request, planId: sourcePlanId });
    } catch (previewError) {
      if (!isCurrentOperation(operation.controller, operation.generation)) {
        return;
      }
      setError(formatApiErrorMessage(previewError));
    } finally {
      finishOperation(operation.controller, operation.generation);
    }
  };

  const execute = async (): Promise<void> => {
    if (running) {
      setError(copy.errors.sourceRunning);
      return;
    }
    if (!previewState || busy) {
      setError(copy.errors.previewRequired);
      return;
    }
    if (previewState.preview.requiresSideEffectConfirmation && !confirmed) {
      setError(copy.errors.confirmationRequired);
      return;
    }
    const operation = startOperation();
    setBusy("execute");
    setError(undefined);
    setResult(undefined);
    setStreamedFrameCount(0);
    try {
      const frame = await executeWorkflowExperiment(
        threadId,
        previewState.planId,
        {
          ...previewState.request,
          expectedPreviewSha256: previewState.preview.previewSha256,
          ...(previewState.preview.requiresSideEffectConfirmation
            ? { confirmSideEffects: true }
            : {}),
        },
        previewState.preview,
        () => {
          if (isCurrentOperation(operation.controller, operation.generation)) {
            setStreamedFrameCount((count) => count + 1);
          }
        },
        operation.controller.signal,
      );
      if (!isCurrentOperation(operation.controller, operation.generation)) {
        return;
      }
      setResult(frame);
    } catch (executeError) {
      if (!isCurrentOperation(operation.controller, operation.generation)) {
        return;
      }
      setError(formatApiErrorMessage(executeError));
    } finally {
      finishOperation(operation.controller, operation.generation);
    }
  };

  const reset = (): void => {
    invalidatePreview();
    setManifest(undefined);
    setManifestFilename("");
    setFromNodeId("");
    setMode("subgraph");
    setSimulatedOutput("");
    setReplacementInput("");
    setReplacementWorkflowInput("");
    setReplaceModel(false);
    setError(undefined);
  };

  const download = (): void => {
    if (!result) return;
    downloadWorkflowExperimentResult(result);
  };

  return (
    <article
      className="workflow-experiment-desk"
      aria-labelledby="workflow-experiment-title"
      aria-busy={Boolean(busy)}
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
          {manifest ? manifest.nodeCount.toString().padStart(2, "0") : "--"}
        </span>
      </header>

      <div className="workflow-experiment-controls">
        <WorkflowExperimentManifestField
          busy={Boolean(busy)}
          filename={manifestFilename}
          manifestAvailable={Boolean(manifest)}
          onFile={(file) => void loadManifest(file)}
        />

        <label>
          <span>{copy.sourcePlan}</span>
          <select
            value={sourcePlanId}
            disabled={Boolean(busy)}
            onChange={(event) => {
              setSourcePlanId(event.target.value);
              invalidatePreview();
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
          manifest={manifest}
          mode={mode}
          value={fromNodeId}
          busy={Boolean(busy)}
          onChange={(nodeId) => {
            setFromNodeId(nodeId);
            const node = manifest?.nodes.find(
              (candidate) => candidate.id === nodeId,
            );
            if (node?.type !== "agent" && node?.type !== "map") {
              setReplaceModel(false);
            }
            setSimulatedOutput("");
            setReplacementInput("");
            setReplacementWorkflowInput("");
            invalidatePreview();
          }}
        />

        <WorkflowExperimentModeField
          mode={mode}
          simulatedOutput={simulatedOutput}
          replacementInput={replacementInput}
          replacementWorkflowInput={replacementWorkflowInput}
          disabled={!manifest || Boolean(busy)}
          onModeChange={(next) => {
            setMode(next);
            if (next === "simulate_node" || next === "replace_workflow_input") {
              setReplaceModel(false);
            }
            invalidatePreview();
          }}
          onSimulatedOutputChange={(next) => {
            setSimulatedOutput(next);
            invalidatePreview();
          }}
          onReplacementInputChange={(next) => {
            setReplacementInput(next);
            invalidatePreview();
          }}
          onReplacementWorkflowInputChange={(next) => {
            setReplacementWorkflowInput(next);
            invalidatePreview();
          }}
        />

        <WorkflowExperimentModelField
          mode={mode}
          manifestAvailable={Boolean(manifest)}
          canReplaceModel={canReplaceModel}
          selectedModelConfigured={selectedModelConfigured}
          selectedModelKey={selectedModelKey}
          checked={replaceModel}
          busy={Boolean(busy)}
          onChange={(checked) => {
            setReplaceModel(checked);
            invalidatePreview();
          }}
        />

        <div className="workflow-experiment-actions">
          <button
            type="button"
            disabled={
              !manifest ||
              !sourcePlanId ||
              (mode !== "replace_workflow_input" && !fromNodeId) ||
              (mode === "simulate_node" && simulatedOutput.trim() === "") ||
              (mode === "replace_input" && replacementInput.trim() === "") ||
              (mode === "replace_workflow_input" &&
                replacementWorkflowInput.trim() === "") ||
              running ||
              Boolean(busy)
            }
            onClick={() => void preview()}
          >
            <GitCompareArrows size={12} aria-hidden="true" />
            {busy === "preview" ? copy.previewing : copy.preview}
          </button>
          <button
            type="button"
            className="is-secondary"
            disabled={Boolean(busy) || (!manifest && !result)}
            onClick={reset}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {copy.reset}
          </button>
        </div>
      </div>

      {!manifest && !previewState && !result ? (
        <p className="workflow-experiment-empty">{copy.empty}</p>
      ) : null}

      {previewState ? (
        <WorkflowExperimentPreviewDocket
          preview={previewState.preview}
          confirmed={confirmed}
          busy={Boolean(busy)}
          disabled={Boolean(busy) || running}
          streamedFrameCount={streamedFrameCount}
          onConfirmed={setConfirmed}
          onExecute={() => void execute()}
        />
      ) : null}

      {comparison && result ? (
        <WorkflowExperimentComparisonDocket
          view={comparison}
          result={result}
          onOpenThread={() => void onOpenThread(result.targetThreadId)}
          onDownload={download}
        />
      ) : null}

      {error ? (
        <p className="workflow-experiment-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

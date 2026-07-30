import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlaskConical,
  GitCompareArrows,
  RotateCcw,
  Upload,
} from "lucide-react";

import type {
  ExecutionPlan,
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
  WorkflowExperimentComparisonDocket,
  WorkflowExperimentPreviewDocket,
} from "./WorkflowExperimentDockets";
import {
  parseWorkflowManifestText,
  parseWorkflowModelKey,
  projectWorkflowExperimentComparison,
  workflowExperimentResultFilename,
} from "./workflow-experiment-view-model";
import "./workflow-experiment.css";

const MAX_MANIFEST_BYTES = 1024 * 1024;

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
  const [sourcePlanId, setSourcePlanId] = useState(defaultSourcePlanId(plans));
  const [fromNodeId, setFromNodeId] = useState("");
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
  const canReplaceModel = selectedNode?.type === "agent";

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
    setSourcePlanId(defaultSourcePlanId(plans));
    setFromNodeId("");
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
      setSourcePlanId(defaultSourcePlanId(plans));
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
    if (file.size > MAX_MANIFEST_BYTES) {
      setError(copy.errors.manifestTooLarge);
      return;
    }
    const operation = startOperation();
    setBusy("manifest");
    setError(undefined);
    clearPreview();
    try {
      const parsed = await parseWorkflowManifestText(await file.text());
      if (!isCurrentOperation(operation.controller, operation.generation)) {
        return;
      }
      setManifest(parsed);
      setManifestFilename(file.name);
      setFromNodeId(parsed.outputNodeId);
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

  const buildRequest = (): WorkflowExperimentWebRequest => {
    if (!manifest || !fromNodeId) throw new Error(copy.errors.previewRequired);
    return {
      manifest,
      fromNodeId,
      ...(replaceModel && canReplaceModel
        ? {
            modelOverrides: {
              [fromNodeId]: parseWorkflowModelKey(selectedModelKey),
            },
          }
        : {}),
    };
  };

  const preview = async (): Promise<void> => {
    if (!manifest || !sourcePlanId || busy) return;
    const operation = startOperation();
    setBusy("preview");
    setError(undefined);
    clearPreview();
    try {
      const request = buildRequest();
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
    setReplaceModel(false);
    setError(undefined);
  };

  const download = (): void => {
    if (!result) return;
    downloadJson(result, workflowExperimentResultFilename(result));
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
        <label className="workflow-experiment-file">
          <input
            type="file"
            accept="application/json,.json"
            disabled={Boolean(busy)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void loadManifest(file);
            }}
          />
          <Upload size={13} aria-hidden="true" />
          <span>
            <small>{copy.manifest}</small>
            <strong>
              {busy === "manifest"
                ? copy.previewing
                : manifestFilename ||
                  (manifest ? copy.manifestReady : copy.loadManifest)}
            </strong>
          </span>
        </label>

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
                {shortId(plan.id)} / {plan.status} / {plan.objective}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{copy.checkpoint}</span>
          <select
            value={fromNodeId}
            disabled={!manifest || Boolean(busy)}
            onChange={(event) => {
              setFromNodeId(event.target.value);
              const node = manifest?.nodes.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (node?.type !== "agent") setReplaceModel(false);
              invalidatePreview();
            }}
          >
            {(manifest?.nodes ?? []).map((node) => (
              <option key={node.id} value={node.id}>
                {node.id} / {node.type === "tool" ? node.tool : node.type}
              </option>
            ))}
          </select>
        </label>

        <label className="workflow-experiment-model">
          <input
            type="checkbox"
            checked={replaceModel && canReplaceModel}
            disabled={
              !manifest ||
              !canReplaceModel ||
              !selectedModelConfigured ||
              Boolean(busy)
            }
            onChange={(event) => {
              setReplaceModel(event.target.checked);
              invalidatePreview();
            }}
          />
          <span>
            <small>{copy.overrideModel}</small>
            <strong>{selectedModelKey}</strong>
          </span>
        </label>
        <p className="workflow-experiment-model-hint">
          {!canReplaceModel
            ? copy.toolModelUnavailable
            : selectedModelConfigured
              ? copy.overrideHint
              : copy.unavailableModel}
        </p>

        <div className="workflow-experiment-actions">
          <button
            type="button"
            disabled={
              !manifest ||
              !sourcePlanId ||
              !fromNodeId ||
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

function defaultSourcePlanId(plans: ExecutionPlan[]): string {
  return (
    plans.findLast((plan) => plan.status === "completed")?.id ??
    plans.findLast((plan) => plan.status === "blocked")?.id ??
    plans.at(-1)?.id ??
    ""
  );
}

function shortId(value: string): string {
  return value.length > 18
    ? `${value.slice(0, 10)}...${value.slice(-6)}`
    : value;
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

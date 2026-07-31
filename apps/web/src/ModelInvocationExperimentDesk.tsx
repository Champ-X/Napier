import { useEffect, useMemo, useRef, useState } from "react";
import {
  GitCompareArrows,
  RadioTower,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import type {
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResultFrame,
} from "@napier/contracts";

import { formatApiErrorMessage } from "./api-error";
import type { WebThreadDetail } from "./api";
import "./agent-message-experiment.css";
import {
  executeModelInvocationExperiment,
  previewModelInvocationExperiment,
  type ModelInvocationExperimentWebRequest,
} from "./model-invocation-experiment-api";
import { modelInvocationExperimentCopy as copy } from "./model-invocation-experiment-copy";
import {
  modelInvocationCheckpoints,
  modelInvocationExperimentResultFilename,
  parseModelInvocationExperimentModelKey,
  projectModelInvocationExperimentComparison,
} from "./model-invocation-experiment-view-model";
import {
  ModelInvocationExperimentComparisonDocket,
  ModelInvocationExperimentPreviewDocket,
} from "./ModelInvocationExperimentDockets";
import "./model-invocation-experiment.css";

interface PreviewState {
  preview: ModelInvocationExperimentPreview;
  request: ModelInvocationExperimentWebRequest;
  checkpointKey: string;
}

export default function ModelInvocationExperimentDesk({
  detail,
  running,
  selectedModelKey,
  selectedModelEligible,
  onOpenThread,
}: {
  detail: WebThreadDetail;
  running: boolean;
  selectedModelKey: string;
  selectedModelEligible: boolean;
  onOpenThread: (threadId: string) => void | Promise<void>;
}) {
  const checkpoints = useMemo(
    () => modelInvocationCheckpoints(detail.runs, detail.events),
    [detail.runs, detail.events],
  );
  const [checkpointKey, setCheckpointKey] = useState(
    checkpoints.at(-1)?.key ?? "",
  );
  const [replaceModel, setReplaceModel] = useState(false);
  const [title, setTitle] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>();
  const [result, setResult] = useState<ModelInvocationExperimentResultFrame>();
  const [busy, setBusy] = useState<"preview" | "execute">();
  const [streamedFrameCount, setStreamedFrameCount] = useState(0);
  const [error, setError] = useState<string>();
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const operationGeneration = useRef(0);
  const checkpoint = checkpoints.find(
    (candidate) => candidate.key === checkpointKey,
  );
  const comparison = result
    ? projectModelInvocationExperimentComparison(result.experiment.comparison)
    : undefined;

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    operationGeneration.current += 1;
    setCheckpointKey(checkpoints.at(-1)?.key ?? "");
    setReplaceModel(false);
    setTitle("");
    setPreviewState(undefined);
    setResult(undefined);
    setBusy(undefined);
    setStreamedFrameCount(0);
    setError(undefined);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = undefined;
      operationGeneration.current += 1;
    };
  }, [detail.thread.id]);

  useEffect(() => {
    if (
      checkpointKey &&
      !checkpoints.some((candidate) => candidate.key === checkpointKey)
    ) {
      setCheckpointKey(checkpoints.at(-1)?.key ?? "");
      invalidatePreview();
    }
  }, [checkpoints, checkpointKey]);

  useEffect(() => {
    if (replaceModel) invalidatePreview();
  }, [selectedModelKey, selectedModelEligible]);

  const startOperation = () => {
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

  const clearResult = (): void => {
    setPreviewState(undefined);
    setResult(undefined);
    setStreamedFrameCount(0);
  };

  function invalidatePreview(): void {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    operationGeneration.current += 1;
    clearResult();
    setBusy(undefined);
  }

  const buildRequest = (): ModelInvocationExperimentWebRequest => {
    if (!checkpoint) throw new Error(copy.errors.checkpointRequired);
    if (replaceModel && !selectedModelEligible) {
      throw new Error(copy.errors.candidateUnavailable);
    }
    const normalizedTitle = title.replace(/\s+/gu, " ").trim();
    return {
      sourceRunId: checkpoint.runId,
      sourceTurnIndex: checkpoint.turnIndex,
      ...(replaceModel
        ? { model: parseModelInvocationExperimentModelKey(selectedModelKey) }
        : {}),
      ...(normalizedTitle ? { title: normalizedTitle } : {}),
    };
  };

  const preview = async (): Promise<void> => {
    if (!checkpoint || busy || running) return;
    const operation = startOperation();
    setBusy("preview");
    setError(undefined);
    clearResult();
    try {
      const request = buildRequest();
      const projected = await previewModelInvocationExperiment(
        detail.thread.id,
        request,
        operation.controller.signal,
      );
      if (!isCurrentOperation(operation.controller, operation.generation)) {
        return;
      }
      setPreviewState({
        preview: projected,
        request,
        checkpointKey: checkpoint.key,
      });
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
      setError(copy.sourceRunning);
      return;
    }
    if (!previewState || previewState.checkpointKey !== checkpointKey || busy) {
      setError(copy.errors.previewRequired);
      return;
    }
    const operation = startOperation();
    setBusy("execute");
    setError(undefined);
    setResult(undefined);
    setStreamedFrameCount(0);
    try {
      const frame = await executeModelInvocationExperiment(
        detail.thread.id,
        {
          ...previewState.request,
          expectedPreviewSha256: previewState.preview.previewSha256,
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
    setReplaceModel(false);
    setTitle("");
    setError(undefined);
  };

  const cancel = (): void => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    operationGeneration.current += 1;
    setBusy(undefined);
    setStreamedFrameCount(0);
    setError(undefined);
  };

  const download = (): void => {
    if (!result) return;
    downloadJson(result, modelInvocationExperimentResultFilename(result));
  };

  return (
    <article
      className="agent-experiment-desk model-experiment-desk"
      aria-labelledby="model-experiment-title"
      aria-busy={Boolean(busy)}
    >
      <header className="agent-experiment-heading">
        <div
          className="agent-experiment-seal model-experiment-seal"
          aria-hidden="true"
        >
          <RadioTower size={17} />
        </div>
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="model-experiment-title">{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <span className="agent-experiment-folio model-experiment-folio">
          {checkpoint
            ? `T${String(checkpoint.turnIndex).padStart(3, "0")}`
            : "T---"}
        </span>
      </header>

      <div className="agent-experiment-controls">
        <label className="agent-experiment-checkpoint">
          <span>{copy.checkpoint}</span>
          <select
            value={checkpointKey}
            disabled={Boolean(busy) || checkpoints.length === 0}
            onChange={(event) => {
              setCheckpointKey(event.target.value);
              invalidatePreview();
            }}
          >
            <option value="">{copy.selectCheckpoint}</option>
            {checkpoints.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {String(candidate.runIndex).padStart(2, "0")} / T
                {String(candidate.turnIndex).padStart(3, "0")} /{" "}
                {candidate.purpose} / {candidate.model.provider}/
                {candidate.model.id} / {candidate.status}
              </option>
            ))}
          </select>
        </label>

        <label className="agent-experiment-model">
          <input
            type="checkbox"
            checked={replaceModel}
            disabled={!checkpoint || !selectedModelEligible || Boolean(busy)}
            onChange={(event) => {
              setReplaceModel(event.target.checked);
              invalidatePreview();
            }}
          />
          <span>
            <small>{copy.modelOverride}</small>
            <strong>
              {replaceModel ? selectedModelKey : copy.modelOriginal}
            </strong>
          </span>
        </label>

        <label className="agent-experiment-title-field">
          <span>{copy.titleLabel}</span>
          <input
            type="text"
            value={title}
            maxLength={100}
            placeholder={copy.titlePlaceholder}
            disabled={Boolean(busy)}
            onChange={(event) => {
              setTitle(event.target.value);
              invalidatePreview();
            }}
          />
        </label>

        <div className="agent-experiment-actions">
          <button
            type="button"
            disabled={!checkpoint || running || Boolean(busy)}
            onClick={() => void preview()}
          >
            <GitCompareArrows size={12} aria-hidden="true" />
            {busy === "preview" ? copy.previewing : copy.preview}
          </button>
          <button
            type="button"
            className="is-secondary"
            disabled={Boolean(busy) || (!previewState && !result)}
            onClick={reset}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {copy.reset}
          </button>
        </div>
      </div>

      {!checkpoint && !previewState && !result ? (
        <p className="agent-experiment-empty">{copy.empty}</p>
      ) : null}

      {previewState ? (
        <ModelInvocationExperimentPreviewDocket
          preview={previewState.preview}
          busy={Boolean(busy)}
          running={running}
          streamedFrameCount={streamedFrameCount}
          onCancel={cancel}
          onExecute={() => void execute()}
        />
      ) : null}

      {comparison && result ? (
        <ModelInvocationExperimentComparisonDocket
          result={result}
          comparison={comparison}
          onOpenThread={() => void onOpenThread(result.targetThreadId)}
          onDownload={download}
        />
      ) : null}

      {error ? (
        <p className="agent-experiment-error" role="alert">
          {error}
        </p>
      ) : null}

      <p className="agent-experiment-safety">
        <ShieldCheck size={12} aria-hidden="true" />
        {copy.safety}
      </p>
    </article>
  );
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

import { useEffect, useMemo, useRef, useState } from "react";
import { GitCompareArrows, RotateCcw, ShieldCheck, Wrench } from "lucide-react";

import type {
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import "./agent-message-experiment.css";
import { formatApiErrorMessage } from "./api-error";
import type { WebThreadDetail } from "./api";
import "./model-invocation-experiment.css";
import {
  executeToolInvocationExperiment,
  previewToolInvocationExperiment,
  type ToolInvocationExperimentWebRequest,
} from "./tool-invocation-experiment-api";
import { toolInvocationExperimentCopy as copy } from "./tool-invocation-experiment-copy";
import {
  projectToolInvocationExperimentComparison,
  toolInvocationCheckpoints,
  toolInvocationExperimentResultFilename,
} from "./tool-invocation-experiment-view-model";
import "./tool-invocation-experiment.css";
import {
  ToolInvocationExperimentComparisonDocket,
  ToolInvocationExperimentPreviewDocket,
} from "./ToolInvocationExperimentDockets";

interface PreviewState {
  preview: ToolInvocationExperimentPreview;
  request: ToolInvocationExperimentWebRequest;
  checkpointKey: string;
}

export default function ToolInvocationExperimentDesk({
  detail,
  running,
  onOpenThread,
}: {
  detail: WebThreadDetail;
  running: boolean;
  onOpenThread: (threadId: string) => void | Promise<void>;
}) {
  const checkpoints = useMemo(
    () => toolInvocationCheckpoints(detail.runs, detail.events),
    [detail.runs, detail.events],
  );
  const [checkpointKey, setCheckpointKey] = useState(
    checkpoints.at(-1)?.key ?? "",
  );
  const [title, setTitle] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>();
  const [result, setResult] = useState<ToolInvocationExperimentResultFrame>();
  const [busy, setBusy] = useState<"preview" | "execute">();
  const [streamedFrameCount, setStreamedFrameCount] = useState(0);
  const [error, setError] = useState<string>();
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const operationGeneration = useRef(0);
  const checkpoint = checkpoints.find(
    (candidate) => candidate.key === checkpointKey,
  );
  const comparison = result
    ? projectToolInvocationExperimentComparison(result.experiment.comparison)
    : undefined;

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    operationGeneration.current += 1;
    setCheckpointKey(checkpoints.at(-1)?.key ?? "");
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

  const buildRequest = (): ToolInvocationExperimentWebRequest => {
    if (!checkpoint) throw new Error(copy.errors.checkpointRequired);
    const normalizedTitle = title.replace(/\s+/gu, " ").trim();
    return {
      sourceRunId: checkpoint.runId,
      sourceCallId: checkpoint.callId,
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
      const projected = await previewToolInvocationExperiment(
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
      const frame = await executeToolInvocationExperiment(
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
    downloadJson(result, toolInvocationExperimentResultFilename(result));
  };

  return (
    <article
      className="agent-experiment-desk model-experiment-desk tool-experiment-desk"
      aria-labelledby="tool-experiment-title"
      aria-busy={Boolean(busy)}
    >
      <header className="agent-experiment-heading">
        <div
          className="agent-experiment-seal model-experiment-seal tool-experiment-seal"
          aria-hidden="true"
        >
          <Wrench size={17} />
        </div>
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="tool-experiment-title">{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <span className="agent-experiment-folio model-experiment-folio">
          {checkpoint ? checkpoint.toolName.slice(0, 12) : "NO CALL"}
        </span>
      </header>

      <div className="agent-experiment-controls tool-experiment-controls">
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
                {String(candidate.runIndex).padStart(2, "0")} /{" "}
                {candidate.toolName} / {candidate.status}
              </option>
            ))}
          </select>
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
        <ToolInvocationExperimentPreviewDocket
          preview={previewState.preview}
          busy={Boolean(busy)}
          running={running}
          streamedFrameCount={streamedFrameCount}
          onCancel={cancel}
          onExecute={() => void execute()}
        />
      ) : null}

      {comparison && result ? (
        <ToolInvocationExperimentComparisonDocket
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

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import "./agent-message-experiment.css";
import { formatApiErrorMessage } from "./api-error";
import type { WebThreadDetail } from "./api";
import { downloadJsonArtifact } from "./download-json-artifact";
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
import { ToolInvocationExperimentView } from "./ToolInvocationExperimentView";

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
    downloadJsonArtifact(
      result,
      toolInvocationExperimentResultFilename(result),
    );
  };

  return (
    <ToolInvocationExperimentView
      checkpoints={checkpoints}
      checkpoint={checkpoint}
      checkpointKey={checkpointKey}
      title={title}
      preview={previewState?.preview}
      result={result}
      comparison={comparison}
      busy={busy}
      running={running}
      streamedFrameCount={streamedFrameCount}
      error={error}
      onCheckpointKey={setCheckpointKey}
      onTitle={setTitle}
      onInvalidate={invalidatePreview}
      onPreview={() => void preview()}
      onReset={reset}
      onCancel={cancel}
      onExecute={() => void execute()}
      onOpenThread={() => result && void onOpenThread(result.targetThreadId)}
      onDownload={download}
    />
  );
}

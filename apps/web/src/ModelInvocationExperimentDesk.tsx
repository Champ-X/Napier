import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResultFrame,
} from "@napier/contracts";

import { formatApiErrorMessage } from "./api-error";
import type { WebThreadDetail } from "./api";
import "./agent-message-experiment.css";
import { downloadJsonArtifact } from "./download-json-artifact";
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
import { ModelInvocationExperimentView } from "./ModelInvocationExperimentView";
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
    downloadJsonArtifact(
      result,
      modelInvocationExperimentResultFilename(result),
    );
  };

  return (
    <ModelInvocationExperimentView
      checkpoints={checkpoints}
      checkpoint={checkpoint}
      checkpointKey={checkpointKey}
      replaceModel={replaceModel}
      title={title}
      selectedModelKey={selectedModelKey}
      selectedModelEligible={selectedModelEligible}
      preview={previewState?.preview}
      result={result}
      comparison={comparison}
      busy={busy}
      running={running}
      streamedFrameCount={streamedFrameCount}
      error={error}
      onCheckpointKey={setCheckpointKey}
      onReplaceModel={setReplaceModel}
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

import { useEffect, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";

export type ExperimentDeskOperation = "preview" | "execute";

interface ExperimentCheckpoint {
  key: string;
}

interface ExperimentPreview {
  previewSha256: string;
}

interface PreviewState<Preview, Request> {
  preview: Preview;
  request: Request;
  checkpointKey: string;
}

export interface ExperimentDeskLifecycleOptions<
  Checkpoint extends ExperimentCheckpoint,
  Request,
  Preview extends ExperimentPreview,
  Result,
> {
  threadId: string;
  checkpoints: readonly Checkpoint[];
  running: boolean;
  sourceRunningError: string;
  previewRequiredError: string;
  buildRequest(checkpoint: Checkpoint): Request;
  previewRequest(request: Request, signal: AbortSignal): Promise<Preview>;
  executeRequest(
    request: Request,
    preview: Preview,
    onFrame: () => void,
    signal: AbortSignal,
  ): Promise<Result>;
}

export function useExperimentDeskLifecycle<
  Checkpoint extends ExperimentCheckpoint,
  Request,
  Preview extends ExperimentPreview,
  Result,
>(
  options: ExperimentDeskLifecycleOptions<Checkpoint, Request, Preview, Result>,
) {
  const [checkpointKey, setCheckpointKey] = useState(
    options.checkpoints.at(-1)?.key ?? "",
  );
  const [previewState, setPreviewState] =
    useState<PreviewState<Preview, Request>>();
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState<ExperimentDeskOperation>();
  const [streamedFrameCount, setStreamedFrameCount] = useState(0);
  const [error, setError] = useState<string>();
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const operationGeneration = useRef(0);
  const checkpoint = options.checkpoints.find(
    (candidate) => candidate.key === checkpointKey,
  );

  const abortOperation = (): void => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    operationGeneration.current += 1;
  };

  const clearResult = (): void => {
    setPreviewState(undefined);
    setResult(undefined);
    setStreamedFrameCount(0);
  };

  const invalidatePreview = (): void => {
    abortOperation();
    clearResult();
    setBusy(undefined);
  };

  useEffect(() => {
    abortOperation();
    setCheckpointKey(options.checkpoints.at(-1)?.key ?? "");
    clearResult();
    setBusy(undefined);
    setError(undefined);
    return abortOperation;
  }, [options.threadId]);

  useEffect(() => {
    if (
      checkpointKey &&
      !options.checkpoints.some((candidate) => candidate.key === checkpointKey)
    ) {
      setCheckpointKey(options.checkpoints.at(-1)?.key ?? "");
      invalidatePreview();
    }
  }, [options.checkpoints, checkpointKey]);

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

  const preview = async (): Promise<void> => {
    if (!checkpoint || busy || options.running) return;
    const operation = startOperation();
    setBusy("preview");
    setError(undefined);
    clearResult();
    try {
      const request = options.buildRequest(checkpoint);
      const projected = await options.previewRequest(
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
    if (options.running) {
      setError(options.sourceRunningError);
      return;
    }
    if (!previewState || previewState.checkpointKey !== checkpointKey || busy) {
      setError(options.previewRequiredError);
      return;
    }
    const operation = startOperation();
    setBusy("execute");
    setError(undefined);
    setResult(undefined);
    setStreamedFrameCount(0);
    try {
      const frame = await options.executeRequest(
        previewState.request,
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
    setError(undefined);
  };

  const cancel = (): void => {
    abortOperation();
    setBusy(undefined);
    setStreamedFrameCount(0);
    setError(undefined);
  };

  return {
    checkpoint,
    checkpointKey,
    setCheckpointKey,
    preview: previewState?.preview,
    result,
    busy,
    streamedFrameCount,
    error,
    invalidatePreview,
    previewExperiment: preview,
    executeExperiment: execute,
    reset,
    cancel,
  };
}

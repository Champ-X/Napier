import { useEffect, useMemo, useState } from "react";

import type {
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResultFrame,
} from "@napier/contracts";

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
import { useExperimentDeskLifecycle } from "./use-experiment-desk-lifecycle";
import "./model-invocation-experiment.css";

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
  const [replaceModel, setReplaceModel] = useState(false);
  const [title, setTitle] = useState("");
  const lifecycle = useExperimentDeskLifecycle<
    (typeof checkpoints)[number],
    ModelInvocationExperimentWebRequest,
    ModelInvocationExperimentPreview,
    ModelInvocationExperimentResultFrame
  >({
    threadId: detail.thread.id,
    checkpoints,
    running,
    sourceRunningError: copy.sourceRunning,
    previewRequiredError: copy.errors.previewRequired,
    buildRequest: (checkpoint) => {
      if (replaceModel && !selectedModelEligible) {
        throw new Error(copy.errors.candidateUnavailable);
      }
      const normalizedTitle = title.replace(/\s+/gu, " ").trim();
      return {
        sourceRunId: checkpoint.runId,
        sourceTurnIndex: checkpoint.turnIndex,
        ...(replaceModel
          ? {
              model: parseModelInvocationExperimentModelKey(selectedModelKey),
            }
          : {}),
        ...(normalizedTitle ? { title: normalizedTitle } : {}),
      };
    },
    previewRequest: (request, signal) =>
      previewModelInvocationExperiment(detail.thread.id, request, signal),
    executeRequest: (request, preview, onFrame, signal) =>
      executeModelInvocationExperiment(
        detail.thread.id,
        { ...request, expectedPreviewSha256: preview.previewSha256 },
        preview,
        onFrame,
        signal,
      ),
  });
  const { checkpoint, checkpointKey, result } = lifecycle;
  const comparison = result
    ? projectModelInvocationExperimentComparison(result.experiment.comparison)
    : undefined;

  useEffect(() => {
    setReplaceModel(false);
    setTitle("");
  }, [detail.thread.id]);

  useEffect(() => {
    if (replaceModel) lifecycle.invalidatePreview();
  }, [selectedModelKey, selectedModelEligible]);

  const reset = (): void => {
    lifecycle.reset();
    setReplaceModel(false);
    setTitle("");
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
      preview={lifecycle.preview}
      result={result}
      comparison={comparison}
      busy={lifecycle.busy}
      running={running}
      streamedFrameCount={lifecycle.streamedFrameCount}
      error={lifecycle.error}
      onCheckpointKey={lifecycle.setCheckpointKey}
      onReplaceModel={setReplaceModel}
      onTitle={setTitle}
      onInvalidate={lifecycle.invalidatePreview}
      onPreview={() => void lifecycle.previewExperiment()}
      onReset={reset}
      onCancel={lifecycle.cancel}
      onExecute={() => void lifecycle.executeExperiment()}
      onOpenThread={() => result && void onOpenThread(result.targetThreadId)}
      onDownload={download}
    />
  );
}

import { useEffect, useMemo, useState } from "react";

import type {
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import "./agent-message-experiment.css";
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
import { useExperimentDeskLifecycle } from "./use-experiment-desk-lifecycle";

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
  const [title, setTitle] = useState("");
  const lifecycle = useExperimentDeskLifecycle<
    (typeof checkpoints)[number],
    ToolInvocationExperimentWebRequest,
    ToolInvocationExperimentPreview,
    ToolInvocationExperimentResultFrame
  >({
    threadId: detail.thread.id,
    checkpoints,
    running,
    sourceRunningError: copy.sourceRunning,
    previewRequiredError: copy.errors.previewRequired,
    buildRequest: (checkpoint) => {
      const normalizedTitle = title.replace(/\s+/gu, " ").trim();
      return {
        sourceRunId: checkpoint.runId,
        sourceCallId: checkpoint.callId,
        ...(normalizedTitle ? { title: normalizedTitle } : {}),
      };
    },
    previewRequest: (request, signal) =>
      previewToolInvocationExperiment(detail.thread.id, request, signal),
    executeRequest: (request, preview, onFrame, signal) =>
      executeToolInvocationExperiment(
        detail.thread.id,
        { ...request, expectedPreviewSha256: preview.previewSha256 },
        preview,
        onFrame,
        signal,
      ),
  });
  const { checkpoint, checkpointKey, result } = lifecycle;
  const comparison = result
    ? projectToolInvocationExperimentComparison(result.experiment.comparison)
    : undefined;

  useEffect(() => {
    setTitle("");
  }, [detail.thread.id]);

  const reset = (): void => {
    lifecycle.reset();
    setTitle("");
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
      preview={lifecycle.preview}
      result={result}
      comparison={comparison}
      busy={lifecycle.busy}
      running={running}
      streamedFrameCount={lifecycle.streamedFrameCount}
      error={lifecycle.error}
      onCheckpointKey={lifecycle.setCheckpointKey}
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

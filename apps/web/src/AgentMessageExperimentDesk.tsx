import { useEffect, useMemo, useState } from "react";

import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResultFrame,
} from "@napier/contracts";

import {
  executeAgentMessageExperiment,
  previewAgentMessageExperiment,
  type AgentMessageExperimentWebRequest,
} from "./agent-message-experiment-api";
import { agentMessageExperimentCopy as copy } from "./agent-message-experiment-copy";
import { AgentMessageExperimentView } from "./AgentMessageExperimentView";
import {
  agentMessageCheckpoints,
  agentMessageExperimentResultFilename,
  parseAgentExperimentModelKey,
  projectAgentMessageExperimentComparison,
} from "./agent-message-experiment-view-model";
import type { WebThreadDetail } from "./api";
import { downloadJsonArtifact } from "./download-json-artifact";
import { useExperimentDeskLifecycle } from "./use-experiment-desk-lifecycle";
import "./agent-message-experiment.css";

export default function AgentMessageExperimentDesk({
  detail,
  running,
  selectedModelKey,
  selectedModelConfigured,
  onOpenThread,
}: {
  detail: WebThreadDetail;
  running: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onOpenThread: (threadId: string) => void | Promise<void>;
}) {
  const checkpoints = useMemo(
    () => agentMessageCheckpoints(detail.runs, detail.events),
    [detail.runs, detail.events],
  );
  const [replaceModel, setReplaceModel] = useState(false);
  const [reuseToolResults, setReuseToolResults] = useState(false);
  const [title, setTitle] = useState("");
  const lifecycle = useExperimentDeskLifecycle<
    (typeof checkpoints)[number],
    AgentMessageExperimentWebRequest,
    AgentMessageExperimentPreview,
    AgentMessageExperimentResultFrame
  >({
    threadId: detail.thread.id,
    checkpoints,
    running,
    sourceRunningError: copy.sourceRunning,
    previewRequiredError: copy.errors.previewRequired,
    buildRequest: (checkpoint) => {
      if (replaceModel && !selectedModelConfigured) {
        throw new Error(copy.errors.candidateUnavailable);
      }
      const normalizedTitle = title.replace(/\s+/gu, " ").trim();
      return {
        sourceRunId: checkpoint.runId,
        sourceMessageSeq: checkpoint.messageSeq,
        ...(replaceModel
          ? { model: parseAgentExperimentModelKey(selectedModelKey) }
          : {}),
        ...(reuseToolResults
          ? { toolResultMode: "reuse_source" as const }
          : {}),
        ...(normalizedTitle ? { title: normalizedTitle } : {}),
      };
    },
    previewRequest: (request, signal) =>
      previewAgentMessageExperiment(detail.thread.id, request, signal),
    executeRequest: (request, preview, onFrame, signal) =>
      executeAgentMessageExperiment(
        detail.thread.id,
        { ...request, expectedPreviewSha256: preview.previewSha256 },
        preview,
        onFrame,
        signal,
      ),
  });
  const { checkpoint, checkpointKey, result } = lifecycle;
  const comparison = result
    ? projectAgentMessageExperimentComparison(result.experiment.comparison)
    : undefined;

  useEffect(() => {
    setReplaceModel(false);
    setReuseToolResults(false);
    setTitle("");
  }, [detail.thread.id]);

  useEffect(() => {
    if (replaceModel) lifecycle.invalidatePreview();
  }, [selectedModelKey, selectedModelConfigured]);

  const reset = (): void => {
    lifecycle.reset();
    setReplaceModel(false);
    setReuseToolResults(false);
    setTitle("");
  };

  const download = (): void => {
    if (!result) return;
    downloadJsonArtifact(result, agentMessageExperimentResultFilename(result));
  };

  return (
    <AgentMessageExperimentView
      checkpoints={checkpoints}
      checkpoint={checkpoint}
      checkpointKey={checkpointKey}
      replaceModel={replaceModel}
      reuseToolResults={reuseToolResults}
      title={title}
      selectedModelKey={selectedModelKey}
      selectedModelConfigured={selectedModelConfigured}
      preview={lifecycle.preview}
      result={result}
      comparison={comparison}
      busy={lifecycle.busy}
      running={running}
      streamedFrameCount={lifecycle.streamedFrameCount}
      error={lifecycle.error}
      onCheckpointKey={lifecycle.setCheckpointKey}
      onReplaceModel={setReplaceModel}
      onReuseToolResults={setReuseToolResults}
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

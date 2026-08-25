import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResult,
  AgentMessageExperimentToolResultMode,
  ModelRef,
  RunEvent,
} from "@napier/contracts";
import type { LocalAgentRuntimeServices } from "@napier/runtime/agent";

export interface PreviewNapierAgentMessageExperimentOptions {
  sourceThreadId: string;
  sourceRunId: string;
  sourceMessageSeq: number;
  model?: ModelRef;
  title?: string;
  toolResultMode?: AgentMessageExperimentToolResultMode;
  signal?: AbortSignal;
}

export interface RunNapierAgentMessageExperimentOptions extends PreviewNapierAgentMessageExperimentOptions {
  expectedPreviewSha256: string;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export async function previewNapierAgentMessageExperiment(
  services: LocalAgentRuntimeServices,
  options: PreviewNapierAgentMessageExperimentOptions,
  signal: AbortSignal,
): Promise<AgentMessageExperimentPreview> {
  return structuredClone(
    await services.agentMessageExperiments.preview(
      options.sourceThreadId,
      experimentRequest(options),
      signal,
    ),
  );
}

export async function runNapierAgentMessageExperiment(
  services: LocalAgentRuntimeServices,
  options: RunNapierAgentMessageExperimentOptions,
  signal: AbortSignal,
): Promise<AgentMessageExperimentResult> {
  if (!/^[a-f0-9]{64}$/u.test(options.expectedPreviewSha256)) {
    throw new Error(
      "Agent message experiment execution requires a valid expected preview hash",
    );
  }
  return structuredClone(
    await services.agentMessageExperiments.run({
      sourceThreadId: options.sourceThreadId,
      request: {
        ...experimentRequest(options),
        expectedPreviewSha256: options.expectedPreviewSha256,
      },
      signal,
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    }),
  );
}

function experimentRequest(
  options: PreviewNapierAgentMessageExperimentOptions,
) {
  return {
    sourceRunId: options.sourceRunId,
    sourceMessageSeq: options.sourceMessageSeq,
    ...(options.model ? { model: options.model } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.toolResultMode
      ? { toolResultMode: options.toolResultMode }
      : {}),
  };
}

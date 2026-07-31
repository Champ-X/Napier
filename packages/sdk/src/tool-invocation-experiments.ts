import type {
  RunEvent,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResult,
} from "@napier/contracts";
import type { LocalAgentRuntimeServices } from "@napier/runtime";

export interface PreviewNapierToolInvocationExperimentOptions {
  sourceThreadId: string;
  sourceRunId: string;
  sourceCallId: string;
  title?: string;
  signal?: AbortSignal;
}

export interface RunNapierToolInvocationExperimentOptions extends PreviewNapierToolInvocationExperimentOptions {
  expectedPreviewSha256: string;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export async function previewNapierToolInvocationExperiment(
  services: LocalAgentRuntimeServices,
  options: PreviewNapierToolInvocationExperimentOptions,
  signal: AbortSignal,
): Promise<ToolInvocationExperimentPreview> {
  return structuredClone(
    await services.toolInvocationExperiments.preview(
      options.sourceThreadId,
      experimentRequest(options),
      signal,
    ),
  );
}

export async function runNapierToolInvocationExperiment(
  services: LocalAgentRuntimeServices,
  options: RunNapierToolInvocationExperimentOptions,
  signal: AbortSignal,
): Promise<ToolInvocationExperimentResult> {
  if (!/^[a-f0-9]{64}$/u.test(options.expectedPreviewSha256)) {
    throw new Error(
      "Tool invocation experiment requires a valid expected preview hash",
    );
  }
  return structuredClone(
    await services.toolInvocationExperiments.run({
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
  options: PreviewNapierToolInvocationExperimentOptions,
) {
  return {
    sourceRunId: options.sourceRunId,
    sourceCallId: options.sourceCallId,
    ...(options.title ? { title: options.title } : {}),
  };
}

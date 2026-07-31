import type {
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResult,
  ModelRef,
  RunEvent,
} from "@napier/contracts";
import type { LocalAgentRuntimeServices } from "@napier/runtime";

export interface PreviewNapierModelInvocationExperimentOptions {
  sourceThreadId: string;
  sourceRunId: string;
  sourceTurnIndex: number;
  model?: ModelRef;
  title?: string;
  signal?: AbortSignal;
}

export interface RunNapierModelInvocationExperimentOptions extends PreviewNapierModelInvocationExperimentOptions {
  expectedPreviewSha256: string;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export async function previewNapierModelInvocationExperiment(
  services: LocalAgentRuntimeServices,
  options: PreviewNapierModelInvocationExperimentOptions,
  signal: AbortSignal,
): Promise<ModelInvocationExperimentPreview> {
  return structuredClone(
    await services.modelInvocationExperiments.preview(
      options.sourceThreadId,
      experimentRequest(options),
      signal,
    ),
  );
}

export async function runNapierModelInvocationExperiment(
  services: LocalAgentRuntimeServices,
  options: RunNapierModelInvocationExperimentOptions,
  signal: AbortSignal,
): Promise<ModelInvocationExperimentResult> {
  if (!/^[a-f0-9]{64}$/u.test(options.expectedPreviewSha256)) {
    throw new Error(
      "Model invocation experiment requires a valid expected preview hash",
    );
  }
  return structuredClone(
    await services.modelInvocationExperiments.run({
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
  options: PreviewNapierModelInvocationExperimentOptions,
) {
  return {
    sourceRunId: options.sourceRunId,
    sourceTurnIndex: options.sourceTurnIndex,
    ...(options.model ? { model: options.model } : {}),
    ...(options.title ? { title: options.title } : {}),
  };
}

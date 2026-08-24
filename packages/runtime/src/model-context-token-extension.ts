import type { LocalStore } from "./store.js";
import type {
  AgentModelCallExtension,
  ComposableAgentModelCallPipeline,
} from "./kernel-model-call-pipeline.js";
import {
  ModelContextWindowBudgetError,
  projectModelContextTokenPressureWithProvider,
} from "./model-context-token-pressure.js";
import { toJsonValue } from "./agent-runtime-utils.js";
import { hydrateTokenCalibrationRegistry } from "./model-context-token-calibration.js";
import type { TokenMeterRegistry } from "./token-meter-provider.js";

export const MODEL_CONTEXT_TOKEN_EXTENSION_ID =
  "napier.model-context-token-governor";
export const MODEL_CONTEXT_TOKEN_EXTENSION_OWNER = "kernel.context";

export function installModelContextTokenExtension(
  pipeline: ComposableAgentModelCallPipeline,
  store: LocalStore,
  tokenMeters: TokenMeterRegistry,
): () => void {
  const extension: AgentModelCallExtension = {
    id: MODEL_CONTEXT_TOKEN_EXTENSION_ID,
    order: 10_000,
    finalize: async (call) => {
      await hydrateTokenCalibrationRegistry(store, tokenMeters);
      const projection = await projectModelContextTokenPressureWithProvider(
        {
          model: call.model,
          context: call.context,
          options: call.options,
          compiledPrompt: call.compiledPrompt,
          modelAttempt: call.attempt,
          recoveryAttempt: call.recoveryAttempt,
        },
        tokenMeters,
      );
      const event = await store.appendEvent({
        threadId: call.run.threadId,
        runId: call.run.id,
        type: "model.context.token_pressure",
        category: "model",
        visibility: "debug",
        payload: toJsonValue(projection.receipt),
      });
      if (call.onEvent) {
        try {
          await call.onEvent(event);
        } catch {
          // Durable token-pressure evidence survives a disconnected stream.
        }
      }
      if (projection.receipt.status === "unavailable") {
        throw new ModelContextWindowBudgetError(projection.receipt);
      }
      return { context: projection.context };
    },
  };
  return pipeline.use(extension, MODEL_CONTEXT_TOKEN_EXTENSION_OWNER);
}

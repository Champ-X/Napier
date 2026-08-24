import type { LocalStore } from "./store.js";
import type {
  AgentModelCallExtension,
  ComposableAgentModelCallPipeline,
} from "./kernel-model-call-pipeline.js";
import { prepareModelHarnessCall } from "./model-harness-profile.js";
import { toJsonValue } from "./agent-runtime-utils.js";
import { modelHarnessExperimentProfileApplied } from "./model-harness-experiment-profile.js";

export const MODEL_HARNESS_EXTENSION_ID = "napier.model-aware-harness";
export const MODEL_HARNESS_EXTENSION_OWNER = "kernel.harness";

export function installModelHarnessExtension(
  pipeline: ComposableAgentModelCallPipeline,
  store: LocalStore,
): () => void {
  const extension: AgentModelCallExtension = {
    id: MODEL_HARNESS_EXTENSION_ID,
    order: -500,
    prepare: async (call) => {
      const prepared = prepareModelHarnessCall(call);
      if (call.harnessExperimentProfile) {
        const applied = await store.appendEvent({
          threadId: call.run.threadId,
          runId: call.run.id,
          type: "harness.experiment.profile.applied",
          category: "model",
          visibility: "debug",
          payload: toJsonValue(
            modelHarnessExperimentProfileApplied({
              profile: call.harnessExperimentProfile,
              receiptSha256: prepared.receipt.contentSha256,
            }),
          ),
        });
        if (call.onEvent) {
          try {
            await call.onEvent(applied);
          } catch {
            // Durable experiment-profile evidence remains authoritative.
          }
        }
      }
      const event = await store.appendEvent({
        threadId: call.run.threadId,
        runId: call.run.id,
        type: "model.harness.resolved",
        category: "model",
        visibility: "debug",
        payload: toJsonValue(prepared.receipt),
      });
      if (call.onEvent) {
        try {
          await call.onEvent(event);
        } catch {
          // A disconnected live stream cannot invalidate durable Harness evidence.
        }
      }
      return { context: prepared.context, options: prepared.options };
    },
  };
  return pipeline.use(extension, MODEL_HARNESS_EXTENSION_OWNER);
}

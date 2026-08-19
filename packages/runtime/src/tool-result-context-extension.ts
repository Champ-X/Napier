import type { LocalStore } from "./store.js";
import type {
  AgentModelCallExtension,
  ComposableAgentModelCallPipeline,
} from "./kernel-model-call-pipeline.js";
import { pruneToolResultContext } from "./tool-result-context-pruner.js";
import { toJsonValue } from "./agent-runtime-utils.js";

export const TOOL_RESULT_CONTEXT_EXTENSION_ID = "napier.tool-result-context-pruner";
export const TOOL_RESULT_CONTEXT_EXTENSION_OWNER = "kernel.context";

export function installToolResultContextExtension(
  pipeline: ComposableAgentModelCallPipeline,
  store: LocalStore,
): () => void {
  const extension: AgentModelCallExtension = {
    id: TOOL_RESULT_CONTEXT_EXTENSION_ID,
    order: -400,
    prepare: async (call) => {
      const pruning = pruneToolResultContext(call.context, call.attempt);
      const event = await store.appendEvent({
        threadId: call.run.threadId,
        runId: call.run.id,
        type: "model.context.tool-results.pruned",
        category: "model",
        visibility: "debug",
        payload: toJsonValue(pruning.receipt),
      });
      if (call.onEvent) {
        try {
          await call.onEvent(event);
        } catch {
          // A disconnected observer cannot invalidate durable context evidence.
        }
      }
      return { context: pruning.context };
    },
  };
  return pipeline.use(extension, TOOL_RESULT_CONTEXT_EXTENSION_OWNER);
}

import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { projectToolSurface } from "./tool-surface-projection.js";
import { preserveModelContextSnapshotSource } from "./model-context-message-provenance.js";

/** Detach request data before asynchronous capture. Transport callbacks and
 * AbortSignals are capabilities and retain their original identity. */
export function snapshotModelInvocation(input: {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions | undefined;
}) {
  const options = input.options;
  return {
    model: structuredClone(input.model),
    context: preserveModelContextSnapshotSource(input.context, structuredClone({
      ...input.context,
      ...(input.context.tools ? { tools: projectToolSurface(input.context.tools) } : {}),
    })),
    options: options ? {
      ...options,
      ...(options.headers ? { headers: { ...options.headers } } : {}),
      ...(options.env ? { env: { ...options.env } } : {}),
      ...(options.metadata ? { metadata: structuredClone(options.metadata) } : {}),
      ...(options.thinkingBudgets ? { thinkingBudgets: { ...options.thinkingBudgets } } : {}),
    } : undefined,
  };
}

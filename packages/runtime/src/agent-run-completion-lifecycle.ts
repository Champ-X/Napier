import type { RunRecord, Usage } from "@napier/contracts";

import type { AgentLifecyclePipelineHost } from "./lifecycle-extension-pipeline.js";

export function executeAgentRunCompletionLifecycle(input: {
  lifecycles: AgentLifecyclePipelineHost;
  run: Pick<RunRecord, "id" | "threadId">;
  signal: AbortSignal;
  collectUsage(): Promise<Usage>;
}): Promise<Usage> {
  return input.lifecycles.completion.execute(
    {
      kind: "completion",
      runId: input.run.id,
      threadId: input.run.threadId,
      status: "completed",
      signal: input.signal,
    },
    input.collectUsage,
  );
}

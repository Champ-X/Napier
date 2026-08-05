import type { RunEvent } from "@napier/contracts";

import type { ResearchSourceCapsuleReceipt } from "./research-source-capsule-model.js";
import type { LocalStore } from "./store.js";

export async function recordResearchSourceRecoveryContext(input: {
  threadId: string;
  runId: string;
  enabled: boolean;
  prepare(): Promise<ResearchSourceCapsuleReceipt | undefined>;
  record(event: Parameters<LocalStore["appendEvent"]>[0]): Promise<RunEvent>;
}): Promise<void> {
  if (!input.enabled) return;
  const receipt = await input.prepare();
  if (!receipt) return;
  await input.record({
    threadId: input.threadId,
    runId: input.runId,
    type: "context.research_sources",
    category: "tool",
    visibility: "debug",
    payload: JSON.parse(JSON.stringify(receipt)),
  });
}

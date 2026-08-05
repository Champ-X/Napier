import type { RunEvent } from "@napier/contracts";

import type { ResearchSourceCapsuleReceipt } from "./research-source-capsule-model.js";
import type { LocalStore } from "./store.js";
import type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";

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

export async function recordWebFetchRecoveryContext(input: {
  threadId: string;
  runId: string;
  enabled: boolean;
  prepare(): Promise<WebFetchStateCapsuleReceipt | undefined>;
  record(event: Parameters<LocalStore["appendEvent"]>[0]): Promise<RunEvent>;
}): Promise<void> {
  if (!input.enabled) return;
  const receipt = await input.prepare();
  if (!receipt) return;
  await input.record({
    threadId: input.threadId,
    runId: input.runId,
    type: "context.web_fetch_sources",
    category: "tool",
    visibility: "debug",
    payload: JSON.parse(JSON.stringify(receipt)),
  });
}

export async function recordNetworkSourceRecoveryContexts(input: {
  threadId: string;
  runId: string;
  enabled: boolean;
  prepare(): Promise<{
    research: ResearchSourceCapsuleReceipt | undefined;
    webFetch: WebFetchStateCapsuleReceipt | undefined;
  }>;
  record(event: Parameters<LocalStore["appendEvent"]>[0]): Promise<RunEvent>;
}): Promise<void> {
  if (!input.enabled) return;
  const prepared = await input.prepare();
  await recordResearchSourceRecoveryContext({
    threadId: input.threadId,
    runId: input.runId,
    enabled: input.enabled,
    prepare: () => Promise.resolve(prepared.research),
    record: input.record,
  });
  await recordWebFetchRecoveryContext({
    threadId: input.threadId,
    runId: input.runId,
    enabled: input.enabled,
    prepare: () => Promise.resolve(prepared.webFetch),
    record: input.record,
  });
}

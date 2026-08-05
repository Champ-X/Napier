import type { RunEvent } from "@napier/contracts";

import type { ResearchSourceCapsuleReceipt } from "./research-source-capsule-model.js";
import type { LocalStore } from "./store.js";
import type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";
import { formatSourceContinuityGuidance } from "./source-continuity-guidance.js";

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

export async function recordNetworkSourceContinuityContexts(input: {
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

export async function prepareNetworkSourceContinuity(input: {
  threadId: string;
  runId: string;
  invocationSource: string;
  automaticRecovery: boolean;
  sourceContinuityRequired: boolean;
  enabledTools: readonly string[];
  prepare(enabled: { researchSource: boolean; webFetch: boolean }): Promise<{
    research: ResearchSourceCapsuleReceipt | undefined;
    webFetch: WebFetchStateCapsuleReceipt | undefined;
  }>;
  record(event: Parameters<LocalStore["appendEvent"]>[0]): Promise<RunEvent>;
}): Promise<string> {
  const enabled =
    input.invocationSource === "user" ||
    (input.invocationSource === "recovery" && !input.automaticRecovery);
  if (!enabled) {
    if (input.sourceContinuityRequired) {
      throw new Error("Pinned Source continuity Run is not allowed");
    }
    return "";
  }
  const prepared = await input.prepare({
    researchSource: input.enabledTools.includes("research_source"),
    webFetch: input.enabledTools.includes("web_fetch"),
  });
  if (
    input.sourceContinuityRequired &&
    !prepared.research &&
    !prepared.webFetch
  ) {
    throw new Error(
      "Pinned Source continuity Run has no enabled private Source state",
    );
  }
  const recorded: RunEvent[] = [];
  await recordNetworkSourceContinuityContexts({
    threadId: input.threadId,
    runId: input.runId,
    enabled: true,
    prepare: () => Promise.resolve(prepared),
    record: async (event) => {
      const result = await input.record(event);
      recorded.push(result);
      return result;
    },
  });
  return formatSourceContinuityGuidance(recorded);
}

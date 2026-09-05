import type { RunRecord, ThreadRecord } from "@napier/contracts";
import { createId } from "@napier/runtime/core";
import type { LocalStore } from "@napier/runtime/store";

export interface ActiveBenchmarkRun {
  thread: ThreadRecord;
  run: RunRecord;
  leaseToken: string;
}

/**
 * Creates an isolated, leased Run for benchmark operations that write durable
 * evidence directly. Benchmarks must not borrow the completed onboarding Run.
 */
export async function createActiveBenchmarkRun(
  store: LocalStore,
  input: { title: string; leaseTtlMs: number },
): Promise<ActiveBenchmarkRun> {
  const agent = store.listAgents()[0];
  if (!agent) throw new Error("Benchmark Run requires a seeded Agent");
  const thread = await store.createThread({
    title: input.title,
    agentId: agent.id,
  });
  const leased = await store.createLeasedRun(
    { threadId: thread.id, agentId: agent.id },
    {
      ownerId: `benchmark:${createId("lease")}`,
      ttlMs: input.leaseTtlMs,
    },
  );
  await store.appendEvent({
    threadId: thread.id,
    runId: leased.run.id,
    type: "run.started",
    category: "lifecycle",
    visibility: "debug",
    payload: {
      source: "benchmark",
      configurationSha256: leased.run.configuration?.contentSha256 ?? "",
    },
  });
  return { thread, run: leased.run, leaseToken: leased.token };
}

export async function completeBenchmarkRun(
  store: LocalStore,
  active: ActiveBenchmarkRun,
): Promise<RunRecord> {
  return store.finishRun(active.run.id, "completed", {
    leaseToken: active.leaseToken,
    terminalEvent: {
      visibility: "debug",
      payload: { status: "completed", source: "benchmark" },
    },
  });
}

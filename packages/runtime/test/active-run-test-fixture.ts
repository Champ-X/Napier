import type { LocalStore } from "../src/store.js";
import { createProcessLeaseOwnerId } from "../src/ids.js";

/** Creates an isolated active Run instead of borrowing seeded history. */
export async function createActiveTestRun(store: LocalStore, title: string) {
  const agent = store.listAgents()[0];
  if (!agent) throw new Error("Active Run fixture requires a seeded Agent");
  const thread = await store.createThread({ title, agentId: agent.id });
  const { run, token: leaseToken } = await store.createLeasedRun(
    { threadId: thread.id, agentId: agent.id },
    {
      ownerId: createProcessLeaseOwnerId("fixture"),
      ttlMs: 10 * 60_000,
    },
  );
  return { agent, thread, run, leaseToken };
}

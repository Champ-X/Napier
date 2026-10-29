import { access, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LocalStore } from "../src/store.js";
import { LEGACY_CANDIDATE_MIGRATED_EVENT } from "../src/subagent-candidate-legacy-repository.js";
import type { RunEvent } from "@napier/contracts";

globalThis.fetch = async () => { throw new Error("External requests forbidden"); };
const config = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
  workspaceRoot: string; dataRoot: string; candidateId: string; output: string;
  mode: "before_commit" | "after_commit" | "race"; barrier?: string;
};
const store = new LocalStore(config); await store.initialize();
try {
  const internals = store as unknown as { persistState(events?: RunEvent | RunEvent[]): Promise<void> };
  const original = internals.persistState.bind(store);
  internals.persistState = async (events) => {
    const migration = (Array.isArray(events) ? events : events ? [events] : []).some((event) => event.type === LEGACY_CANDIDATE_MIGRATED_EVENT);
    if (migration && config.mode === "before_commit") process.kill(process.pid, "SIGKILL");
    await original(events);
    if (migration && config.mode === "after_commit") process.kill(process.pid, "SIGKILL");
  };
  if (config.barrier) {
    const start = Date.now();
    for (;;) {
      try { await access(config.barrier); break; }
      catch (error) { if (Date.now() - start > 20_000) throw error; await delay(10); }
    }
  }
  const receipt = await store.reconcileLegacySubagentCandidate(config.candidateId);
  await writeFile(config.output, JSON.stringify(receipt), { flag: "wx" });
} finally { store.close(); }

import path from "node:path";
import { LocalStore } from "../../src/store.js";
import type { RunEvent } from "@napier/contracts";
import { assessAutomaticRecovery } from "../../src/automatic-recovery.js";

const root = process.argv[2];
if (!root) throw new Error("Recovery root is required");
const store = new LocalStore({ workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "data") });
if (process.argv[3] === "hold-before-commit") {
  const host = store as unknown as { persistState(events: RunEvent[]): Promise<void> };
  const persist = host.persistState.bind(store);
  host.persistState = async (events) => {
    if (events?.some((event) => event.type === "workspace.file.move.reconciled")) {
      process.stdout.write("recovery-held\n");
      await new Promise<void>((resolve) => { process.stdin.once("data", () => resolve()); process.stdin.resume(); });
    }
    await persist(events);
  };
}
try {
  await store.initialize(true);
  const run = store.listRuns(store.listThreads()[0]!.id)[0]!;
  process.stdout.write(JSON.stringify({ status: run.status, eligible: assessAutomaticRecovery({ run, events: await store.listRunEvents(run.id) }).eligible }) + "\n");
}
finally { store.close(); }

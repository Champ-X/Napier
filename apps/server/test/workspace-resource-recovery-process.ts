import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceResourceAdmission } from "../src/workspace-resource-admission.js";
import type { ResourceKind } from "../src/workspace-resource-policy.js";

const directory = process.argv[2]!;
const mode = process.argv[3]!;
const kind = (process.argv[4] ?? "sandbox_execution") as ResourceKind;
const ledger = await WorkspaceResourceAdmission.open(directory, { sandbox_execution: 1 });
if (mode === "recover") {
  process.send?.({ snapshot: ledger.snapshot()[0] });
  process.on("message", () => { ledger.close(); process.exit(0); });
} else {
  const lease = ledger.forWorkspace(`workspace_${"c".repeat(64)}`).reserve({ kind, backend: "fixture" });
  if (mode !== "reserved") {
    lease.dispatched();
    const target = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    await once(target, "exit");
    lease.bind({ resourceId: `closed-fixture-${target.pid}` });
  }
  if (mode === "settlement_failed") {
    const db = new DatabaseSync(path.join(directory, "execution-resources.sqlite"));
    db.exec("CREATE TRIGGER reject_recovery_release BEFORE UPDATE ON execution_resources WHEN NEW.state='released' BEGIN SELECT RAISE(ABORT,'injected release failure'); END");
    try {
      lease.settle({ status: "released", scope: kind, reason: "fixture_complete_cleanup" });
      throw new Error("Expected the release transaction to fail");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("injected release failure")) throw error;
    }
    db.close();
  } else if (mode === "unknown") {
    lease.settle({ status: "unknown", scope: kind, reason: "fixture_component_ack_only" });
  }
  process.send?.({ id: lease.id, pid: process.pid, executionClosed: mode !== "reserved" });
  process.on("message", () => undefined);
}

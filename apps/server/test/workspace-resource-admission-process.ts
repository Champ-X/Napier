import { WorkspaceResourceAdmission } from "../src/workspace-resource-admission.js";

const directory = process.argv[2]!;
const stage = process.argv[3]!;
const ledger = await WorkspaceResourceAdmission.open(directory, { sandbox_execution: 1 });
let lease: ReturnType<ReturnType<typeof ledger.forWorkspace>["reserve"]>;
try {
  lease = ledger.forWorkspace(`workspace_${"a".repeat(64)}`).reserve({ kind: "sandbox_execution", backend: "fixture" });
} catch (error) {
  process.send?.({ admitted: false, code: (error as { code?: string }).code });
  ledger.close();
  process.exit(0);
}
if (stage !== "reserved") lease.dispatched();
if (stage === "bound") lease.bind({ resourceId: `fixture-${process.pid}` });
process.send?.({ admitted: true, id: lease.id });
process.on("message", (message) => {
  if (message !== "release") return;
  lease.settle({ status: stage === "reserved" ? "not_started" : "released", scope: "sandbox_execution", reason: "fixture_cleanup" });
  ledger.close();
  process.exit(0);
});

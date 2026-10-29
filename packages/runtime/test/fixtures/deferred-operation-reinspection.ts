import { appendFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../../src/agent-runtime.js";
import { ModelRegistry } from "../../src/models.js";
import { RecoveryService } from "../../src/recovery-service.js";
import { LocalStore } from "../../src/store.js";

const root = process.argv[2];
if (!root) throw new Error("Deferred recovery fixture root is required");
const store = new LocalStore({ workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "data") });
await store.initialize(true);
const thread = store.listThreads().find((value) => value.title === "Recover one native move");
if (!thread) throw new Error("Native move fixture thread is missing");
const sourceRun = store.listRuns(thread.id).find((value) => value.source !== "recovery");
if (!sourceRun) throw new Error("Native move fixture Run is missing");
const provider = fauxProvider({ provider: "faux-move-recovery" });
provider.setResponses([async (context) => {
  if (JSON.stringify(context.tools?.map((tool) => tool.name)) !== JSON.stringify(["read_file"]) ||
      !JSON.stringify(context.messages).includes("Do not repeat the move"))
    throw new Error("Recovery must retain the move and expose only the read-only continuation");
  await appendFile(path.join(root, "continuations.log"), `${process.pid}\n`);
  return fauxAssistantMessage("The original move is retained; the remaining read-only work is complete.");
}]);
const models = new ModelRegistry();
models.registerProvider(provider.provider);
const service = new RecoveryService(store, new AgentRuntime(store, models), {
  sweepMs: 250, workerId: `deferred_sweeper_${process.pid}`,
});

async function snapshot() {
  const run = store.listRuns(thread!.id).find((value) => value.id === sourceRun!.id)!;
  const events = await store.listRunEvents(run.id);
  return { runId: run.id, status: run.status, outcome: run.outcome,
    proofCount: events.filter((event) => event.type === "workspace.file.move.reconciled").length,
    fenceCount: events.filter((event) => event.type === "tool.operation.effect_indeterminate").length,
    terminalCount: events.filter((event) => ["run.interrupted", "run.failed"].includes(event.type)).length,
    descendants: store.listRuns(thread!.id).filter((value) => value.parentRunId === run.id)
      .map((value) => ({ id: value.id, status: value.status })),
    attempts: store.listAutomaticRecoveryAttempts().map((value) => ({ id: value.id, status: value.status })),
    modelCalls: provider.state.callCount };
}
function emit(value: unknown) { process.stdout.write(`${JSON.stringify(value)}\n`); }
emit({ type: "ready", snapshot: await snapshot() });
const input = createInterface({ input: process.stdin });
try {
  for await (const line of input) {
    const command = JSON.parse(line) as { id: number; action: "start" | "sweep" | "snapshot" | "stop" };
    try {
      if (command.action === "start") service.start();
      if (command.action === "sweep") await service.sweep();
      if (command.action === "stop") await service.stop();
      emit({ type: "reply", id: command.id, snapshot: await snapshot() });
      if (command.action === "stop") break;
    } catch (error) { emit({ type: "error", id: command.id, error: error instanceof Error ? error.stack : String(error) }); }
  }
} finally {
  input.close();
  await service.stop();
  store.close();
}

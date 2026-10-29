import { access, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/store.js";
import type { SubagentChildRunFence } from "../src/subagent-child-run-types.js";
import type { FinishSubagentTaskInput } from "../src/subagent-store-records.js";
import { deliveryManager, patchCandidate } from "./subagent-worktree-delivery-fixture.js";
const config = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
  workspaceRoot: string; dataRoot: string; fence: SubagentChildRunFence; finish: FinishSubagentTaskInput;
  mode: "after_stage" | "after_completion" | "race"; output: string; barrier?: string;
};
const store = new LocalStore(config); await store.initialize();
try {
  const ready = await store.prepareSubagentChildCompletion({ ...config.fence, finish: config.finish });
  const manager = deliveryManager(config, { requireCompletionBinding: true,
    candidateDeliveryAuthority: (reservation, candidate) => store.subagentChildRunRepository.candidateDelivered(reservation, candidate) });
  const session = await manager.createWorktree(config.fence.taskId, ["a.ts"]);
  await patchCandidate(manager, session, "a.ts", "export const a = 1;\n", "export const a = 2;\n");
  const preview = await manager.storePreview(session, sha256(canonicalJson(config.finish.output)), undefined, ready.prepared);
  await writeFile(config.output, JSON.stringify({ preview, executionRevision: ready.executionRevision }), { mode: 0o600 });
  if (config.mode === "after_stage") process.kill(process.pid, "SIGKILL");
  if (config.barrier) {
    const started = Date.now();
    for (;;) {
      try { await access(config.barrier); break; }
      catch (error) { if (Date.now() - started > 20_000) throw error; await delay(10); }
    }
  }
  const result = await store.finishSubagentChildRun({ ...config.fence, expectedExecutionRevision: ready.executionRevision,
    finish: { ...config.finish, preparedCompletion: ready.prepared, candidateId: preview.id } });
  if (config.mode === "after_completion") process.kill(process.pid, "SIGKILL");
  await writeFile(config.output, JSON.stringify({ preview, result }), { mode: 0o600 });
} finally { store.close(); }

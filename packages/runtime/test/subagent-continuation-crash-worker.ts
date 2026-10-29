import { writeFile } from "node:fs/promises";
import { LocalStore } from "../src/store.js";
import { effectiveRunProfile } from "../src/effective-run-profile.js";
import { authorizeSubagentChildContinuation } from "../src/subagent-continuation-authorization.js";

const [dataRoot, workspaceRoot, sourceTaskId, targetParentRunId, mode, output] = process.argv.slice(2);
if (!dataRoot || !workspaceRoot || !sourceTaskId || !targetParentRunId || !output) throw new Error("Missing fixture arguments");
const store = new LocalStore({ dataRoot, workspaceRoot }); await store.initialize();
const sourceTask = store.listSubagentTasks(store.listThreads()[0]!.id).find((task) => task.id === sourceTaskId)!;
const runs = store.listRuns(sourceTask.threadId);
const sourceRun = runs.find((run) => run.id === sourceTask.childRunId)!;
const sourceParent = runs.find((run) => run.id === sourceTask.runId)!;
const targetParent = runs.find((run) => run.id === targetParentRunId)!;
const prepared = await store.prepareSubagentChildContinuation({ sourceTaskId, targetParentRunId });
if (prepared.kind !== "ready") throw new Error(prepared.reason);
const configuredProfile = store.getAgent(targetParent.agentId);
const recoveryStarted = (await store.listRunEvents(targetParent.id)).find((event) => event.type === "run.recovery.started")!;
const authorization = authorizeSubagentChildContinuation({ assessment: prepared.assessment, sourceRun, sourceTask, sourceParent,
  targetParent, configuredProfile, parentProfile: effectiveRunProfile(configuredProfile, targetParent), recoveryStarted });
if (mode === "before_claim") {
  await writeFile(output, JSON.stringify({ mode }));
  process.exit(73);
}
const claimed = await store.startSubagentChildContinuation({ prepared: prepared.prepared, authorization,
  lease: { ownerId: `process:${process.pid}:continuation_crash`, ttlMs: 60_000 } });
if (claimed.kind !== "started") throw new Error("Expected sole claimed executor");
await writeFile(output, JSON.stringify({ mode, taskId: claimed.execution.task.id, runId: claimed.execution.run.id,
  budget: claimed.budget, sourceCapsuleSha256: claimed.execution.run.subagent?.continuation?.sourceCapsuleSha256 }));
process.exit(73);

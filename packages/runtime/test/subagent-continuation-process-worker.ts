import { access, open, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { effectiveRunProfile } from "../src/effective-run-profile.js";
import { LocalStore } from "../src/store.js";
import { authorizeSubagentChildContinuation } from "../src/subagent-continuation-authorization.js";
import { resolveSubagentChildRestore } from "../src/subagent-continuation-source.js";
import { SubagentChildExecution } from "../src/subagent-child-execution.js";
import { SubagentWorkingSet } from "../src/subagent-working-set.js";

const config = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
  dataRoot: string; workspaceRoot: string; threadId: string; sourceTaskId: string; targetParentRunId: string;
  output: string; ready?: string; barrier?: string;
  mode: "before_claim" | "before_checkpoint" | "after_checkpoint" | "after_reservation" | "after_response" | "race";
};
const store = new LocalStore(config); await store.initialize();
try {
  const sourceTask = store.listSubagentTasks(config.threadId).find((task) => task.id === config.sourceTaskId)!;
  const runs = store.listRuns(config.threadId);
  const sourceRun = runs.find((run) => run.id === sourceTask.childRunId)!;
  const sourceParent = runs.find((run) => run.id === sourceTask.runId)!;
  const targetParent = runs.find((run) => run.id === config.targetParentRunId)!;
  const prepared = await store.prepareSubagentChildContinuation({ sourceTaskId: sourceTask.id, targetParentRunId: targetParent.id });
  if (prepared.kind !== "ready") throw new Error(`Continuation unavailable: ${prepared.reason}`);
  const configuredProfile = store.getAgent(targetParent.agentId);
  const recoveryStarted = (await store.listRunEvents(targetParent.id)).find((event) => event.type === "run.recovery.started")!;
  const authorization = authorizeSubagentChildContinuation({ assessment: prepared.assessment, sourceRun, sourceTask,
    sourceParent, targetParent, configuredProfile, parentProfile: effectiveRunProfile(configuredProfile, targetParent), recoveryStarted });
  if (config.ready) await durableJson(config.ready, { assessmentSha256: prepared.assessment.contentSha256 });
  if (config.mode === "before_claim") {
    await durableJson(config.output, { kind: "unclaimed" }); process.kill(process.pid, "SIGKILL");
  }
  if (config.barrier) {
    const started = Date.now();
    for (;;) {
      try { await access(config.barrier); break; }
      catch (error) { if (Date.now() - started > 20_000) throw error; await delay(10); }
    }
  }
  const claimed = await store.startSubagentChildContinuation({ prepared: prepared.prepared, authorization,
    lease: { ownerId: `process:${process.pid}:continuation_process`, ttlMs: 60_000 } });
  if (claimed.kind === "existing") {
    await durableJson(config.output, { kind: claimed.kind, taskId: claimed.task.id, runId: claimed.run.id,
      tokenIssued: "execution" in claimed || "token" in claimed });
  } else {
    const child = new SubagentChildExecution(store, claimed.execution);
    const source = resolveSubagentChildRestore(claimed.restore);
    if (!["before_checkpoint", "race"].includes(config.mode)) {
      const workingSet = new SubagentWorkingSet({ store, child, systemPrompt: source.systemPrompt,
        tools: source.tools, requireDurableCheckpoint: true, onEvent: undefined });
      await workingSet.persist(source.messages, "before_model");
      if (config.mode === "after_reservation" || config.mode === "after_response") {
        const request = await child.reserve("subagent_turn");
        if (config.mode === "after_response") {
          const response = fauxAssistantMessage('{"answer":"response outside saved source"}');
          Object.assign(response, { api: "openai-responses", provider: child.task.model.provider, model: child.task.model.id });
          await child.settle(request.invocationId, { stopReason: response.stopReason,
            responseSha256: sha256(canonicalJson(response)), toolCalls: [] },
            { inputTokens: 8, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });
        }
      }
    }
    await durableJson(config.output, { kind: claimed.kind, taskId: child.task.id, runId: child.run.id,
      tokenIssued: typeof claimed.execution.token === "string", tokenSha256: sha256(claimed.execution.token),
      budget: claimed.budget, continuation: child.run.subagent!.continuation,
      checkpoint: child.run.subagent!.checkpoint, usageStatus: child.run.usageStatus });
    if (config.mode !== "race") process.kill(process.pid, "SIGKILL");
  }
} finally { store.close(); }

async function durableJson(target: string, value: unknown) {
  const file = await open(target, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
  finally { await file.close(); }
}

// Copied into an isolated archive of 8f2a26cb and executed against that version.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import { authorizeSubagentChildRun } from "../src/subagent-child-authorization.js";
import { SubagentChildExecution } from "../src/subagent-child-execution.js";
import { SubagentExecutionLifetime } from "../src/subagent-execution-lifetime.js";
import { settleSubagentOutcome } from "../src/subagent-outcome-settlement.js";
import { finishSubagentTypedOutput } from "../src/subagent-typed-output-settlement.js";
import { subagentOutputSchemaSha256 } from "../src/subagent-output-schema.js";
import { createThreadReplayBundle } from "../src/thread-bundles.js";
import { deliveryManager, patchCandidate } from "./subagent-worktree-delivery-fixture.js";
import { sha256 } from "../src/ed25519.js";

globalThis.fetch = async () => { throw new Error("External requests forbidden"); };
const root = process.argv[2]!, workspaceRoot = path.join(root, "workspace"), dataRoot = path.join(root, "data");
const mode = process.argv[3] ?? "outcome";
await mkdir(workspaceRoot);
await writeFile(path.join(workspaceRoot, "a.ts"), "export const a = 1;\n");
if (mode === "dependency") await writeFile(path.join(workspaceRoot, "dependency.ts"), "export const dependency = 1;\n");
const store = new LocalStore({ workspaceRoot, dataRoot }); await store.initialize();
try {
  const faux = fauxProvider({ provider: "native-legacy-local-fixture" });
  const registry = new ModelRegistry(); registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "faux-1" })!;
  const limits = { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 60_000 };
  const configuration = { model: { provider: model.provider, id: model.id },
    enabledTools: ["read_file", "apply_patch", "lsp_diagnostics"], enabledSubagents: ["coder"], subagentLimits: limits,
    toolPolicy: "workspace" } satisfies Parameters<typeof store.updateAgent>[1];
  let profile = await store.updateAgent(store.listAgents()[0]!.id, configuration);
  let thread = await store.createThread({ agentId: profile.id, title: "Original legacy candidate" });
  const lease = { ownerId: `process:${process.pid}:legacy_fixture`, ttlMs: 60_000 };
  if (mode === "post_import") {
    const seed = await store.createLeasedRun({ threadId: thread.id, agentId: profile.id, source: "user" }, lease);
    await store.finishRun(seed.run.id, "completed", { leaseToken: seed.token });
    const imported = await store.importThreadReplayBundle(createThreadReplayBundle(await store.getDetail(thread.id)));
    thread = imported.thread;
    profile = await store.updateAgent(thread.agentId, configuration);
  }
  const parent = await store.createLeasedRun({ threadId: thread.id, agentId: profile.id, source: "user" }, lease);
  const typed = mode.startsWith("typed"), outputSchema = { type: "string" as const };
  const task = await store.createSubagentTask({ threadId: thread.id, runId: parent.run.id, role: "coder", description: "Update a.ts",
    prompt: "Change a.ts from 1 to 2 and cite the candidate.", model: profile.model, writePaths: ["a.ts"],
    providerId: "in_process", executionId: "subexec_native_legacy_fixture",
    ...(typed ? { outputSchema, outputSchemaSha256: subagentOutputSchemaSha256(outputSchema) } : {}) });
  const started = await store.startSubagentChildRun({ taskId: task.id, executionId: task.executionId!, lease,
    authorization: authorizeSubagentChildRun({ parentRun: parent.run, parentProfile: profile, taskId: task.id,
      executionId: task.executionId!, limits }) });
  const child = new SubagentChildExecution(store, started), manager = deliveryManager({ workspaceRoot, dataRoot });
  const worktree = await manager.createWorktree(task.id, ["a.ts"]);
  if (mode === "dependency") await manager.createCoderTools(worktree).find((tool) => tool.name === "read_file")!
    .execute("read-dependency", { path: "dependency.ts" });
  await patchCandidate(manager, worktree, "a.ts", "export const a = 1;\n", "export const a = 2;\n");
  const lifetime = new SubagentExecutionLifetime([], 60_000);
  const resultText = JSON.stringify({ summary: "Updated the authorized value.", items: [{ kind: "finding", severity: "info",
    title: "Candidate updated", detail: "The candidate contains the requested value.",
    evidence: [{ path: "a.ts", lineStart: 1, lineEnd: 1 }] }], unknowns: [] });
  const common = { store, task: child.task, resultText, usage: child.task.usage,
    assertActive: () => child.assertActive(), finishTask: child.finish, publishCommitted: () => child.publish(), worktrees: manager, worktree,
    emit: async (type: Parameters<Parameters<typeof settleSubagentOutcome>[0]["emit"]>[0], current: typeof child.task, payload: unknown) => {
      if (type !== "subagent.completed" && type !== "subagent.output.accepted" && type !== "subagent.outcome.accepted")
        throw new Error(`Unexpected fixture event: ${type}`);
      await store.appendEvent({ threadId: current.threadId, runId: current.runId, type, category: "subagent", payload: JSON.parse(JSON.stringify(payload)) }); } };
  const result = typed ? await finishSubagentTypedOutput({ ...common, output: mode === "typed_invalid" ? 42 : "updated" }) :
    await settleSubagentOutcome({ ...common, models: registry.models, model, runId: parent.run.id, limits,
      modelSession: { lifetime, open: async () => { throw new Error("No model calls"); } },
      activateAgent: () => { throw new Error("No repair"); }, markOutcomeRejected: () => { throw new Error("No rejection"); } });
  await store.finishRun(parent.run.id, "completed", { leaseToken: parent.token, usage: await store.aggregateRunUsage(parent.run.id) });
  await manager.cleanup(worktree); child.dispose(); lifetime.dispose();
  const detail = await store.getDetail(thread.id), completed = detail.subagents.find((entry) => entry.id === task.id)!;
  const preview = result.preview!, capsulePath = path.join(dataRoot, "subagent-candidates", `${preview.id.slice(15)}.json`);
  const bytes = await readFile(capsulePath, "utf8"), capsule = JSON.parse(bytes);
  if (capsule.schemaVersion !== 1 || capsule.source.completion || completed.completion || faux.state.callCount)
    throw new Error("Fixture did not use the original legacy path");
  await writeFile(path.join(root, "fixture.json"), JSON.stringify({ root, workspaceRoot, dataRoot, threadId: thread.id,
    parentRunId: parent.run.id, childRunId: child.run.id, taskId: task.id, candidateId: preview.id,
    expiresAt: preview.expiresAt, capsulePath, capsuleSha256: sha256(bytes), task: completed,
    events: detail.events, modelCalls: faux.state.callCount }), { flag: "wx" });
} finally { store.close(); }

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxProvider, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import { emptyUsage, type AutomaticRecoveryPolicy, type RunLimits, type SubagentLimits, type WorkflowValueSchema } from "@napier/contracts";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";
import { authorizeSubagentChildRun } from "../src/subagent-child-authorization.js";
import { authorizeSubagentChildContinuation } from "../src/subagent-continuation-authorization.js";
import { SubagentChildExecution } from "../src/subagent-child-execution.js";
import { SubagentExecutionControl } from "../src/subagent-execution-control.js";
import { SubagentTaskRunner } from "../src/subagent-task-runner.js";
import { subagentOutputSchemaSha256 } from "../src/subagent-output-schema.js";
import { SubagentWorkingSet } from "../src/subagent-working-set.js";
import { governSubagentTools } from "../src/subagent-tool-execution.js";
import { subagentToolResultEvidence } from "../src/subagent-tool-result-evidence.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { createWorkspaceTools } from "../src/tools.js";

const roots: string[] = [], stores: LocalStore[] = [];
export const continuationOutputSchema: WorkflowValueSchema = { type: "object", properties: { answer: { type: "string" } },
  required: ["answer"], additionalProperties: false };
export async function cleanupContinuationRunnerFixtures(): Promise<void> {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

/** Native child checkpoint and expired leases; no synthetic restoration capabilities. */
export async function continuationRunnerFixture(options: {
  maxTurns?: number; runLimits?: Partial<RunLimits>; readFile?: boolean; outputSchema?: WorkflowValueSchema;
  enabledTools?: string[];
  automaticRecovery?: AutomaticRecoveryPolicy;
  assertParentBudgetAvailable?: () => void;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-continuation-runner-")); roots.push(root);
  const paths = { workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "data") };
  await mkdir(paths.workspaceRoot);
  const sourceStore = new LocalStore(paths); stores.push(sourceStore); await sourceStore.initialize();
  const faux = fauxProvider({ provider: `continuation-${path.basename(root).toLowerCase()}`, api: "openai-responses", tokensPerSecond: 1_000_000 });
  const registry = new ModelRegistry(); registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "faux-1" })!;
  const limits: SubagentLimits = { maxConcurrent: 2, maxTotal: 4, maxTurns: options.maxTurns ?? 4, timeoutMs: 60_000 };
  const base = sourceStore.listAgents()[0]!;
  const profile = await sourceStore.updateAgent(base.id, { model: { provider: model.provider, id: model.id },
    enabledSubagents: ["researcher"], subagentLimits: limits, enabledTools: options.enabledTools ?? (options.readFile ? ["read_file"] : []),
    toolPolicy: "workspace", runLimits: { ...base.runLimits!, timeoutMs: 60_000, ...options.runLimits },
    ...(options.automaticRecovery ? { automaticRecovery: options.automaticRecovery } : {}) });
  const thread = await sourceStore.createThread({ agentId: profile.id, title: "Native child continuation" });
  const lease = { ownerId: `process:${process.pid}:continuation_runner`, ttlMs: 60_000 };
  const parent = await sourceStore.createLeasedRun({ threadId: thread.id, agentId: profile.id }, lease);
  const outputSchema = options.outputSchema ?? continuationOutputSchema;
  const task = await sourceStore.createSubagentTask({ threadId: thread.id, runId: parent.run.id, role: "researcher",
    description: "Continue the exact private source", prompt: "Return the verified answer.", model: profile.model,
    outputSchema, outputSchemaSha256: subagentOutputSchemaSha256(outputSchema), providerId: "in_process", executionId: "subexec_continuation_runner" });
  const started = await sourceStore.startSubagentChildRun({ taskId: task.id, executionId: task.executionId!, lease,
    authorization: authorizeSubagentChildRun({ parentRun: parent.run, parentProfile: profile,
      taskId: task.id, executionId: task.executionId!, limits }) });
  const child = new SubagentChildExecution(sourceStore, started);
  const sourceControl = new SubagentExecutionControl(async () => undefined);
  const tools = createWorkspaceTools(paths.workspaceRoot).filter((tool) => started.profile.enabledTools.includes(tool.name));
  const messages: Message[] = [{ role: "user", content: task.prompt, timestamp: 1 }];
  const workingSet = new SubagentWorkingSet({ store: sourceStore, child, systemPrompt: started.profile.systemPrompt,
    tools, control: sourceControl, onEvent: undefined });
  const gate = new ToolConcurrencyGate();

  async function assistant(message: AssistantMessage) {
    Object.assign(message, { api: model.api, provider: model.provider, model: model.id });
    const invocation = await child.reserve("subagent_turn");
    const usage = { inputTokens: message.usage.input, outputTokens: message.usage.output,
      cacheReadTokens: message.usage.cacheRead, cacheWriteTokens: message.usage.cacheWrite, costUsd: message.usage.cost.total };
    await child.settle(invocation.invocationId, { responseSha256: sha256(canonicalJson(message)), stopReason: message.stopReason,
      toolCalls: message.content.flatMap((block) => block.type === "toolCall" ? [{ id: block.id, name: block.name }] : []) }, usage);
    await child.progress({ turnDelta: 1, stepDelta: 1 });
    messages.push(message);
    for (const call of message.content) {
      if (call.type !== "toolCall") continue;
      const governed = governSubagentTools({ tools, store: sourceStore, run: child.run, taskId: task.id,
        executionId: task.executionId!, concurrencyGate: gate, onEvent: undefined });
      const tool = governed.find((candidate) => candidate.name === call.name)!;
      const result = await tool.execute(call.id, call.arguments);
      const response = { role: "toolResult" as const, toolCallId: call.id, toolName: call.name,
        content: result.content, details: result.details, isError: false, timestamp: Date.now() };
      messages.push(response);
      await child.progress({ stepDelta: 1 });
      await sourceStore.appendEvent({ threadId: thread.id, runId: parent.run.id, type: "subagent.step", category: "subagent",
        payload: { taskId: task.id, childRunId: child.run.id, executionId: task.executionId!, kind: "tool",
          providerCallId: call.id, toolName: call.name, isError: false, ...subagentToolResultEvidence(result) } });
    }
  }

  async function accept(text: string, consume = false): Promise<SubagentMessage> {
    const content = { kind: "napier.subagent-message" as const, schemaVersion: 1 as const, id: `submsg_${sha256(text).slice(0,16)}`,
      taskId: task.id, messageKind: "steering" as const, text, createdAt: new Date().toISOString() };
    const message = { ...content, contentSha256: sha256(canonicalJson(content)) };
    await sourceStore.acceptSubagentMessage({ taskId: task.id, executionId: task.executionId!, message });
    if (consume) {
      await sourceControl.activate({ abort() {}, steer(message) { messages.push(message as Message); } });
      await sourceControl.send(message);
    }
    return message;
  }

  async function interrupt() {
    await workingSet.persist(messages, "before_model");
    child.dispose();
    const db = new DatabaseSync(path.join(paths.dataRoot, LEDGER_DATABASE_FILENAME));
    try { db.prepare("UPDATE run_leases SET acquired_at = ?, heartbeat_at = ?, expires_at = ? WHERE run_id = ?")
      .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", "2000-01-01T00:01:00.000Z", parent.run.id); }
    finally { db.close(); }
    sourceStore.close(); stores.splice(stores.indexOf(sourceStore), 1);
    const store = new LocalStore(paths); stores.push(store); await store.initialize();
    const sourceTask = store.listSubagentTasks(thread.id).find((candidate) => candidate.id === task.id)!;
    const sourceRun = store.listRuns(thread.id).find((candidate) => candidate.id === child.run.id)!;
    const sourceParent = store.listRuns(thread.id).find((candidate) => candidate.id === parent.run.id)!;
    return { store, sourceTask, sourceRun, sourceParent };
  }
  async function interruptAndPrepare() {
    const { store, sourceTask, sourceRun, sourceParent } = await interrupt();
    const target = await store.createLeasedRun({ threadId: thread.id, agentId: profile.id, source: "recovery", parentRunId: parent.run.id }, lease);
    const recoveryStarted = await store.appendEvent({ threadId: thread.id, runId: target.run.id, type: "run.recovery.started",
      category: "lifecycle", payload: { parentRunId: parent.run.id, mode: "manual", purpose: "continuation" } });
    const prepared = await store.prepareSubagentChildContinuation({ sourceTaskId: task.id, targetParentRunId: target.run.id });
    if (prepared.kind !== "ready") throw new Error(`Fixture continuation unavailable: ${prepared.reason}`);
    const authorization = authorizeSubagentChildContinuation({ assessment: prepared.assessment, sourceRun, sourceTask,
      sourceParent, targetParent: target.run, parentProfile: profile, configuredProfile: profile, recoveryStarted });
    return { store, target, prepared, authorization, lease, sourceTask, sourceRun, sourceParent, recoveryStarted };
  }
  async function interruptAndClaim() {
    const { store, target, prepared, authorization, sourceTask, sourceRun, sourceParent } = await interruptAndPrepare();
    const continuation = await store.startSubagentChildContinuation({ prepared: prepared.prepared, authorization, lease });
    if (continuation.kind !== "started") throw new Error("Fixture unexpectedly reused an existing continuation");
    const delivered: SubagentMessage[] = [];
    const control = new SubagentExecutionControl(async (message) => { delivered.push(message); });
    const runner = new SubagentTaskRunner({ store, models: registry.models, model, run: target.run,
      limits: continuation.execution.profile.subagentLimits!, parentProfile: profile, parentSignal: new AbortController().signal,
      concurrencyGate: new ToolConcurrencyGate(), control,
      ...(options.assertParentBudgetAvailable ? { assertParentBudgetAvailable: options.assertParentBudgetAvailable } : {}) });
    return { store, target, continuation, runner, control, delivered, sourceTask, sourceRun, sourceParent };
  }
  return { ...paths, sourceStore, registry, faux, model, profile, thread, task, parent, child, messages,
    assistant, accept, interrupt, interruptAndPrepare, interruptAndClaim, emptyUsage };
}

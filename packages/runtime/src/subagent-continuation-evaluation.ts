import { canonicalJson, sha256 } from "./ed25519.js";
import { durableTerminalRunStatus } from "./run-event-admission.js";
import { assertChildCheckpointTranscript } from "./subagent-checkpoint-transcript.js";
import { subagentCheckpointFrontier } from "./subagent-checkpoint-frontier.js";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
import { subagentContinuationBudget } from "./subagent-continuation-lineage.js";
import { continuationMailbox, inheritConsumedMailbox } from "./subagent-continuation-mailbox.js";
import type { PrepareSubagentChildContinuationInput, SubagentChildContinuationAssessment,
  SubagentContinuationUnavailableReason } from "./subagent-continuation-types.js";
import type { PreparedSubagentContinuationState } from "./subagent-continuation-source.js";
import { assertSubagentRestoreWorkspace } from "./subagent-continuation-workspace.js";
import { readSubagentWorkingSetForRestore } from "./subagent-working-set-capsule.js";
import { validateConsumedSubagentMailbox } from "./subagent-mailbox-state.js";
import { totalRawTokens } from "./token-accounting.js";
import { inheritedModelAccountingBudget } from "./model-accounting-inherited-budget.js";
import { readInheritedSubagentCheckpoint } from "./subagent-continuation-checkpoint.js";
import type { SubagentWorkingSetBinding } from "./subagent-working-set-types.js";

export class SubagentContinuationUnavailableError extends Error {
  constructor(readonly reason: SubagentContinuationUnavailableReason) { super(`Child continuation unavailable: ${reason}`); }
}

export function continuationRecords(host: SubagentChildRunHost, input: PrepareSubagentChildContinuationInput) {
  const sourceTask = host.state.subagents.find((task) => task.id === input.sourceTaskId);
  const sourceRun = host.state.runs.find((run) => run.id === sourceTask?.childRunId);
  const sourceParent = host.state.runs.find((run) => run.id === sourceTask?.runId);
  const targetParent = host.state.runs.find((run) => run.id === input.targetParentRunId);
  if (!sourceTask || !sourceRun || !sourceParent || !targetParent) unavailable("source_missing");
  assertSourceRecords(sourceTask, sourceRun, sourceParent);
  assertRecoveryParent(targetParent, sourceParent, sourceTask, host.requireLedger().listRunEvents(targetParent.id));
  return { sourceTask, sourceRun, sourceParent, targetParent };
}

function assertSourceRecords(sourceTask: SubagentTask, sourceRun: RunRecord, sourceParent: RunRecord): void {
  if (sourceTask.status === "completed") unavailable("source_already_completed");
  if (sourceRun.status !== "interrupted" || sourceTask.supervisorStatus !== "orphaned" ||
      sourceParent.status !== "interrupted") unavailable("source_not_interrupted");
  if (sourceTask.role === "coder" || sourceTask.writePaths) unavailable("unsupported_coder");
  if (sourceTask.completionReservation) unavailable("completion_reconciliation_required");
  if (sourceRun.usageStatus !== "complete") unavailable("usage_incomplete");
  if (!sourceRun.subagent || (sourceRun.subagent.checkpoint ? sourceRun.subagent.checkpoint.storage !== "local_only"
    : !sourceRun.subagent.continuation)) unavailable("private_state_unavailable");
}
function assertRecoveryParent(targetParent: RunRecord, sourceParent: RunRecord, sourceTask: SubagentTask,
  targetEvents: readonly RunEvent[]): void {
  if (targetParent.source !== "recovery" || targetParent.parentRunId !== sourceParent.id ||
      targetParent.threadId !== sourceTask.threadId || targetParent.status !== "running" || !targetParent.configuration ||
      !targetParent.lease || Date.parse(targetParent.lease.expiresAt) <= Date.now() ||
      durableTerminalRunStatus(targetEvents, targetParent.threadId, targetParent.id) ||
      !targetEvents.some((event) => event.type === "run.recovery.started" && event.payload && typeof event.payload === "object" &&
        !Array.isArray(event.payload) && event.payload["parentRunId"] === sourceParent.id && event.payload["purpose"] !== "inspection"))
    unavailable("parent_authority_unavailable");
}

export async function evaluateSubagentContinuation(host: SubagentChildRunHost,
  input: PrepareSubagentChildContinuationInput): Promise<PreparedSubagentContinuationState> {
  host.assertInitialized();
  const records = structuredClone(continuationRecords(host, input));
  const { sourceRun, sourceTask, sourceParent, targetParent } = records;
  let source: Awaited<ReturnType<typeof readSubagentWorkingSetForRestore>>;
  const checkpoint = sourceRun.subagent!.checkpoint;
  const capsuleSha = checkpoint?.capsuleSha256 ?? sourceRun.subagent!.continuation!.sourceCapsuleSha256;
  try { source = await readSubagentWorkingSetForRestore(host.dataRoot, capsuleSha); }
  catch { unavailable("private_state_unavailable"); }
  const events = host.requireLedger().listRunEvents(sourceRun.id);
  const parentEvents = host.requireLedger().listRunEvents(sourceParent.id);
  const { binding, capsule } = source;
  let inherited: SubagentWorkingSetBinding | undefined;
  try { inherited = await readInheritedSubagentCheckpoint(host.dataRoot, sourceRun); }
  catch { unavailable("private_state_unavailable"); }
  if (checkpoint) assertNativeCheckpoint(sourceRun, sourceTask, sourceParent, binding, events);
  else assertUncheckpointedSuccessor(sourceRun, sourceTask, inherited, events);
  try { subagentCheckpointFrontier(sourceRun, sourceTask, events); }
  catch { unavailable("unsafe_tool_frontier"); }
  assertChildCheckpointTranscript(binding, sourceRun, sourceTask, events, parentEvents, inherited);
  const sourceEvents = sourceLineageEvents(host, sourceRun.id);
  try { await assertSubagentRestoreWorkspace(host.workspaceRoot, capsule, sourceEvents); }
  catch { unavailable("workspace_context_unverifiable"); }
  const { accepted, consumed, pending } = restoredMailbox(host, sourceRun, sourceTask, binding);
  const mode = continuationMode(capsule, pending.length);
  const budget = subagentContinuationBudget(host.state.runs, host.state.subagents, sourceRun, sourceTask, targetParent);
  const priorAccounting = inheritedModelAccountingBudget(sourceRun, host.state.runs);
  assertBudget(budget, mode, {
    budgetTokens: priorAccounting.budgetTokens + (sourceRun.accounting?.budgetTokens ?? totalRawTokens(sourceRun.usage)),
    knownBudgetCostUsd: priorAccounting.knownBudgetCostUsd + (sourceRun.accounting?.knownBudgetCostUsd ?? sourceRun.usage.costUsd),
  });
  const content: Omit<SubagentChildContinuationAssessment, "contentSha256"> = {
    kind: "napier.subagent-continuation-assessment", schemaVersion: 1, threadId: sourceRun.threadId,
    sourceTaskId: sourceTask.id, sourceRunId: sourceRun.id, sourceExecutionId: sourceTask.executionId!, sourceParentRunId: sourceParent.id,
    sourceTaskRevision: sourceTask.revision, sourceExecutionRevision: sourceRun.subagent!.executionRevision,
    sourceRunHeadSeq: events.at(-1)?.seq ?? 0, sourceParentHeadSeq: parentEvents.at(-1)?.seq ?? 0,
    sourceConfigurationSha256: sourceRun.configuration!.contentSha256, sourceParentConfigurationSha256: sourceParent.configuration!.contentSha256,
    targetParentRunId: targetParent.id, targetParentConfigurationSha256: targetParent.configuration!.contentSha256,
    sourceCheckpointRevision: binding.frontier.checkpointRevision + 1, sourceCapsuleSha256: binding.receipt.capsuleSha256,
    checkpointOwner: { taskId: binding.frontier.taskId, runId: binding.frontier.runId,
      executionId: binding.frontier.executionId, parentRunId: binding.frontier.parentRunId },
    sourceMessageCount: binding.receipt.messageCount, sourceMessageSetSha256: binding.receipt.messageSetSha256,
    role: sourceTask.role, promptSha256: sha256(sourceTask.prompt),
    ...(sourceTask.outputSchemaSha256 ? { outputSchemaSha256: sourceTask.outputSchemaSha256 } : {}),
    systemPromptSha256: binding.systemPromptSha256, toolDefinitionSetSha256: binding.toolDefinitionSetSha256,
    toolNames: binding.toolNames, mode, budget, mailboxSnapshotSha256: sha256(canonicalJson({ accepted, consumed })),
  };
  return { dataRoot: host.dataRoot, ...records, capsule, binding, sourceEvents,
    mailbox: { accepted, consumed, pending }, assessment: { ...content, contentSha256: sha256(canonicalJson(content)) } };
}
function unavailable(reason: SubagentContinuationUnavailableReason): never { throw new SubagentContinuationUnavailableError(reason); }
function assertNativeCheckpoint(run: RunRecord, task: SubagentTask, parent: RunRecord,
  binding: SubagentWorkingSetBinding, events: readonly RunEvent[]): void {
  assertNativeCheckpointIdentity(run, task, parent, binding);
  const checkpoint = run.subagent!.checkpoint!;
  const commit = events.find((event) => event.type === "subagent.child.checkpoint_committed" && event.payload &&
    typeof event.payload === "object" && !Array.isArray(event.payload) && event.payload["revision"] === checkpoint.revision);
  if (!commit || binding.frontier.checkpointRevision + 1 !== checkpoint.revision ||
      run.subagent!.executionRevision !== binding.frontier.executionRevision + 1 ||
      run.subagent!.nextInvocationIndex !== binding.frontier.nextInvocationIndex ||
      sha256(canonicalJson(run.usage)) !== binding.frontier.usageSha256 ||
      task.turnCount !== binding.frontier.turnCount || task.stepCount !== binding.frontier.stepCount ||
      events.some((event) => event.seq > commit.seq && event.type !== "run.interrupted")) unavailable("checkpoint_tail_uncovered");
}
function assertNativeCheckpointIdentity(run: RunRecord, task: SubagentTask, parent: RunRecord, binding: SubagentWorkingSetBinding): void {
  if (binding.frontier.runId !== run.id || binding.frontier.taskId !== task.id ||
      binding.frontier.executionId !== task.executionId || binding.frontier.parentRunId !== parent.id ||
      binding.frontier.configurationSha256 !== run.configuration?.contentSha256 ||
      binding.frontier.parentConfigurationSha256 !== parent.configuration?.contentSha256) unavailable("private_state_unavailable");
}
function assertUncheckpointedSuccessor(run: RunRecord, task: SubagentTask,
  inherited: SubagentWorkingSetBinding | undefined, events: readonly RunEvent[]): void {
  if (!inherited || task.turnCount !== 0 || task.stepCount !== 0 || run.subagent!.nextInvocationIndex !== 0 ||
      run.subagent!.executionRevision !== (task.routePlanId ? 2 : 1) ||
      events.some((event) => !["run.started", "subagent.child.continuation_started", "route_plan_created", "run.interrupted"].includes(event.type)))
    unavailable("checkpoint_tail_uncovered");
}
function restoredMailbox(host: SubagentChildRunHost, run: RunRecord, task: SubagentTask, binding: SubagentWorkingSetBinding) {
  const mailbox = continuationMailbox(host, run, task);
  const sourceConsumed = !run.subagent!.checkpoint ? inheritConsumedMailbox(binding.mailbox.entries,
    { taskId: binding.frontier.taskId, parentRunId: binding.frontier.parentRunId }) : binding.mailbox.entries;
  validateConsumedSubagentMailbox(mailbox.accepted, sourceConsumed, []);
  const origin = { taskId: task.id, parentRunId: task.runId };
  const accepted = mailbox.accepted.map((entry) => ({ ...entry, originTaskId: entry.originTaskId ?? origin.taskId,
    originParentRunId: entry.originParentRunId ?? origin.parentRunId }));
  const consumed = inheritConsumedMailbox(sourceConsumed, origin), consumedIds = new Set(consumed.map((entry) => entry.id));
  return { accepted, consumed, pending: accepted.filter((entry) => !consumedIds.has(entry.id))
    .map((entry) => ({ accepted: entry, message: mailbox.messages.get(entry.id)! })) };
}
function assertBudget(budget: SubagentContinuationBudget, mode: "continue" | "finalize",
  accounting: { budgetTokens: number; knownBudgetCostUsd: number }): void {
  if (Date.parse(budget.deadlineAt) <= Date.now()) unavailable("deadline_exhausted");
  if (mode === "continue" && (budget.inheritedTurnCount >= budget.limits.maxTurns ||
      (budget.limits.maxTotalTokens > 0 && accounting.budgetTokens >= budget.limits.maxTotalTokens) ||
      accounting.knownBudgetCostUsd >= budget.limits.maxCostUsd)) unavailable("budget_exhausted");
}
function continuationMode(capsule: Awaited<ReturnType<typeof readSubagentWorkingSetForRestore>>["capsule"], pending: number) {
  const last = capsule.messages.at(-1);
  if (last?.role === "user" || last?.role === "toolResult") return "continue" as const;
  if (last?.role === "assistant" && last.stopReason === "stop" && !last.content.some((block) => block.type === "toolCall"))
    return pending > 0 ? "continue" as const : "finalize" as const;
  unavailable("source_tail_unresumable");
}
function sourceLineageEvents(host: SubagentChildRunHost, runId: string) {
  const events = [];
  const seen = new Set<string>();
  let run = host.state.runs.find((candidate) => candidate.id === runId);
  while (run) {
    if (seen.has(run.id) || seen.size >= 32) unavailable("private_state_unavailable");
    seen.add(run.id);
    events.push(...host.requireLedger().listRunEvents(run.id));
    const predecessor = run.subagent?.continuation?.predecessorRunId;
    if (!predecessor) break;
    run = host.state.runs.find((candidate) => candidate.id === predecessor);
  }
  return events.sort((left, right) => left.seq - right.seq);
}
import type { RunEvent, RunRecord, SubagentContinuationBudget, SubagentTask } from "@napier/contracts";

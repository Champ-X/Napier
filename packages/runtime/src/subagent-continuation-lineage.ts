import { emptyUsage, type RunRecord, type SubagentContinuationBudget, type SubagentContinuationReceipt,
  type SubagentLogicalIdentity, type SubagentTask, type Usage } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";

export function resolveSubagentLogicalIdentity(runs: readonly RunRecord[], tasks: readonly SubagentTask[],
  runId: string): SubagentLogicalIdentity {
  const seen = new Set<string>();
  let run = runs.find((candidate) => candidate.id === runId);
  while (run) {
    if (seen.has(run.id) || seen.size >= 32) throw new Error("Child continuation lineage is cyclic or too deep");
    seen.add(run.id);
    const task = tasks.find((candidate) => candidate.id === run!.subagent?.taskId);
    if (run.source !== "subagent" || !run.subagent || !task || task.childRunId !== run.id || task.executionId !== run.subagent.executionId)
      throw new Error("Child continuation logical identity is invalid");
    const receipt = run.subagent.continuation;
    if (!receipt) return rootIdentity(run, task);
    assertContinuationReceipt(receipt, run, task);
    const predecessor = runs.find((candidate) => candidate.id === receipt.predecessorRunId);
    const sourceTask = tasks.find((candidate) => candidate.id === receipt.predecessorTaskId);
    if (!predecessor || !sourceTask || predecessor.subagent?.taskId !== sourceTask.id ||
        predecessor.subagent.executionId !== receipt.predecessorExecutionId || task.continuedFromTaskId !== sourceTask.id)
      throw new Error("Child continuation predecessor is unavailable");
    run = predecessor;
  }
  throw new Error("Child continuation root is unavailable");
}

export function assertContinuationReceipt(receipt: SubagentContinuationReceipt, run: RunRecord, task: SubagentTask): void {
  const { contentSha256, ...content } = receipt;
  const { contentSha256: grantSha, ...grant } = receipt.grant;
  if (receipt.kind !== "napier.subagent-continuation" || receipt.schemaVersion !== 1 ||
      sha256(canonicalJson(content)) !== contentSha256 || sha256(canonicalJson(grant)) !== grantSha ||
      receipt.targetTaskId !== task.id || receipt.targetRunId !== run.id ||
      receipt.targetExecutionId !== task.executionId || receipt.targetParentRunId !== task.runId ||
      receipt.targetParentRunId !== run.parentRunId || receipt.grant.targetParentRunId !== run.parentRunId ||
      receipt.grant.targetParentConfigurationSha256 !== run.subagent?.parentConfigurationSha256)
    throw new Error("Child continuation receipt binding is invalid");
}

export function subagentContinuationBudget(runs: readonly RunRecord[], tasks: readonly SubagentTask[],
  source: RunRecord, task: SubagentTask, parent: RunRecord): SubagentContinuationBudget {
  const identity = resolveSubagentLogicalIdentity(runs, tasks, source.id);
  const prior = source.subagent?.continuation?.budget;
  if (prior && !sameIdentity(prior, identity)) throw new Error("Child continuation logical budget identity differs");
  const originLimits = prior?.limits ?? source.limits!;
  const targetLimits = parent.configuration!.runLimits;
  const childLimits = parent.configuration!.subagentLimits;
  const originalStartedAt = prior?.originalStartedAt ?? source.startedAt;
  const limits = {
    maxTurns: Math.min(originLimits.maxTurns, targetLimits.maxTurns, childLimits.maxTurns),
    maxTotalTokens: minTokenLimit(originLimits.maxTotalTokens, targetLimits.maxTotalTokens),
    maxCostUsd: Math.min(originLimits.maxCostUsd, targetLimits.maxCostUsd),
    timeoutMs: Math.min(originLimits.timeoutMs, targetLimits.timeoutMs, childLimits.timeoutMs),
  };
  return { ...identity, inheritedUsage: addUsage(prior?.inheritedUsage ?? emptyUsage(), source.usage),
    inheritedTurnCount: (prior?.inheritedTurnCount ?? 0) + task.turnCount,
    inheritedStepCount: (prior?.inheritedStepCount ?? 0) + task.stepCount,
    originalStartedAt, deadlineAt: new Date(Math.min(Date.parse(prior?.deadlineAt ?? "") || Infinity,
      Date.parse(originalStartedAt) + limits.timeoutMs)).toISOString(), limits,
    delegationOrdinal: prior?.delegationOrdinal ?? tasks.filter((candidate) => candidate.runId === task.runId)
      .findIndex((candidate) => candidate.id === task.id) + 1,
    continuationOrdinal: (prior?.continuationOrdinal ?? 0) + 1 };
}

export function sameSubagentLogicalIdentity(left: SubagentLogicalIdentity, right: SubagentLogicalIdentity): boolean {
  return sameIdentity(left, right);
}

/** Public hashes establish consistency, not authority: bind each receipt back to its immutable local predecessor. */
export function assertSubagentContinuationState(runs: readonly RunRecord[], tasks: readonly SubagentTask[]): void {
  const successors = new Set<string>();
  for (const run of runs) {
    const receipt = run.subagent?.continuation;
    if (!receipt) continue;
    if (successors.has(receipt.predecessorRunId)) throw new Error("Child continuation predecessor has multiple successors");
    successors.add(receipt.predecessorRunId);
    const task = tasks.find((candidate) => candidate.id === receipt.targetTaskId);
    const predecessor = runs.find((candidate) => candidate.id === receipt.predecessorRunId);
    const predecessorTask = tasks.find((candidate) => candidate.id === receipt.predecessorTaskId);
    const parent = runs.find((candidate) => candidate.id === run.parentRunId);
    if (!task || !predecessor || !predecessorTask || !parent)
      throw new Error("Child continuation durable lineage is incomplete");
    assertContinuationReceipt(receipt, run, task);
    assertContinuationPredecessor(receipt, task, predecessor, predecessorTask, parent);
    assertContinuationSource(receipt, predecessor, predecessorTask);
    if (canonicalJson(receipt.budget) !== canonicalJson(subagentContinuationBudget(runs, tasks, predecessor, predecessorTask, parent)))
      throw new Error("Child continuation logical budget differs from its predecessor");
  }
  for (const task of tasks) {
    if (task.continuedFromTaskId && !runs.find((run) => run.id === task.childRunId)?.subagent?.continuation)
      throw new Error("Child continuation Task requires a durable receipt");
  }
}

function assertContinuationPredecessor(receipt: SubagentContinuationReceipt, task: SubagentTask,
  predecessor: RunRecord, predecessorTask: SubagentTask, parent: RunRecord): void {
  const grant = receipt.grant;
  if (parent.source !== "recovery" || parent.parentRunId !== predecessor.parentRunId ||
      predecessor.threadId !== task.threadId || task.continuedFromTaskId !== predecessorTask.id ||
      predecessorTask.childRunId !== predecessor.id || predecessorTask.executionId !== receipt.predecessorExecutionId ||
      predecessorTask.revision !== receipt.predecessorTaskRevision ||
      task.role !== predecessorTask.role || task.prompt !== predecessorTask.prompt ||
      task.outputSchemaSha256 !== predecessorTask.outputSchemaSha256 ||
      canonicalJson(task.model) !== canonicalJson(predecessorTask.model))
    throw new Error("Child continuation predecessor intent differs");
  if (grant.kind !== "napier.subagent-continuation-grant" || grant.schemaVersion !== 1 ||
      grant.sourceRunId !== predecessor.id || grant.sourceTaskId !== predecessorTask.id ||
      grant.sourceExecutionId !== predecessorTask.executionId || grant.sourceParentRunId !== predecessor.parentRunId ||
      grant.sourceConfigurationSha256 !== predecessor.configuration?.contentSha256 ||
      grant.sourceParentConfigurationSha256 !== predecessor.subagent?.parentConfigurationSha256 ||
      grant.systemPromptSha256 !== predecessor.configuration?.systemPromptSha256)
    throw new Error("Child continuation grant differs from its predecessor");
}

function assertContinuationSource(receipt: SubagentContinuationReceipt, predecessor: RunRecord, task: SubagentTask): void {
  const checkpoint = predecessor.subagent?.checkpoint;
  const source = checkpoint ? { sourceRunId: predecessor.id, sourceTaskId: task.id, sourceExecutionId: task.executionId!,
    sourceParentRunId: task.runId, sourceCheckpointRevision: checkpoint.revision, sourceCapsuleSha256: checkpoint.capsuleSha256,
    sourceMessageCount: checkpoint.messageCount, sourceMessageSetSha256: checkpoint.messageSetSha256 }
    : predecessor.subagent?.continuation;
  const keys = ["sourceRunId", "sourceTaskId", "sourceExecutionId", "sourceParentRunId", "sourceCheckpointRevision",
    "sourceCapsuleSha256", "sourceMessageCount", "sourceMessageSetSha256"] as const;
  if (!source || keys.some((key) => receipt[key] !== source[key]))
    throw new Error("Child continuation source differs from its predecessor checkpoint");
}
function rootIdentity(run: RunRecord, task: SubagentTask): SubagentLogicalIdentity {
  return { logicalTaskId: task.id, rootChildRunId: run.id, rootParentRunId: task.runId,
    rootExecutionId: task.executionId!, rootIntentSha256: sha256(canonicalJson({
      taskId: task.id, role: task.role, promptSha256: sha256(task.prompt),
      outputSchemaSha256: task.outputSchemaSha256 ?? null, writePaths: task.writePaths ?? [],
    })) };
}
function sameIdentity(left: SubagentLogicalIdentity, right: SubagentLogicalIdentity): boolean {
  return (["logicalTaskId", "rootChildRunId", "rootParentRunId", "rootExecutionId", "rootIntentSha256"] as const)
    .every((key) => left[key] === right[key]);
}
function minTokenLimit(left: number, right: number): number {
  return left === 0 ? right : right === 0 ? left : Math.min(left, right);
}
function addUsage(left: Usage, right: Usage): Usage {
  return Object.fromEntries(Object.keys(emptyUsage()).map((key) => [key, Number(left[key]) + Number(right[key])])) as Usage;
}

import { emptyUsage, type SubagentContinuationReceipt } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import { NAPIER_RELEASE_IDENTITY_SHA256 } from "./release-product-identity.js";
import { createRunConfigurationFingerprint } from "./run-config.js";
import { createRunLeaseBinding } from "./run-lease-renewal.js";
import { resolveSubagentContinuationAuthorization } from "./subagent-continuation-authorization.js";
import { continuationRecords, evaluateSubagentContinuation, SubagentContinuationUnavailableError } from "./subagent-continuation-evaluation.js";
import type { ChildPersistedRun, SubagentChildRunHost } from "./subagent-child-run-host.js";
import { childRunState } from "./subagent-child-run-fence.js";
import { createSubagentTaskRecord, startSubagentTaskRecord } from "./subagent-store-records.js";
import { createSubagentChildRestore, prepareSubagentContinuationSource, resolvePreparedSubagentContinuation } from "./subagent-continuation-source.js";
import type { PrepareSubagentChildContinuationInput, PrepareSubagentChildContinuationResult,
  StartSubagentChildContinuationInput, StartSubagentChildContinuationResult } from "./subagent-continuation-types.js";

export class SubagentContinuationRepository {
  constructor(private readonly host: SubagentChildRunHost) {}

  async prepare(input: PrepareSubagentChildContinuationInput): Promise<PrepareSubagentChildContinuationResult> {
    input = { ...input };
    try {
      const state = await evaluateSubagentContinuation(this.host, input);
      return { kind: "ready", assessment: structuredClone(state.assessment), prepared: prepareSubagentContinuationSource(state) };
    } catch (error) {
      if (error instanceof SubagentContinuationUnavailableError) return { kind: "unavailable", reason: error.reason };
      throw error;
    }
  }

  async start(input: StartSubagentChildContinuationInput): Promise<StartSubagentChildContinuationResult> {
    input = { ...input, lease: { ...input.lease } };
    const proposed = resolvePreparedSubagentContinuation(input.prepared);
    if (proposed.dataRoot !== this.host.dataRoot) throw new Error("Child continuation preparation belongs to another private store");
    this.host.assertInitialized();
    const existing = this.existing(proposed.assessment.sourceRunId);
    if (existing) return existing;
    const fresh = await evaluateSubagentContinuation(this.host, {
      sourceTaskId: proposed.assessment.sourceTaskId, targetParentRunId: proposed.assessment.targetParentRunId,
    });
    if (canonicalJson(fresh.assessment) !== canonicalJson(proposed.assessment))
      throw new Error("Child continuation source changed after preparation");
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const existing = this.existing(proposed.assessment.sourceRunId);
      if (existing) return existing;
      const records = continuationRecords(this.host, { sourceTaskId: proposed.assessment.sourceTaskId,
        targetParentRunId: proposed.assessment.targetParentRunId });
      const { sourceRun, sourceTask, sourceParent, targetParent } = records;
      if (sourceTask.revision !== proposed.assessment.sourceTaskRevision ||
          sourceRun.subagent!.executionRevision !== proposed.assessment.sourceExecutionRevision ||
          this.host.requireLedger().listRunEvents(sourceRun.id).at(-1)?.seq !== proposed.assessment.sourceRunHeadSeq ||
          this.host.requireLedger().listRunEvents(sourceParent.id).at(-1)?.seq !== proposed.assessment.sourceParentHeadSeq ||
          (sourceRun.subagent!.checkpoint?.capsuleSha256 ?? sourceRun.subagent!.continuation?.sourceCapsuleSha256) !== proposed.assessment.sourceCapsuleSha256)
        throw new Error("Child continuation source frontier changed before claim");
      const currentConfiguredProfile = this.host.state.agents.find((agent) => agent.id === targetParent.agentId);
      if (!currentConfiguredProfile) throw new Error("Child continuation current configured profile is unavailable");
      const { profile, grant } = resolveSubagentContinuationAuthorization({ authorization: input.authorization,
        assessment: proposed.assessment, currentConfiguredProfile, ...records });
      const active = this.host.state.runs.filter((run) => run.source === "subagent" && run.parentRunId === targetParent.id &&
        (run.status === "running" || run.status === "queued"));
      if (active.length >= targetParent.configuration!.subagentLimits.maxConcurrent)
        throw new Error("Child continuation concurrency limit reached");
      if (proposed.assessment.budget.delegationOrdinal > targetParent.configuration!.subagentLimits.maxTotal ||
          Date.parse(proposed.assessment.budget.deadlineAt) <= Date.now()) throw new Error("Child continuation logical budget expired");
      const timestamp = nowIso();
      const task = createSubagentTaskRecord({ threadId: sourceTask.threadId, runId: targetParent.id,
        role: sourceTask.role, description: sourceTask.description, prompt: sourceTask.prompt, model: sourceTask.model,
        providerId: sourceTask.providerId ?? "in_process", executionId: createId("subexec"),
        ...(sourceTask.outputSchema ? { outputSchema: sourceTask.outputSchema, outputSchemaSha256: sourceTask.outputSchemaSha256! } : {}),
      }, createId("task"), timestamp);
      task.continuedFromTaskId = sourceTask.id;
      const lease = createRunLeaseBinding(input.lease);
      const configuration = createRunConfigurationFingerprint(profile, task.model, "subagent");
      const run: ChildPersistedRun = { id: createId("run"), threadId: sourceTask.threadId, agentId: targetParent.agentId,
        source: "subagent", status: "running", parentRunId: targetParent.id, startedAt: timestamp,
        releaseIdentitySha256: NAPIER_RELEASE_IDENTITY_SHA256, agentRevision: profile.revision,
        usage: emptyUsage(), usageStatus: "complete", configuration, limits: structuredClone(configuration.runLimits),
        subagent: { taskId: task.id, executionId: task.executionId!, parentConfigurationSha256: targetParent.configuration!.contentSha256,
          executionRevision: 1, nextInvocationIndex: 0 }, lease: lease.binding.summary, leaseTokenSha256: lease.binding.tokenSha256 };
      const content: Omit<SubagentContinuationReceipt, "contentSha256"> = {
        kind: "napier.subagent-continuation", schemaVersion: 1,
        predecessorTaskId: sourceTask.id, predecessorRunId: sourceRun.id, predecessorExecutionId: sourceTask.executionId!,
        predecessorTaskRevision: sourceTask.revision, predecessorRunHeadSeq: proposed.assessment.sourceRunHeadSeq,
        sourceTaskId: proposed.assessment.checkpointOwner.taskId, sourceRunId: proposed.assessment.checkpointOwner.runId,
        sourceExecutionId: proposed.assessment.checkpointOwner.executionId, sourceParentRunId: proposed.assessment.checkpointOwner.parentRunId,
        sourceCheckpointRevision: proposed.assessment.sourceCheckpointRevision, sourceCapsuleSha256: proposed.assessment.sourceCapsuleSha256,
        sourceMessageCount: proposed.assessment.sourceMessageCount, sourceMessageSetSha256: proposed.assessment.sourceMessageSetSha256,
        targetTaskId: task.id, targetRunId: run.id, targetExecutionId: task.executionId!, targetParentRunId: targetParent.id,
        grant, budget: structuredClone(proposed.assessment.budget), mailboxSnapshotSha256: proposed.assessment.mailboxSnapshotSha256,
      };
      const continuation = { ...content, contentSha256: sha256(canonicalJson(content)) };
      run.subagent!.continuation = continuation;
      task.childRunId = run.id; task.usageStatus = "complete";
      startSubagentTaskRecord(task, timestamp);
      this.host.state.runs.push(run); this.host.state.subagents.push(task);
      const thread = this.host.mutableThread(task.threadId);
      thread.runIds.push(run.id); thread.updatedAt = timestamp;
      const events = this.host.appendEventsToThread(thread, [
        { threadId: thread.id, runId: run.id, type: "run.started", category: "lifecycle", visibility: "debug",
          payload: { source: "subagent", parentRunId: targetParent.id, taskId: task.id, executionId: task.executionId!,
            role: task.role, configurationSha256: configuration.contentSha256, parentConfigurationSha256: targetParent.configuration!.contentSha256 } },
        { threadId: thread.id, runId: run.id, type: "subagent.child.continuation_started", category: "subagent", visibility: "debug",
          payload: JSON.parse(canonicalJson(continuation)) },
      ]);
      await this.host.persistState(events);
      return { kind: "started", execution: { ...childRunState(run, task), token: lease.token, profile, events },
        budget: structuredClone(continuation.budget), restore: createSubagentChildRestore({ runId: run.id, taskId: task.id,
          executionId: task.executionId!, messages: fresh.capsule.messages, systemPrompt: fresh.capsule.systemPrompt,
          tools: fresh.capsule.tools, mode: fresh.assessment.mode, continuation, budget: continuation.budget, mailbox: fresh.mailbox }, fresh) };
    });
  }

  private existing(sourceRunId: string): Extract<StartSubagentChildContinuationResult, { kind: "existing" }> | undefined {
    const run = this.host.state.runs.find((candidate) => candidate.subagent?.continuation?.predecessorRunId === sourceRunId);
    const task = this.host.state.subagents.find((candidate) => candidate.id === run?.subagent?.taskId);
    if (!run || !task) return undefined;
    return { kind: "existing", ...childRunState(run, task), continuation: structuredClone(run.subagent!.continuation!) };
  }
}

import { emptyUsage, type RunRecord } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import { NAPIER_RELEASE_IDENTITY_SHA256 } from "./release-product-identity.js";
import { createRunConfigurationFingerprint } from "./run-config.js";
import { createRunLeaseBinding } from "./run-lease-renewal.js";
import { durableTerminalRunStatus } from "./run-event-admission.js";
import { applyOutcome } from "./run-outcomes.js";
import type { SubagentChildRunHost, ChildPersistedRun } from "./subagent-child-run-host.js";
import { SubagentCheckpointRepository } from "./subagent-checkpoint-repository.js";
import { SubagentContinuationRepository } from "./subagent-continuation-repository.js";
import { acceptSubagentMessage } from "./subagent-mailbox-state.js";
import type { AcceptSubagentMessageInput, CommitSubagentChildCheckpointInput } from "./subagent-working-set-types.js";
import { resolveSubagentChildAuthorization } from "./subagent-child-authorization.js";
import { assertChildRunFence, childRunState } from "./subagent-child-run-fence.js";
import { reserveChildInvocation, settleChildInvocation } from "./subagent-child-invocations.js";
import type { FinishSubagentChildRunInput, ReserveSubagentChildInvocationInput,
  SettleSubagentChildInvocationInput, StartedSubagentChildRun, StartSubagentChildRunInput,
  SubagentChildRunFence, SubagentChildRunState, SubagentChildProgressInput, BindSubagentChildRouteInput } from "./subagent-child-run-types.js";
import { finishSubagentTaskRecord, startSubagentTaskRecord } from "./subagent-store-records.js";
import { SubagentCandidateStore } from "./subagent-candidate-store.js";
import { SubagentCompletionRepository, reserveSubagentCompletion, validatePreparedCompletion } from "./subagent-completion-repository.js";
import { assertSubagentCompletionReceipt, createSubagentCompletionReceipt } from "./subagent-completion-receipt.js";
import { readSubagentCompletionCandidate } from "./subagent-completion-candidate.js";
import { subagentJsonValue, subagentTaskPayload } from "./subagent-task-evidence.js";
import type { PrepareSubagentCompletionInput } from "./subagent-completion-types.js";
import type { SubagentCompletionCandidate, SubagentCompletionReservation } from "@napier/contracts";
import { assertContinuationMailboxCompleted } from "./subagent-continuation-mailbox.js";
import { LegacySubagentCandidateRepository, type LegacyCandidateMigrationProof } from "./subagent-candidate-legacy-repository.js";

/** Owns the atomic child Run/Task lifecycle; generic runPrompt never enters here. */
export class SubagentChildRunRepository {
  constructor(private readonly host: SubagentChildRunHost) {}

  start(input: StartSubagentChildRunInput): Promise<StartedSubagentChildRun> {
    input = { ...input, lease: { ...input.lease } };
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const task = this.host.state.subagents.find((candidate) => candidate.id === input.taskId);
      if (!task || task.executionId !== input.executionId || task.status !== "pending" || task.childRunId)
        throw new Error("Child Run requires its pending unstarted Task execution");
      const parent = this.host.mutableRun(task.runId);
      if (durableTerminalRunStatus(this.host.requireLedger().listRunEvents(parent.id), parent.threadId, parent.id) ||
          (parent.lease && Date.parse(parent.lease.expiresAt) <= Date.now()))
        throw new Error("Child Run parent execution is fenced");
      const { profile, limits } = resolveSubagentChildAuthorization(input.authorization, parent, task);
      const delegationOrdinal = this.host.state.subagents.filter((candidate) => candidate.runId === parent.id)
        .findIndex((candidate) => candidate.id === task.id) + 1;
      if (delegationOrdinal < 1 || delegationOrdinal > limits.maxTotal)
        throw new Error("Parent Run total child limit reached");
      const siblings = this.host.state.runs.filter((run) => run.source === "subagent" &&
        run.parentRunId === parent.id && (run.status === "queued" || run.status === "running"));
      if (siblings.length >= limits.maxConcurrent)
        throw new Error("Parent Run concurrent child limit reached");
      const thread = this.host.mutableThread(parent.threadId);
      const lease = createRunLeaseBinding(input.lease);
      const timestamp = nowIso();
      const configuration = createRunConfigurationFingerprint(profile, task.model, "subagent");
      const run: ChildPersistedRun = {
        id: createId("run"), threadId: parent.threadId, agentId: parent.agentId,
        status: "running", source: "subagent", parentRunId: parent.id,
        releaseIdentitySha256: NAPIER_RELEASE_IDENTITY_SHA256,
        startedAt: timestamp, usage: emptyUsage(), usageStatus: "complete", agentRevision: profile.revision,
        limits: structuredClone(configuration.runLimits), configuration,
        subagent: { taskId: task.id, executionId: input.executionId,
          parentConfigurationSha256: parent.configuration!.contentSha256,
          executionRevision: 1, nextInvocationIndex: 0 },
        lease: lease.binding.summary, leaseTokenSha256: lease.binding.tokenSha256,
      };
      this.host.state.runs.push(run);
      thread.runIds.push(run.id);
      thread.updatedAt = timestamp;
      task.childRunId = run.id;
      task.usageStatus = "complete";
      startSubagentTaskRecord(task, timestamp);
      const events = this.host.appendEventsToThread(thread, [{
        threadId: thread.id, runId: run.id, type: "run.started", category: "lifecycle",
        visibility: "debug", payload: { source: "subagent", parentRunId: parent.id,
          taskId: task.id, executionId: input.executionId, role: task.role,
          configurationSha256: configuration.contentSha256,
          parentConfigurationSha256: parent.configuration!.contentSha256 },
      }]);
      await this.host.persistState(events);
      return { ...childRunState(run, task), token: lease.token, profile, events };
    });
  }

  prepareCheckpoint(input: SubagentChildRunFence) { return new SubagentCheckpointRepository(this.host).prepare(input); }
  prepareContinuation(input: import("./subagent-continuation-types.js").PrepareSubagentChildContinuationInput) { return new SubagentContinuationRepository(this.host).prepare(input); }
  startContinuation(input: import("./subagent-continuation-types.js").StartSubagentChildContinuationInput) { return new SubagentContinuationRepository(this.host).start(input); }
  commitCheckpoint(input: CommitSubagentChildCheckpointInput) { return new SubagentCheckpointRepository(this.host).commit(input); }
  acceptMessage(input: AcceptSubagentMessageInput) { return acceptSubagentMessage(this.host, input); }
  prepareCompletion(input: PrepareSubagentCompletionInput) { return new SubagentCompletionRepository(this.host).prepare(input); }
  candidateDelivered(reservation: SubagentCompletionReservation, candidate: SubagentCompletionCandidate) {
    return new SubagentCompletionRepository(this.host).delivered(reservation, candidate);
  }
  reconcileLegacyCandidateProof(proof: LegacyCandidateMigrationProof) {
    return new LegacySubagentCandidateRepository(this.host).reconcile(proof);
  }
  reconcileLegacyCandidate(candidateId: string) {
    return new SubagentCandidateStore({ ...this.host,
      legacyCandidateAuthority: (proof) => this.reconcileLegacyCandidateProof(proof) }).reconcileLegacy(candidateId);
  }

  assertActive(input: SubagentChildRunFence): SubagentChildRunState {
    this.host.assertInitialized();
    const { run, task } = assertChildRunFence(this.host, input);
    return childRunState(run, task);
  }

  reserveInvocation(input: ReserveSubagentChildInvocationInput) {
    return reserveChildInvocation(this.host, input);
  }

  settleInvocation(input: SettleSubagentChildInvocationInput) {
    return settleChildInvocation(this.host, input);
  }

  progress(input: SubagentChildProgressInput): Promise<SubagentChildRunState> {
    input = { ...input };
    this.host.assertInitialized();
    if ([input.stepDelta ?? 0, input.turnDelta ?? 0].some((value) => !Number.isSafeInteger(value) || value < 0))
      throw new Error("Child progress delta is invalid");
    return this.host.stateQueue.run(async () => {
      const { run, task } = assertChildRunFence(this.host, input, { requireParentActive: false });
      task.stepCount += input.stepDelta ?? 0;
      task.turnCount += input.turnDelta ?? 0;
      task.revision += 1;
      run.subagent!.executionRevision += 1;
      await this.host.persistState();
      return childRunState(run, task);
    });
  }

  bindRoute(input: BindSubagentChildRouteInput): Promise<SubagentChildRunState> {
    input = { ...input };
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const { run, task } = assertChildRunFence(this.host, input);
      const event = this.host.requireLedger().listRunEvents(run.id).find((candidate) => {
        const payload = candidate.payload;
        return candidate.type === "route_plan_created" && payload && typeof payload === "object" &&
          !Array.isArray(payload) && payload["id"] === input.routePlanId && payload["runId"] === run.id;
      });
      if (!event || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload))
        throw new Error("Child route requires its durable Run-owned plan");
      const { contentSha256, ...content } = event.payload;
      if (content["kind"] !== "napier.model-route-plan" || content["schemaVersion"] !== 2 ||
          sha256(canonicalJson(content)) !== contentSha256 ||
          (task.routePlanId !== undefined && task.routePlanId !== input.routePlanId))
        throw new Error("Child route plan binding is invalid or conflicting");
      task.routePlanId = input.routePlanId;
      task.revision += 1;
      run.subagent!.executionRevision += 1;
      await this.host.persistState();
      return childRunState(run, task);
    });
  }

  finish(input: FinishSubagentChildRunInput): Promise<SubagentChildRunState> {
    const { preparedCompletion, ...finish } = input.finish;
    input = { ...input, finish: { ...structuredClone(finish), ...(preparedCompletion ? { preparedCompletion } : {}) } };
    this.host.assertInitialized();
    const complete = () => this.host.stateQueue.run(async () => {
      const existing = this.host.state.subagents.find((task) => task.id === input.taskId);
      if (existing?.status === "completed" && input.finish.status === "completed" && preparedCompletion) {
        validatePreparedCompletion(this.host, existing, input);
        assertSubagentCompletionReceipt(existing);
        return childRunState(this.host.mutableRun(input.runId), existing);
      }
      input.assertActive?.();
      const { run, task } = assertChildRunFence(this.host, input, { requireParentActive: input.finish.status === "completed" });
      if (input.finish.usage && canonicalJson(input.finish.usage) !== canonicalJson(run.usage))
        throw new Error("Child terminal usage conflicts with settled invocation usage");
      const status = childTerminalStatus(input.finish.status);
      if (status === "completed" && run.usageStatus === "incomplete")
        throw new Error("Child Run cannot complete with unresolved model invocations");
      if (status === "completed") {
        assertContinuationMailboxCompleted(this.host, run, task);
        validatePreparedCompletion(this.host, task, input);
      }
      const reservation = status === "completed" ? reserveSubagentCompletion(this.host, task, { ...input.finish, usage: run.usage }) : undefined;
      const preview = reservation?.candidate ? await readSubagentCompletionCandidate(this.host,
        { ...task, ...input.finish, completionReservation: reservation }, true) : undefined;
      const outcome = status === "completed" ? "completed" : status === "cancelled" ? "cancelled"
        : input.finish.status === "timed_out" ? "paused_budget" : "failed_unrecoverable";
      const timestamp = nowIso();
      finishSubagentTaskRecord(task, { ...input.finish, usage: run.usage }, timestamp);
      if (reservation) {
        task.completionReservation = reservation;
        task.completion = createSubagentCompletionReceipt(reservation, timestamp);
      }
      applyOutcome(run, status, outcome);
      run.finishedAt = timestamp;
      if (input.finish.error) run.error = input.finish.error;
      run.subagent!.executionRevision += 1;
      delete run.lease;
      delete run.leaseTokenSha256;
      const thread = this.host.mutableThread(run.threadId);
      thread.updatedAt = timestamp;
      const events = this.host.appendEventsToThread(thread, [{
        threadId: thread.id, runId: run.id,
        type: status === "completed" ? "run.completed" : status === "cancelled" ? "run.cancelled" : "run.failed",
        category: "lifecycle", visibility: "debug",
        payload: { status, outcome, taskId: task.id, executionId: input.executionId,
          usage: run.usage, stopReason: input.finish.stopReason },
      }]);
      if (task.completion) {
        const accepted = task.outcome ? {
          type: "subagent.outcome.accepted" as const, payload: { taskId: task.id, role: task.role, status: "accepted",
            outcomeSha256: task.outcome.contentSha256, resultSha256: task.outcome.resultSha256,
            itemSetSha256: task.outcome.itemSetSha256, itemCount: task.outcome.itemCount, unknownCount: task.outcome.unknownCount,
            evidenceSetSha256: task.outcome.evidenceSetSha256, evidenceCount: task.outcome.evidenceCount },
        } : task.output !== undefined ? {
          type: "subagent.output.accepted" as const, payload: { taskId: task.id, status: "accepted",
            outputSchemaSha256: task.outputSchemaSha256 ?? "", outputSha256: sha256(canonicalJson(task.output)) },
        } : undefined;
        events.push(...this.host.appendEventsToThread(thread, [
          ...(accepted ? [{ ...accepted, payload: subagentJsonValue(accepted.payload), threadId: thread.id,
            runId: task.runId, category: "subagent" as const, visibility: "user" as const }] : []),
          { threadId: thread.id, runId: task.runId, type: "subagent.completed", category: "subagent", visibility: "user",
            payload: subagentJsonValue({ ...subagentTaskPayload(task, preview),
              completionSha256: task.completion.contentSha256,
              logicalCompletionKey: task.completion.reservation.logicalCompletionKey }) },
        ]));
      }
      await this.host.persistState(events);
      return { ...childRunState(run, task), events };
    });
    const operation = input.finish.candidateId ? new SubagentCandidateStore(this.host)
      .withCompletionLock(input.finish.candidateId, complete) : complete();
    return operation.catch((error: unknown) => {
      // Another process may commit between our active check and event admission.
      // A matching persisted delivery event, never a locally mutated Task, proves the retry.
      this.host.assertInitialized();
      const task = this.host.state.subagents.find((entry) => entry.id === input.taskId);
      const delivered = task?.completion && this.host.requireLedger().listRunEvents(task.runId).some((event) =>
        event.type === "subagent.completed" && event.payload && typeof event.payload === "object" &&
        !Array.isArray(event.payload) && event.payload["completionSha256"] === task.completion?.contentSha256);
      if (!preparedCompletion || !task || !delivered) throw error;
      validatePreparedCompletion(this.host, task, input);
      assertSubagentCompletionReceipt(task);
      return childRunState(this.host.mutableRun(input.runId), task);
    });
  }
}

function childTerminalStatus(status: FinishSubagentChildRunInput["finish"]["status"]):
  Extract<RunRecord["status"], "completed" | "cancelled" | "failed"> {
  return status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
}

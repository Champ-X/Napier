import { emptyUsage, type RunRecord } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import { NAPIER_RELEASE_IDENTITY_SHA256 } from "./release-product-identity.js";
import { createRunConfigurationFingerprint } from "./run-config.js";
import { createRunLeaseBinding } from "./run-lease-renewal.js";
import { durableTerminalRunStatus } from "./run-event-admission.js";
import { applyOutcome } from "./run-outcomes.js";
import type { SubagentChildRunHost, ChildPersistedRun } from "./subagent-child-run-host.js";
import { resolveSubagentChildAuthorization } from "./subagent-child-authorization.js";
import { assertChildRunFence, childRunState } from "./subagent-child-run-fence.js";
import { reserveChildInvocation, settleChildInvocation } from "./subagent-child-invocations.js";
import type { FinishSubagentChildRunInput, ReserveSubagentChildInvocationInput,
  SettleSubagentChildInvocationInput, StartedSubagentChildRun, StartSubagentChildRunInput,
  SubagentChildRunFence, SubagentChildRunState, SubagentChildProgressInput, BindSubagentChildRouteInput } from "./subagent-child-run-types.js";
import { finishSubagentTaskRecord, startSubagentTaskRecord } from "./subagent-store-records.js";

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
    input = { ...input, finish: structuredClone(input.finish) };
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      input.assertActive?.();
      const { run, task } = assertChildRunFence(this.host, input, { requireParentActive: input.finish.status === "completed" });
      if (input.finish.usage && canonicalJson(input.finish.usage) !== canonicalJson(run.usage))
        throw new Error("Child terminal usage conflicts with settled invocation usage");
      const status = childTerminalStatus(input.finish.status);
      if (status === "completed" && run.usageStatus === "incomplete")
        throw new Error("Child Run cannot complete with unresolved model invocations");
      const outcome = status === "completed" ? "completed" : status === "cancelled" ? "cancelled"
        : input.finish.status === "timed_out" ? "paused_budget" : "failed_unrecoverable";
      const timestamp = nowIso();
      finishSubagentTaskRecord(task, { ...input.finish, usage: run.usage }, timestamp);
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
      await this.host.persistState(events);
      return { ...childRunState(run, task), events };
    });
  }
}

function childTerminalStatus(status: FinishSubagentChildRunInput["finish"]["status"]):
  Extract<RunRecord["status"], "completed" | "cancelled" | "failed"> {
  return status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
}

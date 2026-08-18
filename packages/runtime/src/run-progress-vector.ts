import type { BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type {
  ExecutionPlan,
  JsonValue,
  RunLimits,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import type { UserMessage } from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { LocalStore } from "./store.js";
import {
  createRunProgressGovernor,
  isWorkspaceMutationTool,
  type RunProgressGovernor,
} from "./run-progress-governor.js";
import { RunResearchBudget } from "./run-research-budget.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { AgentToolResultLifecycle } from "./agent-tool-result-lifecycle.js";
import {
  runProgressFailureFingerprint,
  runProgressToolInputFingerprint,
} from "./run-progress-failures.js";

export type RunProgressDimension =
  | "workspace"
  | "plan"
  | "artifact"
  | "source"
  | "approval"
  | "capability"
  | "result";

interface DimensionHashes {
  workspace: string;
  plan: string;
  artifact: string;
  source: string;
  approval: string;
  capability: string;
  result: string;
}

const SOURCE_TOOLS = new Set([
  "browser",
  "web_search",
  "web_fetch",
  "web_fetch_save",
  "research_source",
]);
const EVIDENCE_HASH_FIELDS = [
  "resultSha256",
  "contentSha256",
  "afterSha256",
  "outputSha256",
  "outputTextSha256",
] as const;
const EMPTY_SET_SHA256 = sha256(canonicalJson([]));

export class RunProgressTracker {
  private lastSeq: number;
  private turnIndex = 0;
  private stagnantTurnCount = 0;
  private firstWorkspaceMutationTurn: number | undefined;
  private firstWorkspaceMutationElapsedMs: number | undefined;
  private lastProgressElapsedMs = 0;
  private previousContentSha256 = "";
  private previousDimensions: DimensionHashes = emptyDimensions();
  private readonly planIds = new Set<string>();
  private readonly workspaceEvidence = new Set<string>();
  private readonly sourceEvidence = new Set<string>();
  private readonly approvalEvidence = new Set<string>();
  private readonly capabilityEvidence = new Set<string>();
  private readonly resultEvidence = new Set<string>();
  private readonly failureFingerprints = new Set<string>();
  private readonly toolInputFingerprints = new Map<string, string>();

  private constructor(
    private readonly context: {
      store: LocalStore;
      run: Pick<RunRecord, "id" | "threadId" | "startedAt">;
      onEvent?: EventSink;
    },
    private readonly governor: RunProgressGovernor,
    private readonly researchBudget: RunResearchBudget,
    lastSeq: number,
  ) {
    this.lastSeq = lastSeq;
  }

  static async create(
    store: LocalStore,
    run: Pick<RunRecord, "id" | "threadId" | "startedAt">,
    onEvent?: EventSink,
    task?: { prompt: string; toolNames: string[] },
    limits?: RunLimits,
  ): Promise<RunProgressTracker> {
    const events = await store.listEvents(run.threadId);
    const prompt = task?.prompt ?? "";
    const toolNames = task?.toolNames ?? [];
    const runLimits =
      limits ??
      store.listRuns(run.threadId).find((candidate) => candidate.id === run.id)
        ?.limits;
    if (!runLimits) throw new Error("Run progress requires Run limits");
    return new RunProgressTracker(
      {
        store,
        run,
        ...(onEvent ? { onEvent } : {}),
      },
      createRunProgressGovernor({
        store,
        run,
        prompt,
        toolNames,
        ...(onEvent ? { onEvent } : {}),
      }),
      new RunResearchBudget({
        store,
        run,
        limits: runLimits,
        ...(onEvent ? { onEvent } : {}),
      }),
      events.at(-1)?.seq ?? 0,
    );
  }

  async recordTurn(): Promise<RunEvent> {
    this.turnIndex += 1;
    const events = await this.context.store.listEvents(
      this.context.run.threadId,
      this.lastSeq,
    );
    const completed = events.findLast(
      (event) =>
        event.runId === this.context.run.id && event.type === "turn.completed",
    );
    if (!completed) {
      throw new Error("Run progress vector requires a completed turn");
    }
    this.ingest(events);
    const plans = this.currentPlans();
    const planState = projectPlanState(plans);
    const artifactState = projectArtifactState(plans);
    const dimensions: DimensionHashes = {
      workspace: hashSet(this.workspaceEvidence),
      plan: planState.sha256,
      artifact: artifactState.sha256,
      source: hashSet(this.sourceEvidence),
      approval: hashSet(this.approvalEvidence),
      capability: hashSet(this.capabilityEvidence),
      result: hashSet(this.resultEvidence),
    };
    const changedDimensions = dimensionNames().filter(
      (dimension) =>
        dimensions[dimension] !== this.previousDimensions[dimension],
    );
    const progressed = changedDimensions.length > 0;
    const elapsed = elapsedMs(this.context.run.startedAt, completed.createdAt);
    this.researchBudget.completeTurn(this.turnIndex, completed.createdAt);
    this.stagnantTurnCount = progressed ? 0 : this.stagnantTurnCount + 1;
    if (progressed) this.lastProgressElapsedMs = elapsed;
    const stagnantElapsedMs = Math.max(0, elapsed - this.lastProgressElapsedMs);
    const content = {
      kind: "napier.run-progress-vector" as const,
      schemaVersion: 1 as const,
      turnIndex: this.turnIndex,
      turnCompletedSeq: completed.seq,
      elapsedMs: elapsed,
      progressed,
      changedDimensions,
      stagnantTurnCount: this.stagnantTurnCount,
      stagnantElapsedMs,
      workspaceMutationCount: this.workspaceEvidence.size,
      sourceCount: this.sourceEvidence.size,
      approvalCount: this.approvalEvidence.size,
      capabilityStatusCount: this.capabilityEvidence.size,
      userResultCount: this.resultEvidence.size,
      planCount: plans.length,
      planRevisionTotal: planState.revisionTotal,
      planStatusCounts: planState.planStatusCounts,
      stepStatusCounts: planState.stepStatusCounts,
      artifactCount: artifactState.artifactCount,
      artifactCandidateCount: artifactState.candidateCount,
      artifactStatusCounts: artifactState.statusCounts,
      failureFingerprintCount: this.failureFingerprints.size,
      failureFingerprintSetSha256: hashSet(this.failureFingerprints),
      dimensions,
      predecessorContentSha256: this.previousContentSha256,
      ...(this.firstWorkspaceMutationTurn !== undefined
        ? {
            firstWorkspaceMutationTurn: this.firstWorkspaceMutationTurn,
            firstWorkspaceMutationElapsedMs:
              this.firstWorkspaceMutationElapsedMs!,
          }
        : {}),
    };
    const payload = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    const event = await this.context.store.appendEvent({
      threadId: this.context.run.threadId,
      runId: this.context.run.id,
      type: "run.progress.vector",
      category: "lifecycle",
      visibility: "debug",
      payload: payload as unknown as JsonValue,
    });
    this.lastSeq = event.seq;
    this.previousDimensions = dimensions;
    this.previousContentSha256 = payload.contentSha256;
    await emit(this.context.onEvent, event);
    await this.governor.afterVector(payload);
    return event;
  }

  async steer(
    preRecordedMessages: Map<string, number>,
    external: (mode: "steering") => Promise<UserMessage[]>,
  ): Promise<UserMessage[]> {
    return this.governor.steer(preRecordedMessages, external);
  }

  preflightTool(toolName: string) {
    return this.researchBudget.preflight(toolName, this.turnIndex + 1);
  }

  private ingest(events: RunEvent[]): void {
    for (const event of events) {
      this.lastSeq = Math.max(this.lastSeq, event.seq);
      if (event.runId !== this.context.run.id) continue;
      const payload = record(event.payload);
      const planId = stringValue(payload?.["planId"]);
      if (planId) this.planIds.add(planId);
      if (event.type === "tool.started") {
        const callId = stringValue(payload?.["callId"]);
        if (callId && payload) {
          this.toolInputFingerprints.set(
            callId,
            runProgressToolInputFingerprint(payload),
          );
        }
      }
      if (event.type === "tool.failed" || event.type === "tool.blocked") {
        this.failureFingerprints.add(
          runProgressFailureFingerprint(
            event,
            payload,
            this.toolInputFingerprints,
          ),
        );
      }
      if (event.type === "tool.completed") {
        const toolName = stringValue(payload?.["toolName"]);
        if (toolName && SOURCE_TOOLS.has(toolName)) {
          this.sourceEvidence.add(eventEvidence(event));
        }
        if (toolName && isWorkspaceMutationTool(toolName)) {
          this.workspaceEvidence.add(eventEvidence(event));
          if (this.firstWorkspaceMutationTurn === undefined) {
            this.firstWorkspaceMutationTurn = this.turnIndex;
            this.firstWorkspaceMutationElapsedMs = elapsedMs(
              this.context.run.startedAt,
              event.createdAt,
            );
          }
        }
      }
      if (isApprovalEvent(event)) {
        this.approvalEvidence.add(eventEvidence(event));
      }
      if (isCapabilityEvent(event)) {
        this.capabilityEvidence.add(eventEvidence(event));
      }
      if (
        event.type === "message.assistant" ||
        event.type === "agent.milestone.recorded"
      ) {
        this.resultEvidence.add(eventEvidence(event));
      }
    }
  }

  private currentPlans(): ExecutionPlan[] {
    return this.context.store
      .listPlans(this.context.run.threadId)
      .filter((plan) => this.planIds.has(plan.id));
  }
}

export function progLife(
  host: { store: LocalStore },
  budget: RunBudgetTracker,
  run: Pick<RunRecord, "id" | "threadId" | "startedAt">,
  tools: Array<{ name: string }>,
  prompt: string,
  onEvent?: EventSink,
): Promise<RunProgressTracker> {
  return RunProgressTracker.create(
    host.store,
    run,
    onEvent,
    {
      prompt,
      toolNames: tools.map((tool) => tool.name),
    },
    budget.limits,
  );
}

export async function progTool(
  tracker: RunProgressTracker,
  lifecycle: AgentToolResultLifecycle,
  toolCall: { id: string; name: string },
  args: unknown,
): Promise<BeforeToolCallResult | undefined> {
  return (
    (await tracker.preflightTool(toolCall.name)) ??
    lifecycle.preflight(toolCall.id, toolCall.name, args)
  );
}

function projectPlanState(plans: ExecutionPlan[]): {
  revisionTotal: number;
  planStatusCounts: Record<string, number>;
  stepStatusCounts: Record<string, number>;
  sha256: string;
} {
  const state = plans
    .map((plan) => ({
      idSha256: sha256(plan.id),
      revision: plan.revision,
      status: plan.status,
      steps: plan.steps.map((step) => ({
        idSha256: sha256(step.id),
        status: step.status,
      })),
    }))
    .sort((left, right) => left.idSha256.localeCompare(right.idSha256));
  return {
    revisionTotal: plans.reduce((total, plan) => total + plan.revision, 0),
    planStatusCounts: statusCounts(plans.map((plan) => plan.status)),
    stepStatusCounts: statusCounts(
      plans.flatMap((plan) => plan.steps.map((step) => step.status)),
    ),
    sha256: sha256(canonicalJson(state)),
  };
}

function projectArtifactState(plans: ExecutionPlan[]): {
  artifactCount: number;
  candidateCount: number;
  statusCounts: Record<string, number>;
  sha256: string;
} {
  const artifacts = plans
    .flatMap((plan) =>
      plan.artifacts.map((artifact) => ({
        idSha256: sha256(`${plan.id}:${artifact.id}`),
        status: artifact.status,
      })),
    )
    .sort((left, right) => left.idSha256.localeCompare(right.idSha256));
  return {
    artifactCount: artifacts.length,
    candidateCount: artifacts.filter(
      (artifact) => artifact.status === "candidate",
    ).length,
    statusCounts: statusCounts(artifacts.map((artifact) => artifact.status)),
    sha256: sha256(canonicalJson(artifacts)),
  };
}

function isApprovalEvent(event: RunEvent): boolean {
  return (
    event.type.startsWith("operator.decision.") ||
    event.type.startsWith("browser.interaction_confirmation.") ||
    event.type.startsWith("workflow.approval.")
  );
}

function isCapabilityEvent(event: RunEvent): boolean {
  return (
    event.category === "extension" ||
    event.category === "credential" ||
    event.type === "tool.deadline.exceeded" ||
    event.type.startsWith("model.stream.") ||
    event.type.startsWith("sandbox.")
  );
}

function eventEvidence(event: RunEvent): string {
  const payload = record(event.payload);
  const detailsValue = payload?.["details"];
  const details = detailsValue === undefined ? undefined : record(detailsValue);
  const binding =
    EVIDENCE_HASH_FIELDS.map((field) => stringValue(details?.[field])).find(
      isSha256,
    ) ??
    EVIDENCE_HASH_FIELDS.map((field) => stringValue(payload?.[field])).find(
      isSha256,
    ) ??
    sha256(event.id);
  return sha256(
    canonicalJson({
      type: event.type,
      binding,
    }),
  );
}

function statusCounts(values: string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((status) => [
        status,
        values.filter((value) => value === status).length,
      ]),
  );
}

function hashSet(values: Set<string>): string {
  return values.size === 0
    ? EMPTY_SET_SHA256
    : sha256(canonicalJson([...values].sort()));
}

function emptyDimensions(): DimensionHashes {
  return {
    workspace: EMPTY_SET_SHA256,
    plan: EMPTY_SET_SHA256,
    artifact: EMPTY_SET_SHA256,
    source: EMPTY_SET_SHA256,
    approval: EMPTY_SET_SHA256,
    capability: EMPTY_SET_SHA256,
    result: EMPTY_SET_SHA256,
  };
}

function dimensionNames(): RunProgressDimension[] {
  return [
    "workspace",
    "plan",
    "artifact",
    "source",
    "approval",
    "capability",
    "result",
  ];
}

function record(value: JsonValue): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSha256(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/u.test(value));
}

function elapsedMs(startedAt: string, observedAt: string): number {
  return Math.max(0, Date.parse(observedAt) - Date.parse(startedAt));
}

async function emit(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Durable progress evidence survives a disconnected stream.
  }
}

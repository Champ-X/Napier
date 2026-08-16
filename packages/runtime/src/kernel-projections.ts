import type { RunEvent, ThreadRecord, ThreadSummary } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  applyTaskNarrativeEvent,
  createTaskNarrativeEventState,
  taskNarrativeView,
  type TaskNarrativeEventState,
  type TaskNarrativeSource,
} from "./task-narrative-projection.js";

type TaskNarrativeProjection = NonNullable<
  import("@napier/contracts").ThreadDetail["taskNarrative"]
>;

export interface KernelProjectionDefinition<Seed, State, View> {
  id: string;
  version: number;
  init(seed: Seed): State;
  apply(state: State, event: RunEvent): State;
  view(state: State): View;
}

export interface KernelProjectionReceipt<View> {
  projectionId: string;
  stateVersion: number;
  eventWatermark: number;
  cacheHit: boolean;
  appliedEventCount: number;
  view: View;
}

interface ProjectionCacheEntry {
  projectionId: string;
  subjectId: string;
  stateVersion: number;
  eventWatermark: number;
  sourceIdentitySha256: string;
  state: unknown;
}

interface StoredProjectionDefinition {
  id: string;
  version: number;
  owner: string;
  definition: KernelProjectionDefinition<unknown, unknown, unknown>;
}

const PROJECTION_ID = /^[a-z][a-z0-9_.-]{2,79}$/u;

export class KernelProjectionRegistry {
  private readonly definitions = new Map<string, StoredProjectionDefinition>();
  private readonly cache = new Map<string, ProjectionCacheEntry>();
  private closed = false;

  register<Seed, State, View>(
    definition: KernelProjectionDefinition<Seed, State, View>,
    owner = "kernel",
  ): void {
    this.assertOpen();
    assertDefinition(definition);
    const current = this.definitions.get(definition.id);
    if (current && current.version >= definition.version) {
      throw new Error(
        `Kernel projection version must increase: ${definition.id}@${String(definition.version)}`,
      );
    }
    this.definitions.set(definition.id, {
      id: definition.id,
      version: definition.version,
      owner,
      definition: definition as KernelProjectionDefinition<
        unknown,
        unknown,
        unknown
      >,
    });
    if (current) this.invalidate(definition.id);
  }

  async project<Seed, State, View>(input: {
    definition: KernelProjectionDefinition<Seed, State, View>;
    subjectId: string;
    seed: Seed;
    sourceIdentity: unknown;
    sourceWatermark: number;
    initialWatermark?: number;
    loadEvents(afterSeq: number): Promise<RunEvent[]>;
  }): Promise<KernelProjectionReceipt<View>> {
    this.assertOpen();
    const registered = this.definitions.get(input.definition.id);
    if (
      !registered ||
      registered.version !== input.definition.version ||
      registered.definition !== input.definition
    ) {
      throw new Error(
        `Kernel projection is not registered: ${input.definition.id}@${String(input.definition.version)}`,
      );
    }
    assertProjectionInput(input);
    const cacheKey = `${input.definition.id}:${input.subjectId}`;
    const sourceIdentitySha256 = sha256(canonicalJson(input.sourceIdentity));
    const cached = this.cache.get(cacheKey);
    const cacheHit = Boolean(
      cached &&
      cached.stateVersion === input.definition.version &&
      cached.sourceIdentitySha256 === sourceIdentitySha256 &&
      cached.eventWatermark <= input.sourceWatermark,
    );
    let state = cacheHit
      ? (cached!.state as State)
      : input.definition.init(input.seed);
    let eventWatermark = cacheHit
      ? cached!.eventWatermark
      : (input.initialWatermark ?? 0);
    const events = await input.loadEvents(eventWatermark);
    for (const event of events) {
      if (
        event.threadId !== input.subjectId ||
        event.seq !== eventWatermark + 1
      ) {
        throw new Error(
          `Kernel projection tail is not contiguous: ${input.definition.id}:${input.subjectId}`,
        );
      }
      state = input.definition.apply(state, event);
      eventWatermark = event.seq;
    }
    if (eventWatermark !== input.sourceWatermark) {
      throw new Error(
        `Kernel projection watermark mismatch: ${input.definition.id}:${input.subjectId}`,
      );
    }
    this.cache.set(cacheKey, {
      projectionId: input.definition.id,
      subjectId: input.subjectId,
      stateVersion: input.definition.version,
      eventWatermark,
      sourceIdentitySha256,
      state,
    });
    return {
      projectionId: input.definition.id,
      stateVersion: input.definition.version,
      eventWatermark,
      cacheHit,
      appliedEventCount: events.length,
      view: input.definition.view(state),
    };
  }

  inspect(): Array<{
    projectionId: string;
    subjectId: string;
    stateVersion: number;
    eventWatermark: number;
  }> {
    return [...this.cache.values()]
      .map(({ projectionId, subjectId, stateVersion, eventWatermark }) => ({
        projectionId,
        subjectId,
        stateVersion,
        eventWatermark,
      }))
      .sort((left, right) =>
        `${left.projectionId}:${left.subjectId}`.localeCompare(
          `${right.projectionId}:${right.subjectId}`,
        ),
      );
  }

  invalidate(projectionId: string, subjectId?: string): void {
    for (const [key, entry] of this.cache) {
      if (
        entry.projectionId === projectionId &&
        (!subjectId || entry.subjectId === subjectId)
      ) {
        this.cache.delete(key);
      }
    }
  }

  disposeOwner(owner: string): void {
    this.assertOpen();
    for (const [id, definition] of this.definitions) {
      if (definition.owner !== owner) continue;
      this.invalidate(id);
      this.definitions.delete(id);
    }
  }

  shutdown(): void {
    if (this.closed) return;
    this.cache.clear();
    this.definitions.clear();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Kernel projection registry is closed");
  }
}

export interface ThreadSummaryProjectionState {
  summary: ThreadSummary;
  visible: boolean;
}

export interface ThreadSummaryProjectionView {
  summary: ThreadSummary;
  visible: boolean;
}

export const THREAD_SUMMARY_PROJECTION: KernelProjectionDefinition<
  { thread: ThreadRecord },
  ThreadSummaryProjectionState,
  ThreadSummaryProjectionView
> = {
  id: "thread.summary",
  version: 1,
  init: ({ thread }) => ({
    summary: {
      ...summaryFromThread(thread),
      status: "idle",
      updatedAt: thread.createdAt,
      lastMessage: "",
      eventCount: 0,
    },
    visible: true,
  }),
  apply: (state, event) => ({
    summary: {
      ...state.summary,
      eventCount: event.seq,
      updatedAt: event.createdAt,
      ...threadStatusProjection(event),
      ...messagePreviewProjection(event),
    },
    visible:
      event.type === "thread.trashed"
        ? false
        : event.type === "thread.restored"
          ? true
          : state.visible,
  }),
  view: (state) => structuredClone(state),
};

export class ThreadSummaryProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listThreads(): ThreadSummary[];
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
    },
  ) {
    registry.register(THREAD_SUMMARY_PROJECTION);
  }

  project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ThreadSummaryProjectionView>> {
    const thread = this.store.getThread(threadId);
    return this.registry.project({
      definition: THREAD_SUMMARY_PROJECTION,
      subjectId: threadId,
      seed: { thread },
      sourceIdentity: {
        id: thread.id,
        title: thread.title,
        agentId: thread.agentId,
        createdAt: thread.createdAt,
        goal: thread.goal ?? null,
      },
      sourceWatermark: thread.eventCount,
      loadEvents: async (afterSeq) =>
        (await this.store.listEvents(threadId, afterSeq)).filter(
          (event) => event.seq <= thread.eventCount,
        ),
    });
  }

  async listVisible(): Promise<ThreadSummary[]> {
    const receipts = await Promise.all(
      this.store.listThreads().map((thread) => this.project(thread.id)),
    );
    return receipts
      .filter((receipt) => receipt.view.visible)
      .map((receipt) => receipt.view.summary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

export const TASK_NARRATIVE_PROJECTION: KernelProjectionDefinition<
  { source: TaskNarrativeSource },
  TaskNarrativeEventState,
  TaskNarrativeEventState
> = {
  id: "task.narrative",
  version: 1,
  init: () => createTaskNarrativeEventState(),
  apply: applyTaskNarrativeEvent,
  view: (state) => structuredClone(state),
};

export class TaskNarrativeProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listAutomaticRecoveryAssessments(
        threadId: string,
      ): TaskNarrativeSource["automaticRecoveryAssessments"];
      listAutomaticRecoveryAttempts(
        threadId: string,
      ): TaskNarrativeSource["automaticRecoveryAttempts"];
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
      listPlans(threadId: string): TaskNarrativeSource["plans"];
      listRuns(threadId: string): TaskNarrativeSource["runs"];
    },
  ) {
    registry.register(TASK_NARRATIVE_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<TaskNarrativeProjection>> {
    const thread = this.store.getThread(threadId);
    const source: TaskNarrativeSource = {
      thread,
      runs: this.store.listRuns(threadId),
      plans: this.store.listPlans(threadId),
      automaticRecoveryAssessments:
        this.store.listAutomaticRecoveryAssessments(threadId),
      automaticRecoveryAttempts:
        this.store.listAutomaticRecoveryAttempts(threadId),
    };
    const receipt = await this.registry.project({
      definition: TASK_NARRATIVE_PROJECTION,
      subjectId: threadId,
      seed: { source },
      sourceIdentity: { id: thread.id, createdAt: thread.createdAt },
      sourceWatermark: thread.eventCount,
      loadEvents: async (afterSeq) =>
        (await this.store.listEvents(threadId, afterSeq)).filter(
          (event) => event.seq <= thread.eventCount,
        ),
    });
    return {
      ...receipt,
      view: taskNarrativeView(source, receipt.view),
    };
  }
}

function assertDefinition(
  definition: KernelProjectionDefinition<unknown, unknown, unknown>,
): void {
  if (
    !PROJECTION_ID.test(definition.id) ||
    !Number.isSafeInteger(definition.version) ||
    definition.version < 1
  ) {
    throw new Error("Kernel projection definition is invalid");
  }
}

function assertProjectionInput(input: {
  subjectId: string;
  sourceWatermark: number;
  initialWatermark?: number;
}): void {
  const initialWatermark = input.initialWatermark ?? 0;
  if (
    input.subjectId.length === 0 ||
    !Number.isSafeInteger(input.sourceWatermark) ||
    input.sourceWatermark < 0 ||
    !Number.isSafeInteger(initialWatermark) ||
    initialWatermark < 0 ||
    initialWatermark > input.sourceWatermark
  ) {
    throw new Error("Kernel projection input is invalid");
  }
}

function summaryFromThread(thread: ThreadRecord): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    agentId: thread.agentId,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessage: thread.lastMessage,
    eventCount: thread.eventCount,
    ...(thread.goal ? { goal: structuredClone(thread.goal) } : {}),
  };
}

function threadStatusProjection(
  event: RunEvent,
): Partial<Pick<ThreadSummary, "status">> {
  if (event.type === "run.started" || event.type === "run.recovery.started") {
    return eventPayloadString(event, "source") === "onboarding"
      ? {}
      : { status: "running" };
  }
  if (event.type === "run.failed") {
    return eventPayloadString(event, "outcome") === "paused_budget" ||
      eventPayloadString(event, "outcome") === "partial"
      ? { status: "idle" }
      : { status: "failed" };
  }
  if (
    event.type === "run.interrupted" ||
    event.type === "run.waiting_for_operator" ||
    event.type === "operator.decision.requested" ||
    event.type === "workflow.waiting" ||
    event.type === "workflow.paused"
  ) {
    return { status: "waiting" };
  }
  if (event.type === "workflow.blocked") return { status: "failed" };
  return event.type === "run.completed" ||
    event.type === "run.cancelled" ||
    event.type === "operator.decision.cancelled" ||
    event.type === "workflow.completed" ||
    event.type === "workflow.cancelled"
    ? { status: "idle" }
    : {};
}

function messagePreviewProjection(
  event: RunEvent,
): Partial<Pick<ThreadSummary, "lastMessage">> {
  if (
    (event.type !== "message.user" && event.type !== "message.assistant") ||
    event.category !== "message" ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return {};
  }
  const text = event.payload["text"];
  return typeof text === "string"
    ? { lastMessage: text.replace(/\s+/gu, " ").trim().slice(0, 180) }
    : {};
}

function eventPayloadString(event: RunEvent, key: string): string | undefined {
  return event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload) &&
    typeof event.payload[key] === "string"
    ? event.payload[key]
    : undefined;
}

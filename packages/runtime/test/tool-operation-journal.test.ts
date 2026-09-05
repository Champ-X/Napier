import type { RunEvent } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

import { projectRunFailureCircuits } from "../src/run-failure-circuit-projection.js";
import {
  DurableToolOperationJournal,
  TOOL_OPERATION_EVENT_TYPES,
  projectSettledToolOperationProgress,
  toolOperationSetLedgerProjection,
} from "../src/tool-operation-journal.js";
import type { WebSearchProvider } from "../src/web-search-providers.js";
import { WebSearchProviderRegistry } from "../src/web-search-providers.js";
import { normalizeWebSearchRequest } from "../src/web-search-model.js";
import { createWebSearchTool } from "../src/web-search-tool.js";
import {
  idempotentOperationDescriptor,
  memoryToolOperationStore as memoryStore,
  mutatingOperationDescriptor,
  operationDescriptor,
  operationEventField as field,
  toolOperationTestOwner as owner,
} from "./tool-operation-test-support.js";

describe("DurableToolOperationJournal", () => {
  it("fails fast when the store cannot append phases atomically", () => {
    const store = memoryStore([]);
    delete (store as Partial<ToolOperationJournalStore>)
      .appendEventOnceAtRunHead;

    expect(() => new DurableToolOperationJournal(store, owner)).toThrow(
      "requires atomic run-head conditional append support",
    );
  });

  it("replays the same deterministic lifecycle without duplicating events", async () => {
    const persisted: RunEvent[] = [];
    const firstStore = memoryStore(persisted);
    const first = new DurableToolOperationJournal(firstStore, owner);
    const descriptor = operationDescriptor();
    const operation = first.observer("call_replay").operation(descriptor);

    await operation.proposed();
    await operation.admit();
    await operation.started();
    await operation.settled({
      outcome: "succeeded",
      state: { revision: "stable" },
      effect: { records: 2 },
    });
    const before = await first.operationSet("call_replay");

    // A new store facade forces the journal to reconstruct state from the
    // durable event stream, like a process restart would.
    const replay = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
    )
      .observer("call_replay")
      .operation(descriptor);
    await replay.proposed();
    const replayDecision = await replay.admit();
    expect(replayDecision).toMatchObject({
      admitted: false,
      source: "replay",
      disposition: "terminal_replay",
      terminal: { outcome: "succeeded" },
    });
    await expect(replay.started()).rejects.toThrow(
      "without a current local execution grant",
    );
    const after = await new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
    ).operationSet("call_replay");

    expect(persisted).toHaveLength(4);
    expect(persisted.map((event) => event.type)).toEqual(
      TOOL_OPERATION_EVENT_TYPES.filter(
        (type) =>
          !type.startsWith("tool.operation.lease.") &&
          type !== "tool.operation.effect_indeterminate",
      ),
    );
    expect(after).toEqual(before);
    expect(operation.operationId).toBe(replay.operationId);
    expect(JSON.stringify(persisted)).not.toContain("private query text");
  });

  it("does not execute an exact replay while its first execution is in flight", async () => {
    const persisted: RunEvent[] = [];
    const first = new DurableToolOperationJournal(memoryStore(persisted), owner)
      .observer("call_in_flight")
      .operation(operationDescriptor());
    await first.proposed();
    expect(await first.admit()).toMatchObject({
      admitted: true,
      disposition: "execute",
    });

    const duplicate = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
    )
      .observer("call_in_flight")
      .operation(operationDescriptor());
    await duplicate.proposed();
    expect(await duplicate.admit()).toMatchObject({
      admitted: false,
      source: "replay",
      disposition: "in_flight_replay",
    });
    await first.started();
    expect(await duplicate.admit()).toMatchObject({
      admitted: false,
      source: "replay",
      disposition: "in_flight_replay",
    });
    await expect(duplicate.started()).rejects.toThrow(
      "without a current local execution grant",
    );
    expect(
      persisted.filter((event) => event.type === "tool.operation.started"),
    ).toHaveLength(1);
  });

  it("takes over an expired unstarted lease after restart and fences the old owner", async () => {
    const persisted: RunEvent[] = [];
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const first = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "worker-a", durationMs: 100 },
      },
    )
      .observer("call_crashed_before_start")
      .operation(operationDescriptor());
    expect(await first.admit()).toMatchObject({
      admitted: true,
      executionLease: { generation: 1, disposition: "initial" },
    });

    now += 100;
    const recovered = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "worker-b", durationMs: 100 },
      },
    )
      .observer("call_crashed_before_start")
      .operation(operationDescriptor());
    expect(await recovered.admit()).toMatchObject({
      admitted: true,
      disposition: "execute",
      executionLease: {
        generation: 2,
        previousGeneration: 1,
        disposition: "unstarted_takeover",
      },
    });
    await expect(first.started()).rejects.toThrow("was fenced");
    await recovered.started();
    await recovered.settled({ outcome: "succeeded", state: "recovered" });

    expect(
      persisted.filter(
        (event) => event.type === "tool.operation.lease.granted",
      ),
    ).toHaveLength(1);
  });

  it("selects one winner when expired takeover claims race", async () => {
    const persisted: RunEvent[] = [];
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const crashed = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "crashed", durationMs: 100 },
      },
    )
      .observer("call_racing_takeover")
      .operation(operationDescriptor());
    await crashed.admit();
    now += 100;

    const contender = (ownerId: string) =>
      new DurableToolOperationJournal(memoryStore(persisted), owner, {
        now: () => now,
        executionLease: { ownerId, durationMs: 100 },
      })
        .observer("call_racing_takeover")
        .operation(operationDescriptor());
    const decisions = await Promise.all([
      contender("contender-left").admit(),
      contender("contender-right").admit(),
    ]);
    expect(decisions.filter((decision) => decision.admitted)).toHaveLength(1);
    expect(
      decisions.filter(
        (decision) => decision.disposition === "in_flight_replay",
      ),
    ).toHaveLength(1);
  });

  it("takes over an expired started read-like operation and rejects its late terminal", async () => {
    const persisted: RunEvent[] = [];
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const first = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "reader-a", durationMs: 100 },
      },
    )
      .observer("call_safe_started_takeover")
      .operation(idempotentOperationDescriptor());
    await first.admit();
    await first.started();

    now += 100;
    const recovered = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "reader-b", durationMs: 100 },
      },
    )
      .observer("call_safe_started_takeover")
      .operation(idempotentOperationDescriptor());
    expect(await recovered.admit()).toMatchObject({
      admitted: true,
      executionLease: {
        generation: 2,
        disposition: "safe_started_takeover",
      },
    });
    await expect(
      first.settled({ outcome: "succeeded", state: "late-old-result" }),
    ).rejects.toThrow("was fenced");
    await recovered.started();
    await recovered.settled({ outcome: "succeeded", state: "fresh-result" });

    expect(
      persisted.filter((event) => event.type === "tool.operation.started"),
    ).toHaveLength(2);
  });

  it("does not infer started replay safety from an acquire progress label", async () => {
    const persisted: RunEvent[] = [];
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const first = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "opaque-acquire-a", durationMs: 100 },
      },
    )
      .observer("call_opaque_started_acquire")
      .operation(operationDescriptor());
    await first.admit();
    await first.started();

    now += 100;
    const replay = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "opaque-acquire-b", durationMs: 100 },
      },
    )
      .observer("call_opaque_started_acquire")
      .operation(operationDescriptor());
    expect(await replay.admit()).toMatchObject({
      admitted: false,
      disposition: "indeterminate_replay",
    });
    await expect(
      first.settled({ outcome: "succeeded", state: "original-finished" }),
    ).rejects.toThrow("expired before settlement");
  });

  it("keeps a healthy long-running execution fenced in through durable renewal", async () => {
    const persisted: RunEvent[] = [];
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const active = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "healthy-reader", durationMs: 100 },
      },
    )
      .observer("call_healthy_long_read")
      .operation(operationDescriptor());
    await active.admit();
    await active.started();

    now += 60;
    await active.heartbeat?.();
    now += 60;
    const duplicate = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "duplicate-reader", durationMs: 100 },
      },
    )
      .observer("call_healthy_long_read")
      .operation(operationDescriptor());
    expect(await duplicate.admit()).toMatchObject({
      admitted: false,
      disposition: "in_flight_replay",
      executionLease: { generation: 1, disposition: "renewal" },
    });
    expect(
      persisted.filter(
        (event) => event.type === "tool.operation.lease.renewed",
      ),
    ).toHaveLength(1);
    await active.settled({ outcome: "succeeded", state: "healthy-result" });
  });

  it("fails closed when an expired started mutation has an indeterminate effect", async () => {
    const persisted: RunEvent[] = [];
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const first = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "writer-a", durationMs: 100 },
      },
    )
      .observer("call_mutation_started")
      .operation(mutatingOperationDescriptor());
    await first.admit();
    await first.started();

    now += 100;
    const replay = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      {
        now: () => now,
        executionLease: { ownerId: "writer-b", durationMs: 100 },
      },
    )
      .observer("call_mutation_started")
      .operation(mutatingOperationDescriptor());
    expect(await replay.admit()).toMatchObject({
      admitted: false,
      source: "replay",
      disposition: "indeterminate_replay",
    });
    expect(
      persisted.filter(
        (event) => event.type === "tool.operation.lease.granted",
      ),
    ).toHaveLength(0);
    await expect(
      first.settled({ outcome: "succeeded", state: "writer-finished" }),
    ).rejects.toThrow("expired before settlement");
  });

  it("incrementally refreshes a cached read model after another facade writes", async () => {
    const persisted: RunEvent[] = [];
    const reader = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
    );
    expect(await reader.operationSet("call_refresh")).toMatchObject({
      operationCount: 0,
    });

    const writerOperation = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
    )
      .observer("call_refresh")
      .operation(operationDescriptor());
    await writerOperation.proposed();
    await writerOperation.admit();
    await writerOperation.started();
    await writerOperation.settled({ outcome: "succeeded", state: "fresh" });

    expect(await reader.operationSet("call_refresh")).toMatchObject({
      operationCount: 1,
      settledOperationCount: 1,
    });
  });

  it("refreshes admission state before granting execution to a cached facade", async () => {
    const persisted: RunEvent[] = [];
    const cached = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
    )
      .observer("call_refresh_admission")
      .operation(operationDescriptor());
    await cached.proposed();

    const winner = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
    )
      .observer("call_refresh_admission")
      .operation(operationDescriptor());
    expect(await winner.admit()).toMatchObject({
      admitted: true,
      disposition: "execute",
    });

    expect(await cached.admit()).toMatchObject({
      admitted: false,
      source: "replay",
      disposition: "in_flight_replay",
    });
    await expect(cached.started()).rejects.toThrow(
      "without a current local execution grant",
    );
  });

  it("enforces admitted execution and rejected skip state transitions", async () => {
    const persisted: RunEvent[] = [];
    const journal = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
    );
    const admitted = journal
      .observer("call_transition_admitted")
      .operation(operationDescriptor());
    await admitted.proposed();
    await admitted.admit();
    await expect(
      admitted.settled({ outcome: "succeeded", state: "too-early" }),
    ).rejects.toThrow("settled requires started");

    const rejected = journal
      .observer("call_transition_rejected")
      .operation(operationDescriptor());
    await rejected.proposed();
    await rejected.admit({ admitted: false, diagnostic: "not available" });
    await expect(rejected.started()).rejects.toThrow(
      "without a current local execution grant",
    );
    await expect(
      rejected.settled({ outcome: "failed", diagnostic: "must not execute" }),
    ).rejects.toThrow("may only settle as skipped");
    await rejected.settled({ outcome: "skipped", diagnostic: "not available" });

    const unadmitted = journal
      .observer("call_transition_unadmitted")
      .operation(operationDescriptor());
    await unadmitted.proposed();
    await expect(unadmitted.settled({ outcome: "skipped" })).rejects.toThrow(
      "without durable admission",
    );
  });

  it("does not reuse an incomplete admission from an earlier control epoch", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryStore(persisted);
    const journal = new DurableToolOperationJournal(store, owner);
    const first = journal
      .observer("call_same_epoch_binding")
      .operation(operationDescriptor());
    await first.proposed();
    await first.admit();
    await store.appendEvent({
      threadId: owner.threadId,
      runId: owner.runId,
      type: "run.control.delivered",
      category: "message",
      visibility: "user",
      payload: { controlMessageId: "control_replay_epoch" },
    });

    const replay = journal
      .observer("call_same_epoch_binding")
      .operation(operationDescriptor());
    expect(await replay.admit()).toMatchObject({
      admitted: false,
      source: "replay",
      disposition: "stale_epoch_replay",
    });
    await expect(first.started()).rejects.toThrow(
      "without a current local execution grant",
    );
  });

  it("journals provider A failure and provider B success under one parent result", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryStore(persisted);
    const failedSearch = vi
      .fn<WebSearchProvider["search"]>()
      .mockRejectedValue(
        Object.assign(new Error("连接已重置"), { code: "ECONNRESET" }),
      );
    const successfulSearch = vi
      .fn<WebSearchProvider["search"]>()
      .mockResolvedValue([
        {
          title: "Primary result",
          url: "https://example.com/result",
          source: "Fixture",
        },
      ]);
    const registry = new WebSearchProviderRegistry({
      providers: [
        provider("firecrawl", failedSearch),
        provider("brave", successfulSearch),
      ],
      now: () => new Date("2026-09-03T12:00:00.000Z"),
    });
    const tool = createWebSearchTool(registry, { store, owner });

    const result = await tool.execute("call_fallback", {
      query: "private query text",
    });
    const details = result.details as Record<string, unknown>;
    const operationEvents = persisted.filter((event) =>
      event.type.startsWith("tool.operation."),
    );
    const settled = operationEvents.filter(
      (event) => event.type === "tool.operation.settled",
    );
    const topLevel = await toolOperationSetLedgerProjection(
      store,
      owner,
      "call_fallback",
    );

    expect(failedSearch).toHaveBeenCalledOnce();
    expect(successfulSearch).toHaveBeenCalledOnce();
    expect(operationEvents.map((event) => event.type)).toEqual([
      "tool.operation.proposed",
      "tool.operation.admitted",
      "tool.operation.started",
      "tool.operation.settled",
      "tool.operation.proposed",
      "tool.operation.admitted",
      "tool.operation.started",
      "tool.operation.settled",
    ]);
    expect(settled.map((event) => field(event, "outcome"))).toEqual([
      "failed",
      "succeeded",
    ]);
    expect(field(settled[0]!, "failure")).toEqual(
      expect.objectContaining({
        kind: "napier.tool-failure-semantics",
        coverage: "trusted_declared",
        modeId: "route_network",
        class: "network",
        disposition: "alternate_route",
        failureDefinitionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        bindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      new Set(operationEvents.map((event) => field(event, "operationId"))).size,
    ).toBe(2);
    expect(details["operationCount"]).toBe(2);
    expect(details["settledOperationCount"]).toBe(2);
    expect(details["operationSetSha256"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(topLevel["operationSetSha256"]).toBe(details["operationSetSha256"]);
    const progress = projectSettledToolOperationProgress(operationEvents);
    expect(progress.suppressParentSingletonCallIds).toEqual(["call_fallback"]);
    expect(progress.observations).toHaveLength(2);
    expect(progress.observations[0]).toEqual(
      expect.objectContaining({
        admission: "admitted",
        outcome: "failed",
        acquisitionAttempt: true,
        acquisitionAdvance: false,
        failureObserved: true,
        acquisitionFailure: true,
        failure: expect.objectContaining({ class: "network" }),
      }),
    );
    expect(progress.observations[1]).toEqual(
      expect.objectContaining({
        admission: "admitted",
        outcome: "succeeded",
        acquisitionAttempt: true,
        acquisitionAdvance: true,
        failureObserved: false,
        acquisitionFailure: false,
      }),
    );
    expect(progress.observationSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(operationEvents)).not.toContain("private query text");
  });

  it("rejects an open provider binding without an attempt and continues to a legal route", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryStore(persisted);
    const failedSearch = vi
      .fn<WebSearchProvider["search"]>()
      .mockRejectedValue(
        Object.assign(new Error("连接已重置"), { code: "ECONNRESET" }),
      );
    const successfulSearch = vi
      .fn<WebSearchProvider["search"]>()
      .mockResolvedValue([
        {
          title: "Fallback result",
          url: "https://example.com/result",
          source: "Fixture",
        },
      ]);
    const registry = new WebSearchProviderRegistry({
      providers: [
        provider("firecrawl", failedSearch),
        provider("brave", successfulSearch),
      ],
    });
    const journal = new DurableToolOperationJournal(store, owner, {
      failureCircuit: { policy: { thresholds: { origin: 1 } } },
      now: () => Date.parse("2026-09-03T12:00:01.000Z"),
    });
    const request = normalizeWebSearchRequest({ query: "private query text" });

    await registry.search(
      request,
      new AbortController().signal,
      journal.observer("call_first"),
    );
    await registry.search(
      request,
      new AbortController().signal,
      journal.observer("call_second"),
    );

    expect(failedSearch).toHaveBeenCalledOnce();
    expect(successfulSearch).toHaveBeenCalledTimes(2);
    const rejected = persisted.find(
      (event) =>
        event.type === "tool.operation.admitted" &&
        field(event, "parentCallId") === "call_second" &&
        field(event, "route") === "firecrawl",
    );
    expect(rejected).toBeDefined();
    expect(field(rejected!, "admission")).toBe("rejected");
    expect(field(rejected!, "admissionSource")).toBe("failure_circuit");
    expect(field(rejected!, "circuitScope")).toBe("route");
    expect(field(rejected!, "circuitThroughSeq")).toEqual(expect.any(Number));
    expect(field(rejected!, "circuitAsOfMs")).toBe(
      Date.parse("2026-09-03T12:00:01.000Z"),
    );
    const progress = projectSettledToolOperationProgress(persisted);
    expect(
      progress.observations.find(
        (observation) =>
          observation.parentCallId === "call_second" &&
          observation.route === "firecrawl",
      ),
    ).toEqual(
      expect.objectContaining({
        admission: "rejected",
        admissionSource: "failure_circuit",
        outcome: "skipped",
        acquisitionAttempt: false,
        acquisitionFailure: false,
        failureObserved: false,
      }),
    );
    expect(
      projectRunFailureCircuits(persisted, owner.runId, {
        policy: { thresholds: { origin: 1 } },
      }).entries.find((entry) => entry.scope === "route"),
    ).toMatchObject({ failureCount: 1, lifetimeFailureCount: 1 });
  });

  it("allows a half-open probe after retry TTL and closes the circuit on success", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryStore(persisted);
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const journal = new DurableToolOperationJournal(store, owner, {
      now: () => now,
    });
    const first = journal
      .observer("call_rate_limited")
      .operation(operationDescriptor());
    await first.proposed();
    await first.admit();
    await first.started();
    await first.settled({
      outcome: "failed",
      diagnostic: "HTTP 429 rate limited",
    });

    now += 29_999;
    const blocked = journal
      .observer("call_before_ttl")
      .operation(operationDescriptor());
    await blocked.proposed();
    expect(await blocked.admit()).toMatchObject({
      admitted: false,
      source: "failure_circuit",
      circuit: { scope: "route", status: "open", retryAfterMs: 1 },
    });

    now += 1;
    const probe = journal
      .observer("call_after_ttl")
      .operation(operationDescriptor());
    await probe.proposed();
    expect(await probe.admit()).toMatchObject({
      admitted: true,
      source: "caller",
    });
    await probe.started();
    await probe.settled({ outcome: "succeeded", state: "recovered" });
  });

  it("does not let an execution authority consume its internal half-open probe", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryStore(persisted);
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const journal = new DurableToolOperationJournal(store, owner, {
      now: () => now,
    });
    const failed = journal
      .observer("call_rate_limited_parent")
      .operation(operationDescriptor());
    await failed.admit();
    await failed.started();
    await failed.settled({
      outcome: "failed",
      diagnostic: "HTTP 429 rate limited",
    });

    now += 30_000;
    const observer = journal.observer("call_half_open_parent");
    const authority = observer.operation({
      ...operationDescriptor(),
      role: "execution_authority",
    });
    const child = observer.operation(operationDescriptor());
    expect(await authority.admit()).toMatchObject({
      admitted: true,
      disposition: "execute",
    });
    expect(await child.admit()).toMatchObject({
      admitted: true,
      disposition: "execute",
    });
    const authorityAdmission = persisted.find(
      (event) =>
        event.type === "tool.operation.admitted" &&
        field(event, "operationId") === authority.operationId,
    );
    const childAdmission = persisted.find(
      (event) =>
        event.type === "tool.operation.admitted" &&
        field(event, "operationId") === child.operationId,
    );
    expect(field(authorityAdmission!, "circuitProbeKeySha256")).toBeUndefined();
    expect(field(childAdmission!, "circuitProbeKeySha256")).toEqual(
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    );
    await authority.started();
    await authority.settled({ outcome: "succeeded", state: "authority" });
    await child.started();
    await child.settled({ outcome: "succeeded", state: "recovered" });
  });

  it("grants one durable execution lease for concurrent half-open probes", async () => {
    const persisted: RunEvent[] = [];
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const firstStore = memoryStore(persisted);
    const journal = new DurableToolOperationJournal(firstStore, owner, {
      now: () => now,
    });
    const failure = journal
      .observer("call_probe_failure")
      .operation(operationDescriptor());
    await failure.proposed();
    await failure.admit();
    await failure.started();
    await failure.settled({
      outcome: "failed",
      diagnostic: "HTTP 429 rate limited",
    });

    now += 30_000;
    const left = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      { now: () => now },
    )
      .observer("call_probe_left")
      .operation(operationDescriptor());
    const right = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      { now: () => now },
    )
      .observer("call_probe_right")
      .operation(operationDescriptor());
    await Promise.all([left.proposed(), right.proposed()]);
    const decisions = await Promise.all([left.admit(), right.admit()]);

    expect(decisions.filter((decision) => decision.admitted)).toHaveLength(1);
    expect(
      decisions.filter(
        (decision) =>
          !decision.admitted && decision.source === "failure_circuit",
      ),
    ).toHaveLength(1);
    expect(
      persisted.filter(
        (event) =>
          event.type === "tool.operation.admitted" &&
          field(event, "circuitProbeKeySha256") !== undefined,
      ),
    ).toHaveLength(1);
  });

  it("releases a crashed half-open probe after its durable lease expires", async () => {
    const persisted: RunEvent[] = [];
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const options = (ownerId: string) => ({
      now: () => now,
      executionLease: { ownerId, durationMs: 100 },
    });
    const failed = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      options("failure-worker"),
    )
      .observer("call_probe_lease_failure")
      .operation(operationDescriptor());
    await failed.admit();
    await failed.started();
    await failed.settled({
      outcome: "failed",
      diagnostic: "HTTP 429 rate limited",
    });

    now += 30_000;
    const crashedProbe = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      options("probe-worker-a"),
    )
      .observer("call_probe_lease_crash")
      .operation(idempotentOperationDescriptor());
    expect(await crashedProbe.admit()).toMatchObject({ admitted: true });
    await crashedProbe.started();

    now += 100;
    const recoveredProbe = new DurableToolOperationJournal(
      memoryStore(persisted),
      owner,
      options("probe-worker-b"),
    )
      .observer("call_probe_lease_recovered")
      .operation(idempotentOperationDescriptor());
    expect(await recoveredProbe.admit()).toMatchObject({
      admitted: true,
      disposition: "execute",
    });
    await recoveredProbe.started();
    await expect(
      crashedProbe.settled({ outcome: "succeeded", state: "late-probe" }),
    ).rejects.toThrow("half-open probe authority was superseded");
    await recoveredProbe.settled({ outcome: "succeeded", state: "recovered" });
  });

  it("reopens exact child-operation admission after an operator epoch", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryStore(persisted);
    const journal = new DurableToolOperationJournal(store, owner, {
      failureCircuit: { policy: { thresholds: { origin: 1 } } },
    });
    const failed = journal
      .observer("call_failed_epoch")
      .operation(operationDescriptor());
    await failed.proposed();
    await failed.admit();
    await failed.started();
    await failed.settled({
      outcome: "failed",
      diagnostic: "network connection reset",
    });
    await store.appendEvent({
      threadId: owner.threadId,
      runId: owner.runId,
      type: "run.control.delivered",
      category: "message",
      visibility: "user",
      payload: { controlMessageId: "control_new_epoch" },
    });

    const afterEpoch = journal
      .observer("call_after_epoch")
      .operation(operationDescriptor());
    await afterEpoch.proposed();
    expect(await afterEpoch.admit()).toMatchObject({
      admitted: true,
      source: "caller",
    });
  });

  it("settles a started generation after a control epoch advances", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryStore(persisted);
    const operation = new DurableToolOperationJournal(store, owner)
      .observer("call_started_before_control")
      .operation(operationDescriptor());
    await operation.admit();
    await operation.started();
    await store.appendEvent({
      threadId: owner.threadId,
      runId: owner.runId,
      type: "run.control.delivered",
      category: "message",
      visibility: "user",
      payload: { controlMessageId: "control_after_start" },
    });

    await expect(
      operation.settled({ outcome: "succeeded", state: "committed" }),
    ).resolves.toBeUndefined();
    expect(
      persisted.filter(
        (event) =>
          event.type === "tool.operation.settled" &&
          field(event, "operationId") === operation.operationId,
      ),
    ).toHaveLength(1);
  });
});

function provider(
  id: "firecrawl" | "brave",
  search: WebSearchProvider["search"],
): WebSearchProvider {
  return {
    id,
    supportsImages: true,
    available: () => true,
    search,
  };
}

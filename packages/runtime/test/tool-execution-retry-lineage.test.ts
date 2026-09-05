import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import { claimDurableToolExecution } from "../src/durable-tool-execution.js";
import { createOwnedToolRecordV2 } from "../src/owned-tool-protocol.js";
import { LocalStore } from "../src/store.js";
import {
  defineToolFailureSemantics,
  toolFailureSemantics,
} from "../src/tool-failure-semantics.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import {
  executeAdmittedToolCall,
  ToolExecutionRetryLineageError,
} from "../src/tool-execution-admission-service.js";
import {
  bindToolExecutionRetryLineage,
  toolExecutionRetryLineagePayload,
} from "../src/tool-execution-retry-lineage.js";
import { defineReplayableTestReadTool } from "./self-describing-tool-test-support.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("tool execution retry lineage", () => {
  it("persists tool-owned failure semantics at the common raw execution boundary", async () => {
    class RegionalFailure extends Error {
      readonly code = "REGION_DOWN";
    }
    const fixture = await createFixture("typed-raw-failure");
    const raw = defineToolFailureSemantics(
      tool("arbitrary_localized_tool", async () => {
        throw new RegionalFailure("区域服务当前不可用");
      }),
      {
        schemaVersion: 1,
        classificationVersion: "1.0.0",
        modes: [
          {
            modeId: "regional_outage",
            class: "network",
            scope: "route",
            disposition: "alternate_route",
            fatalToSession: false,
          },
        ],
        resolve(input, failure) {
          if (
            !(failure instanceof RegionalFailure) ||
            failure.code !== "REGION_DOWN"
          ) {
            throw new Error("missing structured code");
          }
          return {
            semantics: toolFailureSemantics({
              class: "network",
              scope: "route",
              disposition: "alternate_route",
              fatalToSession: false,
            }),
            bindingKey: { route: (input as { value?: string }).value },
          };
        },
      },
    );

    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        callId: "call_localized_failure",
        attempt: 1,
        lineage: { route: "cn-north" },
        args: { value: "cn-north" },
        settleThrownAsResult: true,
      }),
    ).rejects.toThrow("区域服务当前不可用");
    const events = await fixture.store.listRunEvents(fixture.firstRun.id);
    const failed = events.find(
      (event) =>
        event.type === "tool.operation.settled" &&
        event.payload["outcome"] === "failed",
    );
    expect(failed?.payload["failure"]).toMatchObject({
      coverage: "trusted_declared",
      modeId: "regional_outage",
      class: "network",
      scope: "route",
    });
    expect(failed?.payload["failureDefinitionSha256"]).toBe(
      record(failed?.payload["failure"])?.["failureDefinitionSha256"],
    );
  });

  it("allows a new Run after the prior attempt never started", async () => {
    const fixture = await createFixture("before-start");
    let executions = 0;
    const raw = tool("apply_patch", async () => {
      executions += 1;
      return result("executed");
    });

    await admitWithoutStart(fixture.store, fixture.firstRun, raw, {
      callId: "call_before_start_1",
      attempt: 1,
      lineage: { work: "same" },
    });
    const restarted = await restart(fixture);
    const secondRun = await createRun(restarted, fixture.threadId);

    await expect(
      execute(restarted, secondRun, raw, {
        callId: "call_before_start_2",
        attempt: 2,
        lineage: { work: "same" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        replayed: false,
        value: expect.objectContaining({ details: { value: "executed" } }),
      }),
    );
    expect(executions).toBe(1);
  });

  it("rejects a new Run after a started call reports a partial-effect failure", async () => {
    const fixture = await createFixture("started-failure");
    let executions = 0;
    const raw = tool("apply_patch", async () => {
      executions += 1;
      throw new Error("write happened before provider failure");
    });

    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        callId: "call_partial_1",
        attempt: 1,
        lineage: { work: "partial" },
      }),
    ).rejects.toThrow("write happened before provider failure");
    const restarted = await restart(fixture);
    const secondRun = await createRun(restarted, fixture.threadId);

    await expect(
      execute(restarted, secondRun, raw, {
        callId: "call_partial_2",
        attempt: 2,
        lineage: { work: "partial" },
      }),
    ).rejects.toEqual(
      expect.objectContaining<ToolExecutionRetryLineageError>({
        name: "ToolExecutionRetryLineageError",
        code: "TOOL_EXECUTION_RETRY_LINEAGE_REJECTED",
        reason: "prior_execution_started",
      }),
    );
    expect(executions).toBe(1);
    expect(
      (await restarted.listRunEvents(secondRun.id)).find(
        (event) => event.type === "tool.blocked",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        errorCode: "TOOL_EXECUTION_RETRY_LINEAGE_REJECTED",
        reason: "prior_execution_started",
        priorStarted: true,
        priorEffectBoundary: true,
        priorOutcome: "failed",
      }),
    );
  });

  it("isolates distinct logical inputs while preserving attempt ordering", async () => {
    const fixture = await createFixture("isolated-input");
    const counts = new Map<string, number>();
    const raw = tool("apply_patch", async (args) => {
      const value = String((args as { value: string }).value);
      counts.set(value, (counts.get(value) ?? 0) + 1);
      if (value === "first") throw new Error("first input partially failed");
      return result(value);
    });

    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        callId: "call_isolated_1",
        attempt: 1,
        args: { value: "first" },
        lineage: { inputSha256: "a".repeat(64) },
      }),
    ).rejects.toThrow("first input partially failed");
    const restarted = await restart(fixture);
    const secondRun = await createRun(restarted, fixture.threadId);

    await expect(
      execute(restarted, secondRun, raw, {
        callId: "call_isolated_2",
        attempt: 1,
        args: { value: "second" },
        lineage: { inputSha256: "b".repeat(64) },
      }),
    ).resolves.toEqual(expect.objectContaining({ replayed: false }));
    expect(Object.fromEntries(counts)).toEqual({ first: 1, second: 1 });
  });

  it("uses a surface budget for three durable failures of a declared read", async () => {
    const fixture = await createFixture("read-third-attempt");
    let executions = 0;
    const raw = defineReplayableTestReadTool(
      tool("web_search", async () => {
        executions += 1;
        if (executions < 3)
          throw new Error(`transient read ${String(executions)}`);
        return result("third attempt completed");
      }),
    );
    const options = {
      lineage: { workflowNode: "read" },
      maxAttempts: 3,
    };

    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        ...options,
        callId: "call_read_1",
        attempt: 1,
      }),
    ).rejects.toThrow("transient read 1");
    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        ...options,
        callId: "call_read_2",
        attempt: 2,
      }),
    ).rejects.toThrow("transient read 2");
    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        ...options,
        callId: "call_read_3",
        attempt: 3,
      }),
    ).resolves.toEqual(expect.objectContaining({ replayed: false }));

    expect(executions).toBe(3);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.filter(
        (event) =>
          event.type === "tool.operation.lease.renewed" &&
          record(event.payload)?.["executionEffectBoundary"] === true,
      ),
    ).toHaveLength(0);
  });

  it("rejects duplicate, skipped and exhausted surface attempts", async () => {
    const fixture = await createFixture("attempt-order");
    const raw = tool("apply_patch", async () => result("unexpected"));
    const common = {
      lineage: { work: "ordered" },
      maxAttempts: 3,
    };
    await admitWithoutStart(fixture.store, fixture.firstRun, raw, {
      ...common,
      callId: "call_order_1",
      attempt: 1,
    });

    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        ...common,
        callId: "call_order_duplicate",
        attempt: 1,
      }),
    ).rejects.toEqual(
      expect.objectContaining<ToolExecutionRetryLineageError>({
        reason: "duplicate_attempt",
      }),
    );
    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        ...common,
        callId: "call_order_3",
        attempt: 3,
      }),
    ).rejects.toEqual(
      expect.objectContaining<ToolExecutionRetryLineageError>({
        reason: "non_contiguous_attempt",
      }),
    );
    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        ...common,
        callId: "call_order_4",
        attempt: 4,
      }),
    ).rejects.toEqual(
      expect.objectContaining<ToolExecutionRetryLineageError>({
        reason: "attempt_limit_exhausted",
      }),
    );
  });

  it("allows an expired started read lease takeover without an effect boundary", async () => {
    const fixture = await createFixture("read-takeover");
    const raw = defineReplayableTestReadTool(
      tool("read_file", async () => result("read")),
    );
    const protocol = createOwnedToolRecordV2(raw);
    let now = 1_000;
    const claim = (ownerId: string) =>
      claimDurableToolExecution({
        store: fixture.store,
        run: fixture.firstRun,
        callId: "call_read_takeover",
        toolName: raw.name,
        args: { value: "fixture" },
        protocol,
        journalOptions: {
          executionLease: { ownerId, durationMs: 10 },
          now: () => now,
        },
      });
    const crashed = await claim("read-owner-1");
    await crashed.start({});
    now = 10_000;

    const takeover = await claim("read-owner-2");
    await takeover.start({});
    await takeover.settleResult(result("read"));

    const events = await fixture.store.listRunEvents(fixture.firstRun.id);
    expect(
      events.find(
        (event) =>
          event.type === "tool.operation.lease.granted" &&
          record(event.payload)?.["executionLeaseDisposition"] ===
            "safe_started_takeover",
      ),
    ).toBeDefined();
    expect(
      events.some(
        (event) =>
          event.type === "tool.operation.lease.renewed" &&
          record(event.payload)?.["executionEffectBoundary"] === true,
      ),
    ).toBe(false);
  });

  it("keeps an unresolved write effect boundary indeterminate", async () => {
    const fixture = await createFixture("write-indeterminate");
    const raw = tool("apply_patch", async () => result("must not run"));
    await admitAtEffectBoundary(fixture.store, fixture.firstRun, raw, {
      callId: "call_write_boundary_1",
      attempt: 1,
      lineage: { work: "write boundary" },
      maxAttempts: 2,
    });
    await expect(
      execute(fixture.store, fixture.firstRun, raw, {
        callId: "call_write_boundary_2",
        attempt: 2,
        lineage: { work: "write boundary" },
      }),
    ).rejects.toEqual(
      expect.objectContaining<ToolExecutionRetryLineageError>({
        reason: "prior_effect_indeterminate",
      }),
    );
  });

  it("replays an exact terminal result without invoking the raw tool", async () => {
    const fixture = await createFixture("exact-replay");
    let executions = 0;
    const captured = result("captured");
    const raw = defineReplayableTestReadTool(
      tool("read_file", async () => {
        executions += 1;
        return captured;
      }),
    );

    await execute(fixture.store, fixture.firstRun, raw, {
      callId: "call_replay_1",
      attempt: 1,
      lineage: { read: "same snapshot" },
    });
    const restarted = await restart(fixture);
    const secondRun = await createRun(restarted, fixture.threadId);
    const replayed = await execute(restarted, secondRun, raw, {
      callId: "call_replay_2",
      attempt: 2,
      lineage: { read: "same snapshot" },
      replay: () => ({ value: captured }),
    });

    expect(replayed).toEqual({ value: captured, replayed: true });
    expect(executions).toBe(1);
    expect(
      (await restarted.listRunEvents(secondRun.id)).map((event) => event.type),
    ).toContain("tool.result_reused");
  });

  it("rejects a replay value that does not match the prior terminal effect", async () => {
    const fixture = await createFixture("replay-mismatch");
    let executions = 0;
    const raw = defineReplayableTestReadTool(
      tool("read_file", async () => {
        executions += 1;
        return result("captured");
      }),
    );
    await execute(fixture.store, fixture.firstRun, raw, {
      callId: "call_replay_mismatch_1",
      attempt: 1,
      lineage: { read: "same snapshot" },
    });
    const restarted = await restart(fixture);
    const secondRun = await createRun(restarted, fixture.threadId);

    await expect(
      execute(restarted, secondRun, raw, {
        callId: "call_replay_mismatch_2",
        attempt: 2,
        lineage: { read: "same snapshot" },
        replay: () => ({ value: result("different") }),
      }),
    ).rejects.toEqual(
      expect.objectContaining<ToolExecutionRetryLineageError>({
        reason: "replay_evidence_mismatch",
      }),
    );
    expect(executions).toBe(1);
  });
});

async function execute(
  store: LocalStore,
  run: Awaited<ReturnType<typeof createRun>>,
  raw: AgentTool,
  options: {
    callId: string;
    attempt: number;
    lineage: unknown;
    args?: unknown;
    replay?: () => { value: AgentToolResult<unknown> };
    maxAttempts?: number;
    settleThrownAsResult?: boolean;
  },
) {
  const args = options.args ?? { value: "fixture" };
  return executeAdmittedToolCall({
    store,
    run,
    callId: options.callId,
    toolName: raw.name,
    args,
    protocol: createOwnedToolRecordV2(raw),
    concurrencyGate: gate(store, options.callId),
    retryLineage: {
      namespace: "test.logical-work",
      binding: options.lineage,
      attempt: options.attempt,
      maxAttempts: options.maxAttempts ?? 2,
    },
    startedPayload: {},
    ...(options.replay ? { retryLineageReplay: options.replay } : {}),
    execute: () => raw.execute(options.callId, args as never),
    settlement: (value) => ({ result: value, isError: false }),
    ...(options.settleThrownAsResult
      ? {
          failureSettlement: () => ({
            result: result("localized failure"),
            isError: true,
          }),
        }
      : {}),
  });
}

async function admitWithoutStart(
  store: LocalStore,
  run: Awaited<ReturnType<typeof createRun>>,
  raw: AgentTool,
  options: {
    callId: string;
    attempt: number;
    lineage: unknown;
    args?: unknown;
    maxAttempts?: number;
  },
): Promise<void> {
  const args = options.args ?? { value: "fixture" };
  const protocol = createOwnedToolRecordV2(raw);
  const binding = bindToolExecutionRetryLineage(
    {
      namespace: "test.logical-work",
      binding: options.lineage,
      attempt: options.attempt,
      maxAttempts: options.maxAttempts ?? 2,
    },
    protocol.invocation(args),
    args,
  );
  await claimDurableToolExecution({
    store,
    run,
    callId: options.callId,
    toolName: raw.name,
    args,
    protocol,
    admissionPayload: {
      executionRetryLineage: toolExecutionRetryLineagePayload(binding),
    },
  });
}

async function admitAtEffectBoundary(
  store: LocalStore,
  run: Awaited<ReturnType<typeof createRun>>,
  raw: AgentTool,
  options: {
    callId: string;
    attempt: number;
    lineage: unknown;
    maxAttempts: number;
  },
): Promise<void> {
  const args = { value: "fixture" };
  const protocol = createOwnedToolRecordV2(raw);
  const binding = bindToolExecutionRetryLineage(
    {
      namespace: "test.logical-work",
      binding: options.lineage,
      attempt: options.attempt,
      maxAttempts: options.maxAttempts,
    },
    protocol.invocation(args),
    args,
  );
  const lease = await claimDurableToolExecution({
    store,
    run,
    callId: options.callId,
    toolName: raw.name,
    args,
    protocol,
    admissionPayload: {
      executionRetryLineage: toolExecutionRetryLineagePayload(binding),
    },
  });
  await lease.start({});
  await lease.effectBoundary();
}

function tool(
  name: string,
  operation: (args: unknown) => Promise<AgentToolResult<unknown>>,
): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({ value: Type.Optional(Type.String()) }),
    execute: async (_callId, args) => operation(args),
  };
}

function result(value: string): AgentToolResult<{ value: string }> {
  return {
    content: [{ type: "text", text: value }],
    details: { value },
  };
}

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-lineage-${label}-`));
  roots.push(root);
  const store = await openStore(root);
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({ title: label, agentId });
  const firstRun = await createRun(store, thread.id);
  return { root, store, threadId: thread.id, firstRun };
}

async function restart(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<LocalStore> {
  fixture.store.close();
  stores.splice(stores.indexOf(fixture.store), 1);
  return openStore(fixture.root, true);
}

async function openStore(root: string, interruptActiveRuns = false) {
  const store = new LocalStore({
    workspaceRoot: root,
    dataRoot: path.join(root, "state"),
  });
  stores.push(store);
  await store.initialize(interruptActiveRuns);
  return store;
}

async function createRun(store: LocalStore, threadId: string) {
  const agentId = store.getThread(threadId).agentId;
  return (
    await store.createLeasedRun(
      { threadId, agentId },
      {
        ownerId: "process:999999999:retry-lineage-test",
        ttlMs: 30_000,
      },
    )
  ).run;
}

function gate(store: LocalStore, suffix: string): ToolConcurrencyGate {
  return new ToolConcurrencyGate({
    durable: {
      backend: store.toolConcurrencyLeaseBackend(),
      ownerId: `retry-lineage-test:${suffix}`,
      leaseTtlMs: 5_000,
      heartbeatIntervalMs: 1_000,
    },
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import { wrapAgentToolsWithLifecycle } from "../src/agent-runtime-step-lifecycle.js";
import { AgentToolDisplayStore } from "../src/agent-tool-display-store.js";
import { AgentToolResultLifecycle } from "../src/agent-tool-result-lifecycle.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  claimDurableToolExecution,
  reconcileCapturedToolExecutionResult,
  ToolExecutionClaimError,
} from "../src/durable-tool-execution.js";
import {
  claimRunHeadEvent,
  IdempotentEventConflictError,
} from "../src/event-idempotency.js";
import { AgentLifecyclePipelineHost } from "../src/lifecycle-extension-pipeline.js";
import { ModelRegistry } from "../src/models.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { LocalStore } from "../src/store.js";
import { captureToolInvocation } from "../src/tool-invocation-capture.js";
import { ToolInvocationCapsuleStore } from "../src/tool-invocation-capsule-store.js";
import { captureToolInvocationResult } from "../src/tool-invocation-result-capture.js";
import { ToolInvocationResultCapsuleStore } from "../src/tool-invocation-result-capsule-store.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { legacyToolExecutionAuthorityDescriptor } from "../src/tool-execution-authority-binding.js";
import { projectSettledToolOperationProgress } from "../src/tool-operation-journal.js";
import { DurableToolOperationJournal } from "../src/tool-operation-journal.js";
import { defineToolProgress } from "../src/tool-progress-semantics.js";
import { defineInternalToolProtocolV2 } from "../src/tool-protocol-declaration.js";
import {
  genericToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "../src/tool-protocol-schema.js";
import { ToolProtocolRegistry } from "../src/tool-protocol-registry.js";
import { createToolCallSha256 } from "../src/tool-loop-guard.js";
import { createWebFetchTool } from "../src/web-fetch-tool.js";
import { RunWebFetchSourceManager } from "../src/web-fetch-sources.js";
import { WebSearchProviderRegistry } from "../src/web-search-providers.js";
import { createWebSearchTool } from "../src/web-search-tool.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("normal Agent tool admission", () => {
  it("grants one durable execution lease and orders admission before start", async () => {
    const fixture = await createFixture("replay");
    let executed = 0;
    const [wrapped] = wrap(
      [
        tool("read_file", async () => {
          executed += 1;
        }),
      ],
      fixture,
    );

    await expect(wrapped!.execute("stable-call", {})).resolves.toEqual(
      expect.objectContaining({ details: {} }),
    );
    await expect(wrapped!.execute("stable-call", {})).rejects.toEqual(
      expect.objectContaining<ToolExecutionClaimError>({
        name: "ToolExecutionClaimError",
        callId: "stable-call",
        disposition: "terminal_replay",
      }),
    );
    await expect(
      wrapped!.execute("stable-call", { changed: true } as never),
    ).rejects.toEqual(
      expect.objectContaining<ToolExecutionClaimError>({
        name: "ToolExecutionClaimError",
        callId: "stable-call",
        disposition: "rejected",
      }),
    );

    expect(executed).toBe(1);
    const phases = (await fixture.store.listRunEvents(fixture.run.id)).filter(
      (event) => event.payload["toolName"] === "read_file",
    );
    expect(phases.map((event) => event.type)).toEqual([
      "tool.admitted",
      "tool.started",
    ]);
    fixture.store.close();
  });

  it("atomically rejects concurrent attempts to change one call binding", async () => {
    const fixture = await createFixture("binding-race");
    let executed = 0;
    const [wrapped] = wrap(
      [
        tool("read_file", async () => {
          executed += 1;
          await delay(20);
        }),
      ],
      fixture,
    );

    const outcomes = await Promise.allSettled([
      wrapped!.execute("same-call", { path: "first" } as never),
      wrapped!.execute("same-call", { path: "second" } as never),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual(
      [
        expect.objectContaining({
          reason: expect.objectContaining<ToolExecutionClaimError>({
            name: "ToolExecutionClaimError",
            disposition: "rejected",
          }),
        }),
      ],
    );
    expect(executed).toBe(1);
    expect(
      (await fixture.store.listRunEvents(fixture.run.id)).filter(
        (event) => event.type === "tool.admitted",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  });

  it("reuses a role-less legacy authority after reopening the store", async () => {
    const fixture = await createFixture("legacy-replay");
    const args = {};
    const raw = tool("apply_patch", async () => {
      throw new Error("legacy terminal must not execute again");
    });
    const protocol = new ToolProtocolRegistry([raw]).require(raw.name);
    const invocation = protocol.invocation(args);
    const callId = "legacy-call";
    const legacy = new DurableToolOperationJournal(fixture.store, {
      threadId: fixture.run.threadId,
      runId: fixture.run.id,
    })
      .observer(callId)
      .operation(legacyToolExecutionAuthorityDescriptor(raw.name, invocation));
    await legacy.admit();
    await legacy.started();
    await legacy.settled({ outcome: "succeeded", state: "legacy-state" });
    const admissionId = sha256(
      canonicalJson({
        schemaVersion: 1,
        runId: fixture.run.id,
        callId,
        toolId: raw.name,
        definitionSha256: invocation.definitionSha256,
      }),
    );
    await claimRunHeadEvent(
      fixture.store,
      {
        threadId: fixture.run.threadId,
        runId: fixture.run.id,
        type: "tool.admitted",
        category: "tool",
        visibility: "debug",
        payload: {
          callId,
          toolName: raw.name,
          status: "admitted",
          admissionId,
          callInputSha256: createToolCallSha256(raw.name, args),
          concurrency: invocation.concurrency,
          toolProtocol: protocol.uiProjection("started", args),
        },
      },
      {
        namespace: "durable-tool-execution-phase",
        key: `${fixture.run.id}:${callId}:tool.admitted`,
      },
    );
    fixture.store.close();

    const reopened = new LocalStore({
      workspaceRoot: fixture.root,
      dataRoot: path.join(fixture.root, "state"),
    });
    await reopened.initialize();
    const [wrapped] = wrap([raw], { ...fixture, store: reopened });

    await expect(wrapped!.execute(callId, args)).rejects.toEqual(
      expect.objectContaining<ToolExecutionClaimError>({
        name: "ToolExecutionClaimError",
        disposition: "terminal_replay",
      }),
    );
    const events = await reopened.listRunEvents(fixture.run.id);
    expect(
      events.filter((event) => event.type === "tool.admitted"),
    ).toHaveLength(1);
    expect(projectSettledToolOperationProgress(events).observations).toEqual(
      [],
    );
    reopened.close();
  });

  it("keeps invocation and result receipts unique across store reopen", async () => {
    const fixture = await createFixture("receipt-replay");
    const raw: AgentTool = replayableReadTool({
      name: "read_file",
      label: "read_file",
      description: "read_file",
      parameters: Type.Object({ path: Type.String() }),
      execute: async () => ({
        content: [{ type: "text", text: "evidence" }],
        details: {},
      }),
    });
    const protocol = new ToolProtocolRegistry([raw]).require(raw.name);
    const invocationCapsules = new ToolInvocationCapsuleStore(
      path.join(fixture.root, "private"),
    );
    const resultCapsules = new ToolInvocationResultCapsuleStore(
      path.join(fixture.root, "private"),
    );
    const args = { path: "evidence.txt" };
    const result = {
      content: [{ type: "text" as const, text: "evidence" }],
      details: {},
    };
    const firstInvocation = await captureToolInvocation(
      fixture.store,
      invocationCapsules,
      fixture.run,
      raw,
      "receipt-call",
      raw.name,
      args,
      protocol.definitionSha256,
    );
    expect(firstInvocation).toBeDefined();
    await captureToolInvocationResult(
      fixture.store,
      resultCapsules,
      fixture.run,
      firstInvocation,
      result,
      false,
    );
    fixture.store.close();

    const reopened = new LocalStore({
      workspaceRoot: fixture.root,
      dataRoot: path.join(fixture.root, "state"),
    });
    await reopened.initialize();
    const replayedInvocation = await captureToolInvocation(
      reopened,
      invocationCapsules,
      fixture.run,
      raw,
      "receipt-call",
      raw.name,
      args,
      protocol.definitionSha256,
    );
    await captureToolInvocationResult(
      reopened,
      resultCapsules,
      fixture.run,
      replayedInvocation,
      result,
      false,
    );

    const events = await reopened.listRunEvents(fixture.run.id);
    expect(
      events.filter((event) => event.type === "context.tool_invocation"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "context.tool_result"),
    ).toHaveLength(1);
    await expect(
      captureToolInvocation(
        reopened,
        invocationCapsules,
        fixture.run,
        raw,
        "receipt-call",
        raw.name,
        { path: "changed.txt" },
        protocol.definitionSha256,
      ),
    ).rejects.toBeInstanceOf(IdempotentEventConflictError);
    await expect(
      captureToolInvocationResult(
        reopened,
        resultCapsules,
        fixture.run,
        replayedInvocation,
        { ...result, content: [{ type: "text", text: "changed" }] },
        false,
      ),
    ).rejects.toBeInstanceOf(IdempotentEventConflictError);
    reopened.close();
  });

  it("replays a captured failure with its error bit and no second receipt", async () => {
    const fixture = await createFixture("failure-result-replay");
    const raw: AgentTool = replayableReadTool({
      name: "read_file",
      label: "read_file",
      description: "read_file",
      parameters: Type.Object({ path: Type.String() }),
      execute: async () => {
        throw new Error("missing evidence");
      },
    });
    const registry = new ToolProtocolRegistry([raw]);
    const invocationCapsules = new ToolInvocationCapsuleStore(
      path.join(fixture.root, "replay-private"),
    );
    const resultCapsules = new ToolInvocationResultCapsuleStore(
      path.join(fixture.root, "replay-private"),
    );
    const lifecycle = () =>
      new AgentToolResultLifecycle({
        store: fixture.store,
        run: fixture.run,
        tools: [raw],
        definitions: [raw],
        toolProtocol: registry,
        invocationCapsules,
        resultCapsules,
        displays: new AgentToolDisplayStore(
          path.join(fixture.root, "replay-private"),
        ),
        budget: new RunBudgetTracker(
          fixture.run.limits!,
          fixture.run.startedAt,
        ),
        registry: new ModelRegistry(),
        deferredTools: [],
      });
    const first = lifecycle();
    const args = { path: "missing.txt" };
    const failedResult = {
      content: [{ type: "text" as const, text: "missing evidence" }],
      details: {},
    };
    await first.preflight("failed-call", raw.name, args);
    await first.finalize({
      toolCall: { id: "failed-call", name: raw.name },
      result: failedResult,
      isError: true,
    });

    const restarted = lifecycle();
    const replay = await restarted.replayCapturedResult(
      "failed-call",
      raw.name,
      args,
    );
    expect(replay).toEqual({
      result: failedResult,
      isError: true,
      resultEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    await expect(
      restarted.finalize({
        toolCall: { id: "failed-call", name: raw.name },
        result: replay!.result,
        isError: false,
      }),
    ).resolves.toEqual({ isError: true });
    expect(
      (await fixture.store.listRunEvents(fixture.run.id)).filter(
        (event) => event.type === "context.tool_result",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  });

  it("replays a terminal thrown result without executing or recapturing", async () => {
    const fixture = await createFixture("terminal-failure-replay");
    let executions = 0;
    const raw: AgentTool = replayableReadTool({
      name: "read_file",
      label: "read_file",
      description: "read_file",
      parameters: Type.Object({ path: Type.String() }),
      execute: async () => {
        executions += 1;
        throw new Error("durably missing");
      },
    });
    const registry = new ToolProtocolRegistry([raw]);
    const privateRoot = path.join(fixture.root, "terminal-error-private");
    const lifecycle = () =>
      new AgentToolResultLifecycle({
        store: fixture.store,
        run: fixture.run,
        tools: [raw],
        definitions: [raw],
        toolProtocol: registry,
        invocationCapsules: new ToolInvocationCapsuleStore(privateRoot),
        resultCapsules: new ToolInvocationResultCapsuleStore(privateRoot),
        displays: new AgentToolDisplayStore(privateRoot),
        budget: new RunBudgetTracker(
          fixture.run.limits!,
          fixture.run.startedAt,
        ),
        registry: new ModelRegistry(),
        deferredTools: [],
      });
    const args = { path: "missing.txt" };
    const firstLifecycle = lifecycle();
    await firstLifecycle.preflight("terminal-error-call", raw.name, args);
    const [first] = wrapAgentToolsWithLifecycle({
      tools: [raw],
      registry,
      lifecycles: new AgentLifecyclePipelineHost(),
      run: fixture.run,
      stepIndex: () => 1,
      store: fixture.store,
      concurrencyGate: new ToolConcurrencyGate(),
      prepareSettlement: (value) => firstLifecycle.finalize(value),
      replayTerminal: (callId, toolName, input) =>
        firstLifecycle.replayCapturedResult(callId, toolName, input),
    });
    await expect(first!.execute("terminal-error-call", args)).rejects.toThrow(
      "durably missing",
    );

    const restarted = lifecycle();
    const [replayed] = wrapAgentToolsWithLifecycle({
      tools: [raw],
      registry,
      lifecycles: new AgentLifecyclePipelineHost(),
      run: fixture.run,
      stepIndex: () => 2,
      store: fixture.store,
      concurrencyGate: new ToolConcurrencyGate(),
      prepareSettlement: (value) => restarted.finalize(value),
      replayTerminal: (callId, toolName, input) =>
        restarted.replayCapturedResult(callId, toolName, input),
    });
    const result = await replayed!.execute("terminal-error-call", args);
    expect(result.content).toEqual([{ type: "text", text: "durably missing" }]);
    expect(
      await restarted.finalize({
        toolCall: { id: "terminal-error-call", name: raw.name },
        result,
        isError: false,
      }),
    ).toEqual({ isError: true });
    expect(executions).toBe(1);
    expect(
      (await fixture.store.listRunEvents(fixture.run.id)).filter(
        (event) => event.type === "context.tool_result",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  });

  it("repairs a captured result after restart before replaying it", async () => {
    const fixture = await createFixture("result-settlement-repair");
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    let executions = 0;
    const raw: AgentTool = replayableReadTool({
      name: "read_file",
      label: "read_file",
      description: "read_file",
      parameters: Type.Object({ path: Type.String() }),
      execute: async () => {
        executions += 1;
        return {
          content: [{ type: "text", text: "must not execute" }],
          details: {},
        };
      },
    });
    const registry = new ToolProtocolRegistry([raw]);
    const protocol = registry.require(raw.name);
    const privateRoot = path.join(fixture.root, "repair-private");
    const invocationCapsules = new ToolInvocationCapsuleStore(privateRoot);
    const resultCapsules = new ToolInvocationResultCapsuleStore(privateRoot);
    const args = { path: "captured.txt" };
    const result = {
      content: [{ type: "text" as const, text: "captured before crash" }],
      details: { source: "capsule" },
    };
    const invocation = await captureToolInvocation(
      fixture.store,
      invocationCapsules,
      fixture.run,
      raw,
      "repair-call",
      raw.name,
      args,
      protocol.definitionSha256,
    );
    const execution = await claimDurableToolExecution({
      store: fixture.store,
      run: fixture.run,
      callId: "repair-call",
      toolName: raw.name,
      args,
      protocol,
      journalOptions: {
        now: () => now,
        executionLease: { ownerId: "crashed-owner", durationMs: 10 },
      },
    });
    await execution.start({});
    const resultReceipt = await captureToolInvocationResult(
      fixture.store,
      resultCapsules,
      fixture.run,
      invocation,
      result,
      false,
    );
    expect(resultReceipt).toBeDefined();
    fixture.store.close();

    now += 10;
    const reopened = new LocalStore({
      workspaceRoot: fixture.root,
      dataRoot: path.join(fixture.root, "state"),
    });
    await reopened.initialize();
    const restarted = new AgentToolResultLifecycle({
      store: reopened,
      run: fixture.run,
      tools: [raw],
      definitions: [raw],
      toolProtocol: registry,
      invocationCapsules,
      resultCapsules,
      displays: new AgentToolDisplayStore(privateRoot),
      budget: new RunBudgetTracker(fixture.run.limits!, fixture.run.startedAt),
      registry: new ModelRegistry(),
      deferredTools: [],
    });
    const [wrapped] = wrapAgentToolsWithLifecycle({
      tools: [raw],
      registry,
      lifecycles: new AgentLifecyclePipelineHost(),
      run: fixture.run,
      stepIndex: () => 1,
      store: reopened,
      concurrencyGate: new ToolConcurrencyGate(),
      journalOptions: {
        now: () => now,
        executionLease: { ownerId: "repair-owner", durationMs: 10 },
      },
      replayTerminal: (callId, toolName, input) =>
        restarted.replayCapturedResult(callId, toolName, input),
    });

    await expect(wrapped!.execute("repair-call", args)).resolves.toEqual(
      result,
    );
    expect(executions).toBe(0);
    const events = await reopened.listRunEvents(fixture.run.id);
    expect(
      events.filter((event) => event.type === "tool.operation.settled"),
    ).toHaveLength(1);
    expect(
      events.find((event) => event.type === "tool.operation.settled")?.payload[
        "resultEvidenceSha256"
      ],
    ).toBe(resultReceipt!.contentSha256);
    await expect(wrapped!.execute("repair-call", args)).resolves.toEqual(
      result,
    );
    expect(executions).toBe(0);
    reopened.close();
  });

  it("fails closed when a terminal effect conflicts with its result receipt", async () => {
    const fixture = await createFixture("terminal-result-conflict");
    const raw: AgentTool = replayableReadTool({
      name: "read_file",
      label: "read_file",
      description: "read_file",
      parameters: Type.Object({ path: Type.String() }),
      execute: async () => ({ content: [], details: {} }),
    });
    const protocol = new ToolProtocolRegistry([raw]).require(raw.name);
    const privateRoot = path.join(fixture.root, "conflict-private");
    const args = { path: "conflict.txt" };
    const captured = {
      content: [{ type: "text" as const, text: "captured value" }],
      details: {},
    };
    const invocation = await captureToolInvocation(
      fixture.store,
      new ToolInvocationCapsuleStore(privateRoot),
      fixture.run,
      raw,
      "conflict-call",
      raw.name,
      args,
      protocol.definitionSha256,
    );
    const claimInput = {
      store: fixture.store,
      run: fixture.run,
      callId: "conflict-call",
      toolName: raw.name,
      args,
      protocol,
    };
    const execution = await claimDurableToolExecution(claimInput);
    await execution.start({});
    const receipt = await captureToolInvocationResult(
      fixture.store,
      new ToolInvocationResultCapsuleStore(privateRoot),
      fixture.run,
      invocation,
      captured,
      false,
    );
    await execution.settleResult(
      {
        content: [{ type: "text", text: "different terminal value" }],
        details: {},
      },
      false,
    );

    await expect(
      reconcileCapturedToolExecutionResult(claimInput, "terminal_replay", {
        result: captured,
        isError: false,
        resultEvidenceSha256: receipt!.contentSha256,
      }),
    ).resolves.toBe(false);
    fixture.store.close();
  });

  it("does not count the web_search execution lease as a provider attempt", async () => {
    const fixture = await createFixture("web-search-progress");
    const executor = new WebSearchProviderRegistry({
      providers: [
        {
          id: "firecrawl",
          supportsImages: true,
          available: () => true,
          search: async () => [
            {
              title: "Primary source",
              url: "https://example.com/source",
              source: "fixture",
            },
          ],
        },
      ],
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    const raw = createWebSearchTool(executor, {
      store: fixture.store,
      owner: { threadId: fixture.run.threadId, runId: fixture.run.id },
    });
    const [wrapped] = wrap([raw], fixture);

    const result = await wrapped!.execute("search-call", {
      query: "primary source",
      provider: "firecrawl",
    });

    expect(result.details).toEqual(
      expect.objectContaining({ operationCount: 1, settledOperationCount: 1 }),
    );
    const progress = projectSettledToolOperationProgress(
      await fixture.store.listRunEvents(fixture.run.id),
    );
    expect(progress.suppressParentSingletonCallIds).toEqual(["search-call"]);
    expect(progress.observations).toEqual([
      expect.objectContaining({
        parentCallId: "search-call",
        route: "firecrawl",
        outcome: "succeeded",
      }),
    ]);
    fixture.store.close();
  });

  it("does not count the web_fetch execution lease as a source attempt", async () => {
    const fixture = await createFixture("web-fetch-progress");
    const executor = new RunWebFetchSourceManager({
      http: {
        request: async () => ({
          status: 200,
          headers: { "content-type": "text/plain" },
          body: Buffer.from("Primary source evidence.\n"),
          finalUrl: "https://example.com/source",
          redirectCount: 0,
        }),
      },
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    const raw = createWebFetchTool(
      executor,
      { threadId: fixture.run.threadId, runId: fixture.run.id },
      {},
      {
        store: fixture.store,
        owner: { threadId: fixture.run.threadId, runId: fixture.run.id },
      },
    );
    const [wrapped] = wrap([raw], fixture);

    await wrapped!.execute("fetch-call", {
      action: "fetch",
      url: "https://example.com/source",
    });

    const progress = projectSettledToolOperationProgress(
      await fixture.store.listRunEvents(fixture.run.id),
    );
    expect(progress.suppressParentSingletonCallIds).toEqual(["fetch-call"]);
    expect(progress.observations).toEqual([
      expect.objectContaining({
        parentCallId: "fetch-call",
        route: "static_http",
        outcome: "succeeded",
      }),
    ]);
    fixture.store.close();
  });

  it("shares semantic resource arbitration across Run owners", async () => {
    const first = await createFixture("cross-run-a");
    const second = await createFixture("cross-run-b");
    const gate = new ToolConcurrencyGate();
    let active = 0;
    let maximum = 0;
    const mutation = () =>
      tool("apply_patch", async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await delay(20);
        active -= 1;
      });
    const [firstTool] = wrap([mutation()], first, gate);
    const [secondTool] = wrap([mutation()], second, gate);

    await Promise.all([
      firstTool!.execute("cross-run-a", {}),
      secondTool!.execute("cross-run-b", {}),
    ]);

    expect(maximum).toBe(1);
    first.store.close();
    second.store.close();
  });

  it("uses the same Run-scoped concurrency contract as nested dispatch", async () => {
    const fixture = await createFixture("concurrency");
    let activeSafe = 0;
    let maxSafe = 0;
    let activeSerialized = 0;
    let maxSerialized = 0;
    const read = replayableReadTool(
      tool("read_file", async () => {
        activeSafe += 1;
        maxSafe = Math.max(maxSafe, activeSafe);
        await delay(100);
        activeSafe -= 1;
      }),
    );
    const write = tool("apply_patch", async () => {
      activeSerialized += 1;
      maxSerialized = Math.max(maxSerialized, activeSerialized);
      await delay(20);
      activeSerialized -= 1;
    });
    const wrapped = wrap([read, write], fixture);

    await Promise.all([
      wrapped[0]!.execute("read-1", {}),
      wrapped[0]!.execute("read-2", {}),
    ]);
    await Promise.all([
      wrapped[1]!.execute("write-1", {}),
      wrapped[1]!.execute("write-2", {}),
    ]);

    expect(maxSafe).toBe(2);
    expect(maxSerialized).toBe(1);
    expect(
      (await fixture.store.listRunEvents(fixture.run.id)).filter(
        (event) => event.type === "tool.admitted",
      ),
    ).toHaveLength(4);
    fixture.store.close();
  });

  it("does not let an unattested unknown tool overlap a trusted reader", async () => {
    const fixture = await createFixture("unattested-concurrency");
    let active = 0;
    let maximum = 0;
    const work = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await delay(40);
      active -= 1;
    };
    const [read, unknown] = wrap(
      [
        replayableReadTool(tool("trusted_reader", work)),
        tool("unattested_writer", work),
      ],
      fixture,
    );

    await Promise.all([
      read!.execute("trusted-read", {}),
      unknown!.execute("unattested-write", {}),
    ]);

    expect(maximum).toBe(1);
    fixture.store.close();
  });

  it("keeps progress adapter failures observable without interrupting the tool", async () => {
    const fixture = await createFixture("classification-failure");
    let executed = 0;
    const declared = defineToolProgress(
      tool("adapter_failure", async () => {
        executed += 1;
      }),
      {
        schemaVersion: 1,
        classificationVersion: "1.0.0",
        modes: [
          {
            modeId: "mutate",
            operation: "mutate",
            scope: "workspace",
            contribution: "product",
          },
        ],
        resolve: () => {
          throw new Error("classifier defect");
        },
      },
    );
    const [wrapped] = wrap([declared], fixture);

    await expect(wrapped!.execute("adapter-1", {})).resolves.toEqual(
      expect.objectContaining({ details: {} }),
    );
    expect(executed).toBe(1);
    expect(
      (await fixture.store.listRunEvents(fixture.run.id)).find(
        (event) => event.type === "tool.admitted",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        toolProtocol: expect.objectContaining({
          progress: expect.objectContaining({
            coverage: "opaque",
            contribution: "neutral",
            classificationErrorSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      }),
    );
    fixture.store.close();
  });
});

function wrap(
  tools: AgentTool[],
  fixture: Awaited<ReturnType<typeof createFixture>>,
  concurrencyGate = new ToolConcurrencyGate(),
): AgentTool[] {
  return wrapAgentToolsWithLifecycle({
    tools,
    registry: new ToolProtocolRegistry(tools),
    lifecycles: new AgentLifecyclePipelineHost(),
    run: fixture.run,
    stepIndex: () => 1,
    store: fixture.store,
    concurrencyGate,
  });
}

function tool(name: string, execute: () => Promise<void>): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => {
      await execute();
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  };
}

function replayableReadTool<T extends AgentTool>(tool: T): T {
  return defineInternalToolProtocolV2(tool, {
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.0.0-test.1",
      capabilityUris: [`cap://tools/${tool.name}`],
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "terminal_failure", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "exact_result_only" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["test:replayable-read"],
    },
  });
}

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-admission-${label}-`));
  roots.push(root);
  const store = new LocalStore({
    workspaceRoot: root,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: label, agentId: agent.id });
  const { run } = await store.createLeasedRun(
    { threadId: thread.id, agentId: agent.id },
    { ownerId: "worker.agent-tool-admission", ttlMs: 30_000 },
  );
  return { store, run, root };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

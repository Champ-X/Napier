import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import { createGovernedCodeBridgeDispatcher } from "../src/governed-code-bridge.js";
import { bindBuiltInToolCompatibilityPolicy } from "../src/agent-tool-effects.js";
import { ToolExecutionClaimError } from "../src/durable-tool-execution.js";
import { LocalStore } from "../src/store.js";
import { ToolOperationFencingError } from "../src/tool-operation-journal.js";
import { defineReplayableTestReadTool } from "./self-describing-tool-test-support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Governed Code Bridge concurrency", () => {
  it("does not repeat a nested side effect when the transport replays a call ID", async () => {
    const fixture = await bridgeFixture("replay");
    let executions = 0;
    const write = delayedReversibleWriteTool(async () => {
      executions += 1;
    });
    const dispatch = createGovernedCodeBridgeDispatcher({
      ...fixture,
      tools: [write],
      activeToolNames: () => new Set([write.name]),
      assertBudget: () => undefined,
      preflight: async () => undefined,
      finalize: async () => undefined,
    });
    const replayed = request(77, write.name);

    await expect(dispatch(replayed)).resolves.toEqual(
      expect.objectContaining({ isError: false }),
    );
    await expect(dispatch(replayed)).rejects.toEqual(
      expect.objectContaining<ToolExecutionClaimError>({
        name: "ToolExecutionClaimError",
        disposition: "terminal_replay",
      }),
    );

    expect(executions).toBe(1);
    const phases = (await fixture.store.listRunEvents(fixture.run.id)).filter(
      (event) => event.payload["toolName"] === write.name,
    );
    expect(phases.map((event) => event.type)).toEqual([
      "tool.admitted",
      "code_bridge.authorized",
      "tool.started",
      "tool.completed",
    ]);
    fixture.store.close();
  });

  it("does not invoke a nested effect after terminal wins post-start", async () => {
    const fixture = await bridgeFixture("terminal-effect-fence");
    let executions = 0;
    let terminalCommitted = false;
    const write = delayedReversibleWriteTool(async () => {
      executions += 1;
    });
    const fencedStore = new Proxy(fixture.store, {
      get(target, property) {
        if (property === "appendEventOnceAtRunHead") {
          return async (
            input: Parameters<LocalStore["appendEventOnceAtRunHead"]>[0],
            options: Parameters<LocalStore["appendEventOnceAtRunHead"]>[1],
          ) => {
            const receipt = await target.appendEventOnceAtRunHead(
              input,
              options,
            );
            if (input.type === "tool.started" && !terminalCommitted) {
              terminalCommitted = true;
              await target.finishRun(fixture.run.id, "cancelled");
            }
            return receipt;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const dispatch = createGovernedCodeBridgeDispatcher({
      ...fixture,
      store: fencedStore,
      tools: [write],
      activeToolNames: () => new Set([write.name]),
      assertBudget: () => undefined,
      preflight: async () => undefined,
      finalize: async () => undefined,
    });

    await expect(dispatch(request(80, write.name))).rejects.toBeInstanceOf(
      ToolOperationFencingError,
    );
    expect(executions).toBe(0);
    fixture.store.close();
  });

  it("rejects a terminal result that has no durable evidence binding", async () => {
    const fixture = await bridgeFixture("terminal-result-replay");
    let executions = 0;
    const read = delayedReadTool(async () => {
      executions += 1;
    });
    const captured = {
      content: [{ type: "text" as const, text: "ok" }],
      details: {},
    };
    const dispatch = createGovernedCodeBridgeDispatcher({
      ...fixture,
      tools: [read],
      activeToolNames: () => new Set([read.name]),
      assertBudget: () => undefined,
      preflight: async () => undefined,
      finalize: async () => undefined,
      replayTerminal: async () => ({ result: captured, isError: false }),
    });
    const replayed = request(78, read.name);

    await dispatch(replayed);
    await expect(dispatch(replayed)).rejects.toEqual(
      expect.objectContaining<ToolExecutionClaimError>({
        name: "ToolExecutionClaimError",
        disposition: "terminal_replay",
      }),
    );
    expect(executions).toBe(1);
    fixture.store.close();
  });

  it("does not deliver a captured result while its execution lease is still live", async () => {
    const fixture = await bridgeFixture("captured-in-flight");
    let executions = 0;
    let captured!: () => void;
    const captureReady = new Promise<void>((resolve) => {
      captured = resolve;
    });
    let releaseSettlement!: () => void;
    const settlementReleased = new Promise<void>((resolve) => {
      releaseSettlement = resolve;
    });
    const read = delayedReadTool(async () => {
      executions += 1;
    });
    const replayed = {
      content: [{ type: "text" as const, text: "ok" }],
      details: {},
    };
    const dispatch = createGovernedCodeBridgeDispatcher({
      ...fixture,
      tools: [read],
      activeToolNames: () => new Set([read.name]),
      assertBudget: () => undefined,
      preflight: async () => undefined,
      finalize: async () => {
        captured();
        await settlementReleased;
        return undefined;
      },
      replayTerminal: async () => ({ result: replayed, isError: false }),
    });
    const sameCall = request(79, read.name);
    const first = dispatch(sameCall);
    await captureReady;

    await expect(dispatch(sameCall)).rejects.toEqual(
      expect.objectContaining<ToolExecutionClaimError>({
        name: "ToolExecutionClaimError",
        disposition: "in_flight_replay",
      }),
    );
    expect(executions).toBe(1);
    releaseSettlement();
    await expect(first).resolves.toEqual(
      expect.objectContaining({ isError: false }),
    );
    await expect(dispatch(sameCall)).rejects.toEqual(
      expect.objectContaining<ToolExecutionClaimError>({
        name: "ToolExecutionClaimError",
        disposition: "terminal_replay",
      }),
    );
    expect(executions).toBe(1);
    fixture.store.close();
  });

  it("runs safe reads concurrently and serializes reversible mutations", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-bridge-concurrency-"),
    );
    roots.push(root);
    const store = new LocalStore({
      workspaceRoot: root,
      dataRoot: path.join(root, "state"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Bridge concurrency",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    let activeReads = 0;
    let maxReads = 0;
    let activeWrites = 0;
    let maxWrites = 0;
    const read = delayedReadTool(async () => {
      activeReads += 1;
      maxReads = Math.max(maxReads, activeReads);
      await delay(20);
      activeReads -= 1;
    });
    const write = delayedReversibleWriteTool(async () => {
      activeWrites += 1;
      maxWrites = Math.max(maxWrites, activeWrites);
      await delay(20);
      activeWrites -= 1;
    });
    const dispatch = createGovernedCodeBridgeDispatcher({
      store,
      run,
      tools: [read, write],
      activeToolNames: () => new Set([read.name, write.name]),
      assertBudget: () => undefined,
      preflight: async () => undefined,
      finalize: async () => undefined,
    });

    await Promise.all([
      dispatch(request(1, "read_file")),
      dispatch(request(2, "read_file")),
    ]);
    await Promise.all([
      dispatch(request(3, "apply_patch")),
      dispatch(request(4, "apply_patch")),
    ]);

    expect(maxReads).toBe(2);
    expect(maxWrites).toBe(1);
    store.close();
  });

  it("serializes workspace mutations across fallback gate instances", async () => {
    const fixture = await bridgeFixture("durable-fallback");
    let activeWrites = 0;
    let maxWrites = 0;
    const write = delayedReversibleWriteTool(async () => {
      activeWrites += 1;
      maxWrites = Math.max(maxWrites, activeWrites);
      await delay(20);
      activeWrites -= 1;
    });
    const dispatcher = () =>
      createGovernedCodeBridgeDispatcher({
        ...fixture,
        tools: [write],
        activeToolNames: () => new Set([write.name]),
        assertBudget: () => undefined,
        preflight: async () => undefined,
        finalize: async () => undefined,
      });

    const first = dispatcher();
    const second = dispatcher();
    await Promise.all([
      first(request(21, write.name)),
      second(request(22, write.name)),
    ]);

    expect(maxWrites).toBe(1);
    fixture.store.close();
  });

  it("inherits a causal parent lease without letting unrelated writes bypass serialization", async () => {
    const gate = new (
      await import("../src/tool-concurrency-gate.js")
    ).ToolConcurrencyGate();
    const phases: string[] = [];
    let releaseChild!: () => void;
    const childReady = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    let childStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      childStarted = resolve;
    });

    const parent = gate.run("serialized", undefined, async () => {
      phases.push("parent:start");
      await gate.run("serialized", undefined, async () => {
        phases.push("child:start");
        childStarted();
        await childReady;
        phases.push("child:end");
      });
      phases.push("parent:end");
    });
    await started;
    const unrelated = gate.run("serialized", undefined, async () => {
      phases.push("unrelated");
    });
    await Promise.resolve();
    expect(phases).toEqual(["parent:start", "child:start"]);
    releaseChild();
    await Promise.all([parent, unrelated]);
    expect(phases).toEqual([
      "parent:start",
      "child:start",
      "child:end",
      "parent:end",
      "unrelated",
    ]);
  });

  it("fails fast when a nested call tries to strengthen its parent lease to exclusive", async () => {
    const gate = new (
      await import("../src/tool-concurrency-gate.js")
    ).ToolConcurrencyGate();
    await expect(
      gate.run("serialized", undefined, () =>
        gate.run("exclusive", undefined, async () => undefined),
      ),
    ).rejects.toThrow("cannot escalate from serialized to exclusive");
  });

  it("fails closed before policy or execution when auxiliary budget is exhausted", async () => {
    const fixture = await bridgeFixture("budget");
    let preflightCalls = 0;
    let executeCalls = 0;
    const tool = delayedReadTool(async () => {
      executeCalls += 1;
    });
    const dispatch = createGovernedCodeBridgeDispatcher({
      ...fixture,
      tools: [tool],
      activeToolNames: () => new Set([tool.name]),
      assertBudget: () => {
        throw new Error("Run token budget exhausted");
      },
      preflight: async () => {
        preflightCalls += 1;
        return undefined;
      },
      finalize: async () => undefined,
    });

    await expect(dispatch(request(9, "read_file"))).rejects.toThrow(
      "Run token budget exhausted",
    );
    expect(preflightCalls).toBe(0);
    expect(executeCalls).toBe(0);
    expect(
      (await fixture.store.listEvents(fixture.run.threadId)).find(
        (event) => event.type === "tool.blocked",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        harnessInterventionReason: "budget_pause",
        nestedDispatch: true,
        toolProtocol: expect.objectContaining({
          kind: "napier.tool-ui-projection",
          schemaVersion: 2,
          toolId: "read_file",
          semanticVersion: "2.0.0-test.1",
          status: "blocked",
          sideEffect: "none",
          concurrency: "safe",
          compatibilityMode: "native",
        }),
      }),
    );
    fixture.store.close();
  });
});

async function bridgeFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-bridge-${label}-`));
  roots.push(root);
  const store = new LocalStore({
    workspaceRoot: root,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: label, agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  return { store, run };
}

function delayedTool(name: string, execute: () => Promise<void>): AgentTool {
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

function delayedReadTool(execute: () => Promise<void>): AgentTool {
  return defineReplayableTestReadTool(delayedTool("read_file", execute));
}

function delayedReversibleWriteTool(execute: () => Promise<void>): AgentTool {
  return bindBuiltInToolCompatibilityPolicy(
    delayedTool("apply_patch", execute),
  );
}

function request(callId: number, toolId: string) {
  return {
    evaluationId: "kernelrequest_12345678901234567890",
    callId,
    toolId,
    input: {},
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

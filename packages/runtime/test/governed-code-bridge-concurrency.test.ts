import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import { createGovernedCodeBridgeDispatcher } from "../src/governed-code-bridge.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Governed Code Bridge concurrency", () => {
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
    const read = delayedTool("read_file", async () => {
      activeReads += 1;
      maxReads = Math.max(maxReads, activeReads);
      await delay(20);
      activeReads -= 1;
    });
    const write = delayedTool("apply_patch", async () => {
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

  it("fails closed before policy or execution when auxiliary budget is exhausted", async () => {
    const fixture = await bridgeFixture("budget");
    let preflightCalls = 0;
    let executeCalls = 0;
    const tool = delayedTool("read_file", async () => {
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

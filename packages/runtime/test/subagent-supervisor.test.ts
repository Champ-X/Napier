import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { SubagentRequest } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { InProcessSubagentProvider } from "../src/in-process-subagent-provider.js";
import { ModelRouter } from "../src/model-route.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { SubagentSupervisor } from "../src/subagent-supervisor.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function harness(options: { models?: Array<{ id: string }> } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-supervisor-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: "Supervisor", agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const faux = fauxProvider({
    provider: `faux-${run.id}`,
    models: options.models ?? [{ id: "faux-1" }],
    tokensPerSecond: 1_000,
  });
  const registry = new ModelRegistry();
  registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "faux-1" })!;
  const parent = new AbortController();
  const provider = new InProcessSubagentProvider({
    store,
    models: registry.models,
    modelRouter: new ModelRouter(store, registry),
    defaultModel: model,
    run,
    limits: { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 5_000 },
    parentSignal: parent.signal,
  });
  return {
    store,
    thread,
    run,
    faux,
    registry,
    provider,
    supervisor: new SubagentSupervisor(provider),
  };
}

function request(
  input: Awaited<ReturnType<typeof harness>>,
  overrides: Partial<SubagentRequest> = {},
): SubagentRequest {
  return {
    kind: "napier.subagent-request",
    schemaVersion: 1,
    threadId: input.thread.id,
    runId: input.run.id,
    role: "researcher",
    description: "Inspect the supervised boundary",
    prompt: "Inspect the supervised boundary and return evidence.",
    ...overrides,
  };
}

function outcome(summary: string): string {
  return JSON.stringify({ summary, items: [], unknowns: [] });
}

describe("SubagentSupervisor", () => {
  it("delivers durable steering at the next assistant boundary", async () => {
    const input = await harness();
    input.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("list_files", { path: ".", depth: 0 }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Focus on the package boundary.",
        );
        return fauxAssistantMessage(outcome("Steering was applied safely."));
      },
    ]);

    const handle = await input.supervisor.start(request(input));
    await input.supervisor.send(handle, { text: "Focus on the package boundary." });
    const collected = await input.supervisor.collect(handle);
    const snapshot = await input.supervisor.inspect(handle);

    expect(collected.status).toBe("completed");
    expect(snapshot).toEqual(
      expect.objectContaining({
        status: "completed",
        taskStatus: "completed",
        mailbox: expect.objectContaining({
          acceptedCount: 1,
          deliveredCount: 1,
          pendingCount: 0,
        }),
      }),
    );
    expect(
      (await input.store.listEvents(input.thread.id)).map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "subagent.message.accepted",
        "subagent.message.delivered",
      ]),
    );
  });

  it("repairs and persists a caller-provided typed output once", async () => {
    const input = await harness();
    input.faux.setResponses([
      fauxAssistantMessage("not-json"),
      fauxAssistantMessage('{"answer":"repaired"}'),
    ]);
    const handle = await input.supervisor.start(
      request(input, {
        outputSchema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
          additionalProperties: false,
        },
      }),
    );

    const collected = await input.supervisor.collect(handle);

    expect(collected).toEqual(
      expect.objectContaining({
        status: "completed",
        output: { answer: "repaired" },
        outputSchemaSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        task: expect.objectContaining({
          supervisorStatus: "completed",
          turnCount: 2,
        }),
      }),
    );
    expect(
      (await input.store.listEvents(input.thread.id)).map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "subagent.output.repair.requested",
        "subagent.output.repair.outcome",
        "subagent.output.accepted",
      ]),
    );
  });

  it("uses a role-specific immutable child route plan", async () => {
    const input = await harness({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
    input.faux.setResponses([
      (_context, _options, _state, model) => {
        expect(model.id).toBe("faux-2");
        return fauxAssistantMessage(outcome("Role route selected."));
      },
    ]);
    const handle = await input.supervisor.start(
      request(input, {
        modelRoute: {
          subagentRoles: {
            researcher: {
              model: { provider: input.faux.provider.id, id: "faux-2" },
            },
          },
        },
      }),
    );

    const collected = await input.supervisor.collect(handle);
    const snapshot = await input.supervisor.inspect(handle);

    expect(collected.task.model.id).toBe("faux-2");
    expect(snapshot.routePlanId).toMatch(/^route_/u);
    const plan = (await input.store.listEvents(input.thread.id)).find(
      (event) => event.type === "route_plan_created",
    );
    expect(plan?.payload).toEqual(
      expect.objectContaining({ role: "subagent" }),
    );
  });

  it("cancels an active child and rejects a tampered handle", async () => {
    const input = await harness();
    input.faux.setResponses([
      fauxAssistantMessage(outcome("x".repeat(1_000))),
    ]);
    const handle = await input.supervisor.start(request(input));
    await expect(
      input.supervisor.inspect({ ...handle, executionId: "subexec_tampered" }),
    ).rejects.toThrow("binding is invalid");

    await input.supervisor.cancel(handle, "Parent no longer needs this work.");
    const collected = await input.supervisor.collect(handle);

    expect(collected.status).toBe("cancelled");
    expect(collected.task.stopReason).toBe("cancelled");
    expect(
      (await input.store.listEvents(input.thread.id)).map((event) => event.type),
    ).toContain("subagent.cancel.requested");
  });
});

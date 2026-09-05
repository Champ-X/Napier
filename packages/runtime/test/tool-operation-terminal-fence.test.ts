import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import { wrapAgentToolsWithLifecycle } from "../src/agent-runtime-step-lifecycle.js";
import { LocalStore } from "../src/index.js";
import { AgentLifecyclePipelineHost } from "../src/lifecycle-extension-pipeline.js";
import { LiveToolEffectAuthorityError } from "../src/sqlite-tool-effect-authority.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import {
  DurableToolOperationJournal,
  ToolOperationFencingError,
  type ToolOperationDescriptor,
  type ToolOperationJournalStore,
} from "../src/tool-operation-journal.js";
import { ToolProtocolRegistry } from "../src/tool-protocol-registry.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("tool operation terminal execution fence", () => {
  it("serializes terminal commit against a tool beyond its effect boundary", async () => {
    const fixture = await createFixture("effect-boundary-barrier");
    const terminalStore = await openStore(fixture.options);
    const enteredRawTool = deferred();
    const releaseRawEffect = deferred();
    let effectCount = 0;
    const raw: AgentTool = {
      name: "apply_patch",
      label: "apply_patch",
      description: "mutation fixture",
      parameters: Type.Object({}),
      execute: async () => {
        enteredRawTool.resolve();
        await releaseRawEffect.promise;
        effectCount += 1;
        return { content: [{ type: "text", text: "mutated" }], details: {} };
      },
    };
    const [wrapped] = wrapAgentToolsWithLifecycle({
      tools: [raw],
      registry: new ToolProtocolRegistry([raw]),
      lifecycles: new AgentLifecyclePipelineHost(),
      run: { id: fixture.runId, threadId: fixture.owner.threadId },
      stepIndex: () => 1,
      store: fixture.store,
      concurrencyGate: new ToolConcurrencyGate(),
    });
    const execution = wrapped!.execute("effect-boundary-call", {});
    await enteredRawTool.promise;

    await expect(
      terminalStore.finishRun(fixture.runId, "cancelled", {
        leaseToken: fixture.leaseToken,
        terminalEvent: {
          visibility: "debug",
          payload: { status: "cancelled" },
        },
      }),
    ).rejects.toBeInstanceOf(LiveToolEffectAuthorityError);
    expect(effectCount).toBe(0);
    expect(
      (await fixture.store.listRunEvents(fixture.runId)).some((event) =>
        ["run.cancelled", "run.completed", "run.failed"].includes(event.type),
      ),
    ).toBe(false);
    expect(
      terminalStore
        .listRuns(fixture.owner.threadId)
        .find((run) => run.id === fixture.runId)?.status,
    ).toBe("running");

    releaseRawEffect.resolve();
    await expect(execution).resolves.toEqual(
      expect.objectContaining({ content: [{ type: "text", text: "mutated" }] }),
    );
    await terminalStore.finishRun(fixture.runId, "cancelled", {
      leaseToken: fixture.leaseToken,
      terminalEvent: {
        visibility: "debug",
        payload: { status: "cancelled" },
      },
    });
    expect(effectCount).toBe(1);
  });

  it("checks the effect boundary before invoking the raw Agent tool", async () => {
    const fixture = await createFixture("agent-wrapper");
    let effectCount = 0;
    let terminalCommitted = false;
    const raw: AgentTool = {
      name: "apply_patch",
      label: "apply_patch",
      description: "mutation fixture",
      parameters: Type.Object({}),
      execute: async () => {
        effectCount += 1;
        return { content: [{ type: "text", text: "mutated" }], details: {} };
      },
    };
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
              await target.finishRun(fixture.runId, "cancelled", {
                leaseToken: fixture.leaseToken,
              });
            }
            return receipt;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const [wrapped] = wrapAgentToolsWithLifecycle({
      tools: [raw],
      registry: new ToolProtocolRegistry([raw]),
      lifecycles: new AgentLifecyclePipelineHost(),
      run: { id: fixture.runId, threadId: fixture.owner.threadId },
      stepIndex: () => 1,
      store: fencedStore,
      concurrencyGate: new ToolConcurrencyGate(),
    });

    await expect(
      wrapped!.execute("terminal-race-call", {}),
    ).rejects.toBeInstanceOf(ToolOperationFencingError);
    expect(effectCount).toBe(0);
  });

  it("prevents an effect after a started Run reaches terminal state", async () => {
    const fixture = await createFixture("same-store");
    const operation = createOperation(
      fixture.store,
      fixture.owner,
      "same-store-owner",
      30_000,
    );
    await operation.admit();
    await operation.started();
    await fixture.store.finishRun(fixture.runId, "cancelled", {
      leaseToken: fixture.leaseToken,
    });
    let effectCommitted = false;

    await expect(
      (async () => {
        await operation.effectBoundary();
        effectCommitted = true;
      })(),
    ).rejects.toBeInstanceOf(ToolOperationFencingError);
    expect(effectCommitted).toBe(false);
  });

  it("fences a stale owner when another Store commits the terminal", async () => {
    const fixture = await createFixture("multi-store");
    const stale = createOperation(
      fixture.store,
      fixture.owner,
      "stale-owner",
      30_000,
    );
    await stale.admit();
    await stale.started();
    const terminalStore = await openStore(fixture.options);
    await terminalStore.finishRun(fixture.runId, "interrupted", {
      leaseToken: fixture.leaseToken,
    });

    await expect(stale.effectBoundary()).rejects.toEqual(
      expect.objectContaining<ToolOperationFencingError>({
        name: "ToolOperationFencingError",
        operationId: stale.operationId,
      }),
    );
    expect(
      (await fixture.store.listRunEvents(fixture.runId)).filter(
        (event) => event.type === "tool.operation.lease.renewed",
      ),
    ).toHaveLength(0);
  });

  it("keeps an expired effect generation indeterminate until it settles", async () => {
    const fixture = await createFixture("expired-effect-boundary");
    let now = 1_000;
    const operation = createOperation(
      fixture.store,
      fixture.owner,
      "expired-effect-owner",
      10,
      () => now,
      "call_expired_effect",
    );
    await operation.admit();
    await operation.started();
    await operation.effectBoundary();
    now = 10_000;
    await delay(10);
    const terminalStore = await openStore(fixture.options);

    await expect(
      terminalStore.finishRun(fixture.runId, "interrupted", {
        leaseToken: fixture.leaseToken,
      }),
    ).rejects.toBeInstanceOf(LiveToolEffectAuthorityError);
    const replay = createOperation(
      terminalStore,
      fixture.owner,
      "takeover-owner",
      10,
      () => now,
      "call_expired_effect",
    );
    await expect(replay.admit()).resolves.toEqual(
      expect.objectContaining({
        admitted: false,
        disposition: "indeterminate_replay",
      }),
    );

    await operation.settled({
      outcome: "succeeded",
      effect: { mutation: "durably-observed" },
    });
    await terminalStore.finishRun(fixture.runId, "interrupted", {
      leaseToken: fixture.leaseToken,
    });
  });

  it("reopens an unresolved effect boundary as blocked-safety evidence", async () => {
    const fixture = await createFixture("effect-boundary-reopen");
    const operation = createOperation(
      fixture.store,
      fixture.owner,
      "crashed-effect-owner",
      30_000,
    );
    await operation.admit();
    await operation.started();
    await operation.effectBoundary();
    fixture.store.close();

    const reopened = await openStore(fixture.options, true);

    expect(
      reopened
        .listRuns(fixture.owner.threadId)
        .find((run) => run.id === fixture.runId),
    ).toEqual(
      expect.objectContaining({ status: "failed", outcome: "blocked_safety" }),
    );
    expect(reopened.getThread(fixture.owner.threadId).status).toBe("failed");
    const eventTypes = (await reopened.listRunEvents(fixture.runId)).map(
      (event) => event.type,
    );
    expect(eventTypes.slice(-2)).toEqual([
      "tool.operation.effect_indeterminate",
      "run.failed",
    ]);
    expect(eventTypes).not.toContain("run.interrupted");
  });

  it("stops scheduled heartbeats after observing a terminal Run", async () => {
    const fixture = await createFixture("heartbeat-stop");
    let observeHeartbeatReads = false;
    let heartbeatReads = 0;
    const observedStore: ToolOperationJournalStore = {
      appendEvent: (input) => fixture.store.appendEvent(input),
      appendEventOnceAtRunHead: (input, options) =>
        fixture.store.appendEventOnceAtRunHead(input, options),
      listRunEvents: async (runId, afterSeq, types) => {
        const events = await fixture.store.listRunEvents(
          runId,
          afterSeq,
          types,
        );
        if (observeHeartbeatReads) heartbeatReads += 1;
        return events;
      },
    };
    const operation = createOperation(
      observedStore,
      fixture.owner,
      "heartbeat-owner",
      30,
    );
    await operation.admit();
    await operation.started();
    observeHeartbeatReads = true;
    await fixture.store.finishRun(fixture.runId, "completed", {
      leaseToken: fixture.leaseToken,
    });

    await delay(80);
    expect(heartbeatReads).toBeGreaterThan(0);
    const stoppedAt = heartbeatReads;
    await delay(80);
    expect(heartbeatReads).toBe(stoppedAt);
  });
});

async function createFixture(label: string) {
  const root = await mkdtemp(
    path.join(tmpdir(), `napier-terminal-fence-${label}-`),
  );
  roots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const store = await openStore(options);
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: label, agentId: agent.id });
  const leased = await store.createLeasedRun(
    { threadId: thread.id, agentId: agent.id },
    { ownerId: `terminal-fence-${label}`, ttlMs: 30_000 },
  );
  return {
    store,
    options,
    owner: { threadId: thread.id, runId: leased.run.id },
    runId: leased.run.id,
    leaseToken: leased.token,
  };
}

async function openStore(
  options: {
    dataRoot: string;
    workspaceRoot: string;
  },
  interruptActiveRuns = false,
): Promise<LocalStore> {
  const store = new LocalStore(options);
  stores.push(store);
  await store.initialize(interruptActiveRuns);
  return store;
}

function createOperation(
  store: ToolOperationJournalStore,
  owner: { threadId: string; runId: string },
  ownerId: string,
  durationMs: number,
  now?: () => number,
  parentCallId = `call_${ownerId}`,
) {
  return new DurableToolOperationJournal(store, owner, {
    executionLease: { ownerId, durationMs },
    ...(now ? { now } : {}),
  })
    .observer(parentCallId)
    .operation(descriptor());
}

function descriptor(): ToolOperationDescriptor {
  return {
    role: "execution_authority",
    ordinal: 1,
    mode: "mutation",
    route: "fixture",
    operation: "mutate",
    scope: "workspace",
    contribution: "product",
    resourceKey: { workspace: "fixture" },
    failureDomainKey: { tool: "fixture" },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

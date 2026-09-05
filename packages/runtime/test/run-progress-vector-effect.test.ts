import { afterEach, describe, expect, it } from "vitest";

import { RunProgressTracker } from "../src/run-progress-vector.js";
import { ToolProtocolRegistry } from "../src/tool-protocol-registry.js";
import {
  cleanupProgressFixtures,
  createFixture,
  createRun,
  declaredTool,
  event,
  hash,
  productTurn,
  receipt,
  supportTurn,
  toolEvent,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);

describe("Run progress vector product effects", () => {
  it("separates product progress from unchanged turns", async () => {
    const fixture = await createFixture("product");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);

    await event(fixture.store, run, "turn.completed", {});
    const empty = await tracker.recordTurn();
    expect(empty.payload).toEqual(
      expect.objectContaining({
        kind: "napier.run-progress-vector",
        schemaVersion: 2,
        progressed: false,
        productProgressed: false,
        acceptanceProgressed: false,
        supportProgressed: false,
        stagnantTurnCount: 1,
      }),
    );

    const resource = hash("workspace:file.txt");
    await toolEvent(fixture.store, run, "tool.started", {
      callId: "write-1",
      toolName: "renamed_writer",
      progress: receipt("mutate", "product", resource),
    });
    await toolEvent(fixture.store, run, "tool.completed", {
      callId: "write-1",
      toolName: "renamed_writer",
      progress: receipt("mutate", "product", resource, hash("v1")),
    });
    await event(fixture.store, run, "turn.completed", {});
    const product = await tracker.recordTurn();
    expect(product.payload).toEqual(
      expect.objectContaining({
        progressed: true,
        productProgressed: true,
        changedDimensions: ["workspace"],
        workspaceMutationCount: 1,
        productCount: 1,
        firstWorkspaceMutationTurn: 2,
        stagnantTurnCount: 0,
      }),
    );

    await event(fixture.store, run, "turn.completed", {});
    expect((await tracker.recordTurn()).payload).toEqual(
      expect.objectContaining({
        progressed: false,
        workspaceMutationCount: 1,
        stagnantTurnCount: 1,
      }),
    );
    fixture.store.close();
  });

  it("closes only pure acquisition tools and reopens after product progress", async () => {
    const fixture = await createFixture("state-machine");
    const run = await createRun(fixture);
    const acquire = declaredTool("collector", ["acquire"]);
    const mutate = declaredTool("builder", ["mutate"]);
    const mixed = declaredTool("source_store", ["acquire", "reuse"]);
    const acquireAndDeliver = declaredTool(
      "artifact_downloader",
      ["acquire"],
      "download-origin",
      "product",
    );
    const registry = new ToolProtocolRegistry([
      acquire,
      mutate,
      mixed,
      acquireAndDeliver,
    ]);
    const tracker = await RunProgressTracker.create(
      fixture.store,
      run,
      undefined,
      {
        prompt: "opaque",
        toolNames: [
          acquire.name,
          mutate.name,
          mixed.name,
          acquireAndDeliver.name,
        ],
      },
      undefined,
      registry,
    );
    const resource = hash("same-support-resource");

    for (const [index, state] of ["a", "a", "b", "a", "a"].entries()) {
      await supportTurn(
        fixture.store,
        run,
        tracker,
        `support-${String(index)}`,
        acquire.name,
        resource,
        hash(state),
      );
    }

    expect(
      tracker
        .toolsForNextTurn([acquire, mutate, mixed, acquireAndDeliver])
        ?.map((tool) => tool.name),
    ).toEqual(["builder", "source_store", "artifact_downloader"]);
    await expect(
      tracker.preflightTool("blocked-acquire", acquire.name, {
        target: "https://example.test/new",
      }),
    ).resolves.toEqual(expect.objectContaining({ block: true }));
    await expect(
      tracker.preflightTool("allowed-mutation", mutate.name, {
        target: "artifact.txt",
      }),
    ).resolves.toBeUndefined();
    await expect(
      tracker.preflightTool(
        "allowed-acquire-and-deliver",
        acquireAndDeliver.name,
        {
          target: "https://example.test/asset.png",
        },
      ),
    ).resolves.toBeUndefined();

    const productResource = hash("artifact.txt");
    await toolEvent(fixture.store, run, "tool.started", {
      callId: "build-1",
      toolName: mutate.name,
      progress: receipt("mutate", "product", productResource),
    });
    await toolEvent(fixture.store, run, "tool.completed", {
      callId: "build-1",
      toolName: mutate.name,
      progress: receipt(
        "mutate",
        "product",
        productResource,
        hash("artifact-v1"),
      ),
    });
    await event(fixture.store, run, "turn.completed", {});
    expect((await tracker.recordTurn()).payload).toEqual(
      expect.objectContaining({
        productProgressed: true,
        acquisitionAttemptCountSinceProgress: 0,
        acquisitionAdvanceCountSinceProgress: 0,
      }),
    );
    await expect(
      tracker.preflightTool("reopened-acquire", acquire.name, {
        target: "https://example.test/new",
      }),
    ).resolves.toBeUndefined();
    expect(
      (await fixture.store.listRunEvents(run.id)).find(
        (candidate) => candidate.type === "run.progress.convergence_reopened",
      )?.payload,
    ).toEqual(expect.objectContaining({ reason: "product_progress" }));
    fixture.store.close();
  });

  it("lets explicit operator steering reopen acquisition", async () => {
    const fixture = await createFixture("operator-reopen");
    const run = await createRun(fixture);
    const acquire = declaredTool("collector", ["acquire"]);
    const registry = new ToolProtocolRegistry([acquire]);
    const tracker = await RunProgressTracker.create(
      fixture.store,
      run,
      undefined,
      { prompt: "opaque", toolNames: [acquire.name] },
      undefined,
      registry,
    );
    const resource = hash("operator-support");
    for (const [index, state] of ["a", "a", "b", "a", "a"].entries()) {
      await supportTurn(
        fixture.store,
        run,
        tracker,
        `operator-${String(index)}`,
        acquire.name,
        resource,
        hash(state),
      );
    }
    const steering = {
      role: "user" as const,
      content: "Please inspect one additional source.",
      timestamp: Date.now(),
    };
    await expect(
      tracker.steer(new Map(), async () => [steering]),
    ).resolves.toEqual([steering]);
    await expect(
      tracker.preflightTool("operator-acquire", acquire.name, {
        target: "https://example.test/extra",
      }),
    ).resolves.toBeUndefined();
    await supportTurn(
      fixture.store,
      run,
      tracker,
      "operator-extra",
      acquire.name,
      hash("operator-extra-resource"),
      hash("operator-extra-state"),
    );
    await expect(
      tracker.preflightTool("operator-acquire-again", acquire.name, {
        target: "https://example.test/another",
      }),
    ).resolves.toBeUndefined();
    expect(
      (await fixture.store.listRunEvents(run.id)).filter(
        (candidate) => candidate.type === "run.progress.convergence_requested",
      ),
    ).toHaveLength(1);
    expect(
      (await fixture.store.listRunEvents(run.id)).find(
        (candidate) => candidate.type === "run.progress.operator_epoch",
      )?.payload,
    ).toEqual(
      expect.objectContaining({ kind: "napier.run-progress-operator-epoch" }),
    );
    fixture.store.close();
  });

  it("replays an interrupted turn that has not yet produced its vector", async () => {
    const fixture = await createFixture("unprojected-turn");
    const run = await createRun(fixture);
    const initial = await RunProgressTracker.create(fixture.store, run);
    await event(fixture.store, run, "turn.completed", {});
    await initial.recordTurn();

    const resource = hash("interrupted-product");
    await toolEvent(fixture.store, run, "tool.started", {
      callId: "interrupted-write",
      toolName: "writer",
      progress: receipt("mutate", "product", resource),
    });
    await toolEvent(fixture.store, run, "tool.completed", {
      callId: "interrupted-write",
      toolName: "writer",
      progress: receipt(
        "mutate",
        "product",
        resource,
        hash("interrupted-product-v1"),
      ),
    });
    await event(fixture.store, run, "turn.completed", {});

    await RunProgressTracker.create(fixture.store, run);
    expect(
      (await fixture.store.listRunEvents(run.id))
        .filter((candidate) => candidate.type === "run.progress.vector")
        .at(-1)?.payload,
    ).toEqual(
      expect.objectContaining({
        turnIndex: 2,
        productProgressed: true,
        workspaceMutationCount: 1,
      }),
    );
    fixture.store.close();
  });

  it("reconciles recovery only after the complete persisted turn frontier", async () => {
    const fixture = await createFixture("complete-recovery-frontier");
    const run = await createRun(fixture);
    const initial = await RunProgressTracker.create(fixture.store, run);

    for (let turn = 0; turn < 6; turn += 1) {
      await event(fixture.store, run, "turn.completed", {});
      await initial.recordTurn();
    }
    await initial.steer(new Map(), async () => []);

    await event(fixture.store, run, "turn.completed", {});
    await event(fixture.store, run, "turn.completed", {});
    const resource = hash("recovery-frontier-product");
    await toolEvent(fixture.store, run, "tool.started", {
      callId: "recovery-frontier-write",
      toolName: "writer",
      progress: receipt("mutate", "product", resource),
    });
    await toolEvent(fixture.store, run, "tool.completed", {
      callId: "recovery-frontier-write",
      toolName: "writer",
      progress: receipt("mutate", "product", resource, hash("product-v1")),
    });
    await event(fixture.store, run, "turn.completed", {});

    await expect(
      RunProgressTracker.create(fixture.store, run),
    ).resolves.toBeDefined();
    const events = await fixture.store.listRunEvents(run.id);
    expect(
      events.filter((candidate) => candidate.type === "run.progress.vector"),
    ).toHaveLength(9);
    expect(
      events
        .filter((candidate) => candidate.type === "run.progress.vector")
        .at(-1)?.payload,
    ).toEqual(
      expect.objectContaining({
        turnIndex: 9,
        productProgressed: true,
        stagnantTurnCount: 0,
      }),
    );
    expect(
      events.some(
        (candidate) =>
          candidate.type === "run.progress.rerouted" &&
          candidate.payload["status"] === "halted",
      ),
    ).toBe(false);
    fixture.store.close();
  });

  it("records assistant output as a delivery attempt without accepting it", async () => {
    const fixture = await createFixture("delivery-attempt");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);

    await event(fixture.store, run, "message.assistant", {
      role: "assistant",
      text: "Here is the requested result.",
    });
    await event(fixture.store, run, "turn.completed", {});
    const vector = await tracker.recordTurn();

    expect(vector.payload).toEqual(
      expect.objectContaining({
        progressed: false,
        acceptanceProgressed: false,
        acceptanceCount: 0,
        userResultCount: 1,
        deliveryAttemptCount: 1,
        explicitAcceptanceCount: 0,
        deliveryReadiness: "no_product",
        stagnantTurnCount: 1,
      }),
    );
    fixture.store.close();
  });

  it("does not let A -> B -> C product effects reset stagnation indefinitely", async () => {
    const fixture = await createFixture("indeterminate-product-effects");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    const resource = hash("workspace:artifact.txt");

    const first = await productTurn(
      fixture.store,
      run,
      tracker,
      "write-a",
      resource,
      hash("A"),
    );
    expect(first.payload).toEqual(
      expect.objectContaining({
        progressed: true,
        productProgressed: true,
        productEffectCount: 1,
        indeterminateProductEffectCount: 1,
        stagnantTurnCount: 0,
      }),
    );

    const second = await productTurn(
      fixture.store,
      run,
      tracker,
      "write-b",
      resource,
      hash("B"),
    );
    expect(second.payload).toEqual(
      expect.objectContaining({
        progressed: false,
        productProgressed: false,
        productEffectCount: 2,
        marginalProductAdvancedCount: 0,
        indeterminateProductEffectCount: 2,
        unclassifiedActivityCountSinceProgress: 1,
        stagnantTurnCount: 1,
      }),
    );

    const third = await productTurn(
      fixture.store,
      run,
      tracker,
      "write-c",
      resource,
      hash("C"),
    );
    expect(third.payload).toEqual(
      expect.objectContaining({
        progressed: false,
        productProgressed: false,
        productEffectCount: 3,
        indeterminateProductEffectCount: 3,
        unclassifiedActivityCountSinceProgress: 2,
        stagnantTurnCount: 2,
      }),
    );
    fixture.store.close();
  });

  it("invalidates same-scope verification after a later product mutation", async () => {
    const fixture = await createFixture("stale-product-verification");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    const resource = hash("workspace:verified-artifact.txt");

    const created = await productTurn(
      fixture.store,
      run,
      tracker,
      "write-v1",
      resource,
      hash("artifact-v1"),
    );
    expect(created.payload).toEqual(
      expect.objectContaining({
        deliveryReadiness: "unverified",
        deliveryReadinessBlockerCount: 1,
      }),
    );

    await toolEvent(fixture.store, run, "tool.completed", {
      callId: "verify-v1",
      toolName: "renamed_workspace_verifier",
      progress: receipt(
        "verify",
        "verification",
        hash("workspace-verification"),
        hash("verification-v1"),
      ),
      details: { status: "passed" },
    });
    await event(fixture.store, run, "turn.completed", {});
    const verified = await tracker.recordTurn();
    expect(verified.payload).toEqual(
      expect.objectContaining({
        deliveryReadiness: "ready",
        deliveryReadinessBlockerCount: 0,
        progressed: true,
        acceptanceProgressed: true,
        acceptanceCount: 1,
        explicitAcceptanceCount: 0,
      }),
    );

    const changed = await productTurn(
      fixture.store,
      run,
      tracker,
      "write-v2",
      resource,
      hash("artifact-v2"),
    );
    expect(changed.payload).toEqual(
      expect.objectContaining({
        productProgressed: false,
        regressed: true,
        deliveryReadiness: "stale",
        deliveryReadinessBlockerCount: 1,
        indeterminateProductEffectCount: 2,
      }),
    );
    fixture.store.close();
  });

  it("keeps the deterministic no-progress finalizer as the hard fallback", async () => {
    const fixture = await createFixture("no-progress");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);

    for (let turn = 0; turn < 6; turn += 1) {
      await event(fixture.store, run, "turn.completed", {});
      await tracker.recordTurn();
    }
    const reroutes = (await fixture.store.listRunEvents(run.id)).filter(
      (candidate) => candidate.type === "run.progress.rerouted",
    );
    expect(reroutes).toHaveLength(1);
    expect(reroutes[0]!.payload).toEqual(
      expect.objectContaining({
        strategy: "summarize_and_converge",
        reason: "turns",
        turnIndex: 6,
      }),
    );
    await expect(
      tracker.steer(new Map(), async () => []),
    ).resolves.toHaveLength(1);
    await event(fixture.store, run, "turn.completed", {});
    await expect(tracker.recordTurn()).rejects.toThrow(
      "no measurable progress",
    );
    fixture.store.close();
  });

  it("resolves a pending no-progress reroute when a new declared product arrives", async () => {
    const fixture = await createFixture("no-progress-product");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);

    for (let turn = 0; turn < 6; turn += 1) {
      await event(fixture.store, run, "turn.completed", {});
      await tracker.recordTurn();
    }
    await tracker.steer(new Map(), async () => []);

    await toolEvent(fixture.store, run, "tool.completed", {
      callId: "run-local-product-1",
      toolName: "renamed_evidence_binder",
      progress: receipt(
        "mutate",
        "product",
        hash("claim-and-source-range"),
        hash("citation-token-v1"),
      ),
    });
    await event(fixture.store, run, "turn.completed", {});
    const vector = await tracker.recordTurn();

    expect(vector.payload).toEqual(
      expect.objectContaining({
        progressed: true,
        productProgressed: true,
        stagnantTurnCount: 0,
      }),
    );
    expect(
      (await fixture.store.listRunEvents(run.id)).some(
        (candidate) =>
          candidate.type === "run.progress.rerouted" &&
          candidate.payload["status"] === "resolved",
      ),
    ).toBe(true);
    fixture.store.close();
  });

  it("allows the reroute's terminal delivery without counting prose as product progress", async () => {
    const fixture = await createFixture("no-progress-delivery");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);

    for (let turn = 0; turn < 6; turn += 1) {
      await event(fixture.store, run, "turn.completed", {});
      await tracker.recordTurn();
    }
    await tracker.steer(new Map(), async () => []);
    await event(fixture.store, run, "message.assistant", {
      role: "assistant",
      text: "Here is the strongest concrete partial result.",
    });
    await event(fixture.store, run, "turn.completed", {});

    const vector = await tracker.recordTurn();
    expect(vector.payload).toEqual(
      expect.objectContaining({
        progressed: false,
        productProgressed: false,
        deliveryAttemptCount: 1,
      }),
    );
    expect(
      (await fixture.store.listRunEvents(run.id)).find(
        (candidate) =>
          candidate.type === "run.progress.rerouted" &&
          candidate.payload["status"] === "halted",
      ),
    ).toBeDefined();
    await expect(
      RunProgressTracker.create(fixture.store, run),
    ).resolves.toBeDefined();
    fixture.store.close();
  });
});

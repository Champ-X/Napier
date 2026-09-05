import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertRunEventAdmissionPartition,
  listRunEventSchemas,
  resolveCompatibilityEventInput,
  resolveExtensionEventInput,
  resolveRegisteredEventInput,
  type AppendCompatibilityEventInput,
  type AppendEventInput,
  type AppendExtensionEventInput,
} from "../src/run-event-registry.js";
import { LocalStore } from "../src/store.js";
import { createWorkspaceSeed } from "../src/workspace-seed.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run event registry", () => {
  it("materializes the onboarding seed through v1 schemas", () => {
    const seed = createWorkspaceSeed();

    expect(seed.events).toHaveLength(3);
    expect(seed.events.every((event) => event.schemaVersion === 1)).toBe(true);
    expect(seed.thread).toEqual(
      expect.objectContaining({
        eventCount: 3,
        lastMessage: expect.stringContaining("durable ledger"),
      }),
    );
  });

  it("publishes versioned category and visibility metadata", () => {
    const schemas = listRunEventSchemas();
    const message = schemas.find(
      (candidate) => candidate.type === "message.user",
    );
    const delta = schemas.find(
      (candidate) => candidate.type === "model.text.delta",
    );
    const progress = schemas.find(
      (candidate) => candidate.type === "run.progress.message",
    );
    const benchmark = schemas.find(
      (candidate) => candidate.type === "benchmark.workflow.evaluated",
    );
    const contextProjection = schemas.find(
      (candidate) => candidate.type === "context.projected",
    );
    const toolAdmission = schemas.find(
      (candidate) => candidate.type === "tool.admitted",
    );
    const toolSettlement = schemas.find(
      (candidate) => candidate.type === "tool.operation.settled",
    );
    const operatorEpoch = schemas.find(
      (candidate) => candidate.type === "run.progress.operator_epoch",
    );
    const controlDelivery = schemas.find(
      (candidate) => candidate.type === "run.control.delivered",
    );
    const browserApproval = schemas.find(
      (candidate) =>
        candidate.type === "browser.interaction_confirmation.approved",
    );
    const routeStart = schemas.find(
      (candidate) => candidate.type === "route_attempt_started",
    );
    const workflowStart = schemas.find(
      (candidate) => candidate.type === "workflow.node.started",
    );
    const localServiceGrant = schemas.find(
      (candidate) =>
        candidate.type === "workspace.process.local_service_lease.granted",
    );
    const localServiceRevocation = schemas.find(
      (candidate) =>
        candidate.type === "workspace.process.local_service_lease.revoked",
    );
    const operatorAnswer = schemas.find(
      (candidate) => candidate.type === "operator.decision.answered",
    );
    const operatorRequest = schemas.find(
      (candidate) => candidate.type === "operator.decision.requested",
    );
    const operatorContinuation = schemas.find(
      (candidate) => candidate.type === "operator.decision.continued",
    );

    expect(message).toEqual(
      expect.objectContaining({
        category: "message",
        defaultVisibility: "user",
        allowedVisibilities: ["user", "hidden"],
        schemaVersion: 1,
      }),
    );
    expect(delta).toEqual(
      expect.objectContaining({
        category: "model",
        defaultVisibility: "hidden",
        schemaVersion: 1,
      }),
    );
    expect(progress).toEqual(
      expect.objectContaining({
        category: "message",
        defaultVisibility: "user",
        owner: "run-progress",
        projectionOwner: "conversation-feed",
        schemaVersion: 1,
      }),
    );
    expect(benchmark).toEqual(
      expect.objectContaining({
        category: "evaluation",
        defaultVisibility: "user",
        owner: "benchmark-kit",
        projectionOwner: "validation-matrix",
        schemaVersion: 1,
      }),
    );
    expect(contextProjection).toEqual(
      expect.objectContaining({
        category: "model",
        defaultVisibility: "debug",
        owner: "model-runtime",
        projectionOwner: "trace-index",
        schemaVersion: 1,
      }),
    );
    expect(toolAdmission?.admission).toBe("run_active");
    expect(toolSettlement?.admission).toBe("run_any");
    expect(operatorEpoch?.admission).toBe("run_active");
    expect(controlDelivery?.admission).toBe("run_active");
    expect(browserApproval?.admission).toBe("run_active");
    expect(routeStart?.admission).toBe("run_active");
    expect(workflowStart?.admission).toBe("run_any");
    expect(localServiceGrant?.admission).toBe("run_active");
    expect(localServiceRevocation?.admission).toBe("run_any");
    expect(operatorRequest?.admission).toBe("run_active");
    expect(operatorAnswer?.admission).toBe("run_any");
    expect(operatorContinuation?.admission).toBe("run_any");
    expect(
      schemas.find((candidate) => candidate.type === "workspace.file.mutated")
        ?.admission,
    ).toBe("run_active");
    expect(
      schemas.find((candidate) => candidate.type === "workspace.file.recovered")
        ?.admission,
    ).toBe("run_any");
    for (const type of [
      "run.recovery.started",
      "model.advisor.correction.requested",
    ]) {
      expect(
        schemas.find((candidate) => candidate.type === type)?.admission,
      ).toBe("run_active");
    }
    for (const type of [
      "run.recovery.auto.claimed",
      "run.recovery.auto.started",
      "receipt.trust_rotation_proposal_approval_apply.queued",
      "receipt.trust_rotation_proposal_approval_policy_apply.queued",
      "schedule.claimed",
      "channel.delivery.started",
      "channel.delivery.retry.requested",
      "channel.delivery.retry.scheduled",
      "plan.replanned",
      "plan.step.reopened",
      "plan.step.started",
      "workflow.approval.requested",
      "workflow.breakpoint.continued",
      "workflow.experiment.started",
      "workflow.started",
      "workflow.node.input_replacement.requested",
      "workflow.node.simulation.requested",
    ]) {
      expect(
        schemas.find((candidate) => candidate.type === type)?.admission,
      ).toBe("run_any");
    }
    for (const type of [
      "run.completed",
      "run.failed",
      "run.cancelled",
      "run.interrupted",
    ]) {
      expect(
        schemas.find((candidate) => candidate.type === type)?.admission,
      ).toBe("terminal_transition");
    }
    expect(new Set(schemas.map((schema) => schema.type)).size).toBe(
      schemas.length,
    );
    (message!.allowedVisibilities as unknown as string[]).splice(0);
    expect(
      listRunEventSchemas().find((schema) => schema.type === "message.user")
        ?.allowedVisibilities,
    ).toEqual(["user", "hidden"]);
  });

  it("resolves registered events through their declared schema", () => {
    expect(
      resolveRegisteredEventInput({
        threadId: "thread_registry",
        runId: "run_registry",
        type: "message.user",
        category: "message",
        payload: { role: "user", text: "Hello" },
      }),
    ).toEqual({
      threadId: "thread_registry",
      runId: "run_registry",
      type: "message.user",
      category: "message",
      admission: "run_any",
      visibility: "user",
      payload: { role: "user", text: "Hello" },
      schemaVersion: 1,
    });
  });

  it("applies lifecycle admission from the event definition", () => {
    expect(
      resolveRegisteredEventInput({
        threadId: "thread_registry",
        runId: "run_registry",
        type: "tool.admitted",
        category: "tool",
        payload: { callId: "call_registry", toolName: "read_file" },
      }).admission,
    ).toBe("run_active");
    expect(
      resolveRegisteredEventInput({
        threadId: "thread_registry",
        runId: "run_registry",
        type: "tool.completed",
        category: "tool",
        payload: { callId: "call_registry", toolName: "read_file" },
      }).admission,
    ).toBe("run_any");
    expect(
      resolveRegisteredEventInput({
        threadId: "thread_registry",
        runId: "run_registry",
        type: "run.completed",
        category: "lifecycle",
        payload: { status: "completed" },
        admission: "run_active",
      }).admission,
    ).toBe("terminal_transition");
  });

  it("rejects incomplete or overlapping event admission partitions", () => {
    expect(() =>
      assertRunEventAdmissionPartition({
        types: ["authority.started", "authority.settled"],
        activeRunTypes: ["authority.started"],
        runAnyTypes: [],
        terminalTransitionTypes: [],
      }),
    ).toThrow("omits type: authority.settled");
    expect(() =>
      assertRunEventAdmissionPartition({
        types: ["authority.started"],
        activeRunTypes: ["authority.started"],
        runAnyTypes: ["authority.started"],
        terminalTransitionTypes: [],
      }),
    ).toThrow("overlaps: authority.started");
    expect(() =>
      assertRunEventAdmissionPartition({
        types: ["run.completed"],
        activeRunTypes: [],
        runAnyTypes: ["run.completed"],
        terminalTransitionTypes: ["run.completed"],
      }),
    ).toThrow("overlaps: run.completed");
  });

  it("validates the public progress-message privacy boundary", () => {
    const base: AppendEventInput<"run.progress.message"> = {
      threadId: "thread_registry",
      runId: "run_registry",
      type: "run.progress.message",
      category: "message",
      payload: {
        sourceEventId: "event_response",
        model: "napier/demo",
        toolNames: ["read_file"],
        contentRedacted: true,
      },
    };

    expect(resolveRegisteredEventInput(base)).toEqual(
      expect.objectContaining({ visibility: "user", payload: base.payload }),
    );
    expect(() =>
      resolveRegisteredEventInput({
        ...base,
        payload: { ...base.payload, text: "private source content" },
      }),
    ).toThrow("payload v1 is invalid");
    expect(() =>
      resolveRegisteredEventInput({
        ...base,
        payload: { ...base.payload, reasoning: "private reasoning" },
      }),
    ).toThrow("payload v1 is invalid");
    expect(() =>
      resolveRegisteredEventInput({
        ...base,
        payload: { ...base.payload, toolNames: [" "] },
      }),
    ).toThrow("payload v1 is invalid");
  });

  it.each([
    ["category", { category: "tool" }, "category must be message"],
    ["visibility", { visibility: "debug" }, "visibility is not registered"],
    ["schema", { schemaVersion: 2 }, "payload v2 is invalid"],
    ["payload", { payload: [] }, "payload v1 is invalid"],
    ["payload fields", { payload: {} }, "payload v1 is invalid"],
    [
      "nested payload",
      { payload: { role: "user", text: "Hello", invalid: undefined } },
      "payload v1 is invalid",
    ],
  ])(
    "rejects a registered event with an invalid %s",
    (_name, change, error) => {
      const input = {
        threadId: "thread_registry",
        runId: "run_registry",
        type: "message.user",
        category: "message",
        payload: { role: "user", text: "Hello" },
        ...change,
      } as unknown as AppendEventInput<"message.user">;

      expect(() => resolveRegisteredEventInput(input)).toThrow(error);
    },
  );

  it("accepts an owned, versioned extension namespace", () => {
    expect(
      resolveExtensionEventInput({
        threadId: "thread_registry",
        runId: "run_registry",
        type: "extension.acme.audit.recorded",
        category: "extension",
        payload: { result: "accepted" },
        schemaVersion: 3,
        extensionId: "acme",
      }),
    ).toEqual(
      expect.objectContaining({
        visibility: "debug",
        schemaVersion: 3,
      }),
    );
  });

  it.each([
    ["category", { category: "system" }, "category must be extension"],
    ["namespace", { type: "acme.audit" }, "identify its owner"],
    ["owner", { extensionId: "other" }, "does not match its owner"],
    ["schema", { schemaVersion: 0 }, "schemaVersion is invalid"],
    ["payload", { payload: Number.NaN }, "payload must be a JSON object"],
    ["visibility", { visibility: "private" }, "visibility is invalid"],
    ["payload", { payload: [] }, "payload must be a JSON object"],
  ])(
    "rejects an extension event with an invalid %s",
    (_name, change, error) => {
      const input = {
        threadId: "thread_registry",
        runId: "run_registry",
        type: "extension.acme.audit.recorded",
        category: "extension",
        payload: { result: "accepted" },
        schemaVersion: 1,
        extensionId: "acme",
        ...change,
      } as unknown as AppendExtensionEventInput;

      expect(() => resolveExtensionEventInput(input)).toThrow(error);
    },
  );

  it("accepts an explicit compatibility boundary", () => {
    expect(
      resolveCompatibilityEventInput({
        threadId: "thread_registry",
        runId: "run_registry",
        type: "legacy.event",
        category: "system",
        payload: null,
        compatibility: {
          boundary: "legacy_import",
          reason: "Import a pre-registry Ledger",
        },
      }),
    ).toEqual(
      expect.objectContaining({
        visibility: "debug",
        schemaVersion: 1,
      }),
    );
  });

  it.each([
    [
      "boundary",
      { compatibility: { boundary: "runtime", reason: "x" } },
      "boundary is invalid",
    ],
    [
      "reason",
      { compatibility: { boundary: "test_fixture", reason: "   " } },
      "reason is required",
    ],
    [
      "registered type",
      { type: "run.started" },
      "must use the typed append path",
    ],
    ["category", { category: "unknown" }, "category is invalid"],
    ["visibility", { visibility: "private" }, "visibility is invalid"],
    ["schema", { schemaVersion: 0 }, "schemaVersion is invalid"],
  ])(
    "rejects a compatibility event with an invalid %s",
    (_name, change, error) => {
      const input = {
        threadId: "thread_registry",
        runId: "run_registry",
        type: "legacy.event",
        category: "system",
        payload: null,
        compatibility: {
          boundary: "legacy_import",
          reason: "Import a pre-registry Ledger",
        },
        ...change,
      } as unknown as AppendCompatibilityEventInput;

      expect(() => resolveCompatibilityEventInput(input)).toThrow(error);
    },
  );

  it("persists resolved extension and compatibility events without reclassification", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-event-boundary-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    stores.push(store);
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Event boundary",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });

    const extension = await store.appendExtensionEvent({
      threadId: thread.id,
      runId: run.id,
      type: "extension.a.recorded",
      category: "extension",
      payload: { status: "accepted" },
      schemaVersion: 3,
      extensionId: "a",
    });
    const compatibility = await store.appendCompatibilityEvent({
      threadId: thread.id,
      runId: run.id,
      type: "legacy.scalar",
      category: "system",
      payload: 42,
      schemaVersion: 7,
      compatibility: {
        boundary: "legacy_import",
        reason: "Preserve a pre-registry scalar event",
      },
    });

    expect(extension).toEqual(
      expect.objectContaining({
        type: "extension.a.recorded",
        visibility: "debug",
        schemaVersion: 3,
      }),
    );
    expect(compatibility).toEqual(
      expect.objectContaining({ type: "legacy.scalar", schemaVersion: 7 }),
    );
    expect(
      (await store.listEvents(thread.id)).map((event) => event.type),
    ).toEqual(["extension.a.recorded", "legacy.scalar"]);
  });
});

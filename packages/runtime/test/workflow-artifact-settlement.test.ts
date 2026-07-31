import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  CreateExecutionPlanRequest,
  ExecutionPlanBlueprint,
  ExecutionPlanWorkflowManifest,
  WorkflowObjectSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { sha256 } from "../src/ed25519.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow Artifact settlement", () => {
  it("completes only after a real write Tool creates and verifies the declared file", async () => {
    const fixture = await createFixture([
      {
        id: "deliverable",
        path: "deliverable.txt",
        kind: "file",
        description: "The verified Tool deliverable.",
      },
    ]);
    const thread = fixture.store.getThread(fixture.targetThreadId);
    await fixture.store.updateAgent(thread.agentId, {
      toolPolicy: "workspace",
    });
    const content = "created by a policy-checked Workflow Tool\n";
    const manifest = patchWorkflowManifest(
      fixture.manifest.blueprint,
      "deliverable.txt",
      content,
    );

    const result = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Create the declared deliverable." },
      },
    });

    expect(result.status).toBe("completed");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "deliverable.txt"), "utf8"),
    ).resolves.toBe(content);
    expect(fixture.store.getPlan(result.planId).artifacts).toEqual([
      expect.objectContaining({
        id: "deliverable",
        status: "verified",
        sha256: sha256(content),
        sizeBytes: Buffer.byteLength(content),
      }),
    ]);
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "tool.completed",
        "plan.artifact.produced",
        "plan.artifact.verified",
        "workflow.artifacts.settled",
        "workflow.completed",
      ]),
    );
    const aggregate = JSON.stringify(
      events.filter((event) => event.type.startsWith("workflow.artifacts.")),
    );
    expect(aggregate).not.toContain("deliverable.txt");
    expect(aggregate).not.toContain(content.trim());
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");
    fixture.store.close();
  });

  it("rehashes current bytes after the produced transition", async () => {
    const fixture = await createFixture([
      {
        id: "report",
        path: "report.txt",
        kind: "file",
        description: "A report changed by an external writer.",
      },
    ]);
    const artifactPath = path.join(fixture.workspaceRoot, "report.txt");
    await writeFile(artifactPath, "first observation\n");
    fixture.provider.setResponses([fauxAssistantMessage('{"done":true}')]);
    const updatePlanArtifact = fixture.store.updatePlanArtifact.bind(
      fixture.store,
    );
    const finalBytes = "changed after produced\n";
    let replaced = false;
    fixture.store.updatePlanArtifact = async (planId, artifactId, request) => {
      const updated = await updatePlanArtifact(planId, artifactId, request);
      if (request.status === "produced" && !replaced) {
        replaced = true;
        await writeFile(artifactPath, finalBytes);
      }
      return updated;
    };

    const result = await runNew(fixture);

    expect(result.status).toBe("completed");
    expect(replaced).toBe(true);
    expect(fixture.store.getPlan(result.planId).artifacts[0]).toEqual(
      expect.objectContaining({
        status: "verified",
        sha256: sha256(finalBytes),
        sizeBytes: Buffer.byteLength(finalBytes),
      }),
    );
    fixture.store.close();
  });

  it("resumes missing and drifted artifacts without rerunning completed nodes", async () => {
    const fixture = await createFixture([
      {
        id: "report",
        path: "report.txt",
        kind: "file",
        description: "A report repaired outside the Workflow.",
      },
    ]);
    fixture.provider.setResponses([fauxAssistantMessage('{"done":true}')]);

    const blocked = await runNew(fixture);
    expect(blocked.status).toBe("blocked");
    expect(fixture.store.getPlan(blocked.planId).artifacts[0]).toEqual(
      expect.objectContaining({ status: "missing" }),
    );
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(1);

    const original = "repaired report\n";
    await writeFile(path.join(fixture.workspaceRoot, "report.txt"), original);
    await reopenFixture(fixture);
    const completed = await resume(fixture, blocked.planId);
    expect(completed.status).toBe("completed");
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(1);
    expect(fixture.store.getPlan(blocked.planId).artifacts[0]).toEqual(
      expect.objectContaining({
        status: "verified",
        sha256: sha256(original),
      }),
    );

    await writeFile(
      path.join(fixture.workspaceRoot, "report.txt"),
      "drifted report\n",
    );
    const drifted = await resume(fixture, blocked.planId);
    expect(drifted.status).toBe("blocked");
    expect(fixture.store.getPlan(blocked.planId).artifacts[0]).toEqual(
      expect.objectContaining({ status: "missing" }),
    );

    await writeFile(path.join(fixture.workspaceRoot, "report.txt"), original);
    const restored = await resume(fixture, blocked.planId);
    expect(restored.status).toBe("completed");
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(1);
    const artifactEvents = (
      await fixture.store.listEvents(fixture.targetThreadId)
    )
      .filter((event) => event.type.startsWith("plan.artifact."))
      .map((event) => event.type);
    expect(artifactEvents).toEqual([
      "plan.artifact.missing",
      "plan.artifact.produced",
      "plan.artifact.verified",
      "plan.artifact.missing",
      "plan.artifact.produced",
      "plan.artifact.verified",
    ]);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");
    fixture.store.close();
  });

  it("stops between Artifact state transitions when cancellation arrives", async () => {
    const fixture = await createFixture([
      {
        id: "report",
        path: "report.txt",
        kind: "file",
        description: "A cancellable report.",
      },
    ]);
    await writeFile(
      path.join(fixture.workspaceRoot, "report.txt"),
      "cancel after observation\n",
    );
    fixture.provider.setResponses([fauxAssistantMessage('{"done":true}')]);
    const controller = new AbortController();

    const cancelled = await fixture.workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest: fixture.manifest,
        input: { request: "Cancel during Artifact settlement." },
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "plan.artifact.produced") controller.abort();
      },
    });

    expect(cancelled.status).toBe("cancelled");
    expect(fixture.store.getPlan(cancelled.planId).artifacts[0]).toEqual(
      expect.objectContaining({ status: "produced" }),
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) => event.type === "plan.artifact.verified",
      ),
    ).toBe(false);

    const completed = await resume(fixture, cancelled.planId);
    expect(completed.status).toBe("completed");
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(1);
    fixture.store.close();
  });

  it("repairs a durable verified state when its standard event append failed", async () => {
    const fixture = await createFixture([
      {
        id: "report",
        path: "report.txt",
        kind: "file",
        description: "A report with an injected commit gap.",
      },
    ]);
    await writeFile(
      path.join(fixture.workspaceRoot, "report.txt"),
      "durable report\n",
    );
    fixture.provider.setResponses([fauxAssistantMessage('{"done":true}')]);
    const appendEvent = fixture.store.appendEvent.bind(fixture.store);
    let failVerifiedEvent = true;
    fixture.store.appendEvent = async (input) => {
      if (input.type === "plan.artifact.verified" && failVerifiedEvent) {
        failVerifiedEvent = false;
        throw new Error("Injected Artifact event commit gap");
      }
      return appendEvent(input);
    };

    const blocked = await runNew(fixture);
    expect(blocked.status).toBe("blocked");
    expect(fixture.store.getPlan(blocked.planId).artifacts[0]).toEqual(
      expect.objectContaining({ status: "verified" }),
    );

    fixture.store.appendEvent = appendEvent;
    const repaired = await resume(fixture, blocked.planId);
    expect(repaired.status).toBe("completed");
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).filter(
        (event) => event.type === "plan.artifact.verified",
      ),
    ).toHaveLength(1);
    expect(fixture.store.listRuns(fixture.targetThreadId)).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.targetThreadId),
      ).status,
    ).toBe("valid");
    fixture.store.close();
  });

  it("hashes directory contents and rejects a symlink-backed file", async () => {
    const directoryFixture = await createFixture([
      {
        id: "bundle",
        path: "bundle",
        kind: "directory",
        description: "A recursively verified directory.",
      },
    ]);
    await mkdir(path.join(directoryFixture.workspaceRoot, "bundle", "nested"), {
      recursive: true,
    });
    await writeFile(
      path.join(directoryFixture.workspaceRoot, "bundle", "a.txt"),
      "alpha\n",
    );
    await writeFile(
      path.join(directoryFixture.workspaceRoot, "bundle", "nested", "b.txt"),
      "beta\n",
    );
    directoryFixture.provider.setResponses([
      fauxAssistantMessage('{"done":true}'),
    ]);
    const directoryResult = await runNew(directoryFixture);
    expect(directoryResult.status).toBe("completed");
    expect(
      directoryFixture.store.getPlan(directoryResult.planId).artifacts[0],
    ).toEqual(
      expect.objectContaining({
        status: "verified",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sizeBytes: 11,
      }),
    );
    directoryFixture.store.close();

    const symlinkFixture = await createFixture([
      {
        id: "unsafe",
        path: "unsafe.txt",
        kind: "file",
        description: "A symlink-backed file that must be rejected.",
      },
    ]);
    const outside = path.join(symlinkFixture.root, "outside-secret.txt");
    await writeFile(outside, "PRIVATE_OUTSIDE_CONTENT\n");
    await symlink(
      outside,
      path.join(symlinkFixture.workspaceRoot, "unsafe.txt"),
    );
    symlinkFixture.provider.setResponses([
      fauxAssistantMessage('{"done":true}'),
    ]);
    const denied = await runNew(symlinkFixture);
    expect(denied.status).toBe("blocked");
    const events = await symlinkFixture.store.listEvents(
      symlinkFixture.targetThreadId,
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workflow.artifacts.failed",
          payload: expect.objectContaining({
            artifactId: "unsafe",
            errorCode: "scope_denied",
          }),
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("PRIVATE_OUTSIDE_CONTENT");
    symlinkFixture.store.close();
  });

  it("blocks a file above the bounded Artifact hashing limit", async () => {
    const fixture = await createFixture([
      {
        id: "oversized",
        path: "oversized.bin",
        kind: "file",
        description: "A file above the Artifact verification limit.",
      },
    ]);
    const handle = await open(
      path.join(fixture.workspaceRoot, "oversized.bin"),
      "w",
    );
    try {
      await handle.truncate(32 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    fixture.provider.setResponses([fauxAssistantMessage('{"done":true}')]);

    const blocked = await runNew(fixture);

    expect(blocked.status).toBe("blocked");
    expect(fixture.store.getPlan(blocked.planId).artifacts[0]).toEqual(
      expect.objectContaining({ status: "expected" }),
    );
    expect(
      (await fixture.store.listEvents(fixture.targetThreadId)).some(
        (event) =>
          event.type === "workflow.artifacts.failed" &&
          record(event.payload)?.["artifactId"] === "oversized" &&
          record(event.payload)?.["errorCode"] === "limit",
      ),
    ).toBe(true);
    fixture.store.close();
  });

  it("settles the same declared file independently for concurrent Threads", async () => {
    const fixture = await createFixture([
      {
        id: "shared",
        path: "shared.txt",
        kind: "file",
        description: "A shared read-only deliverable.",
      },
    ]);
    await writeFile(
      path.join(fixture.workspaceRoot, "shared.txt"),
      "shared bytes\n",
    );
    const sourceThread = fixture.store.listThreads()[0]!;
    const secondThread = await fixture.store.createThread({
      title: "Second Artifact Workflow",
      agentId: sourceThread.agentId,
    });
    fixture.provider.setResponses([
      fauxAssistantMessage('{"done":true}'),
      fauxAssistantMessage('{"done":true}'),
    ]);

    const [first, second] = await Promise.all([
      runNew(fixture),
      fixture.workflows.run({
        threadId: secondThread.id,
        request: {
          manifest: fixture.manifest,
          input: { request: "Settle the second Thread." },
        },
      }),
    ]);

    expect([first.status, second.status]).toEqual(["completed", "completed"]);
    expect(fixture.store.getPlan(first.planId).artifacts[0]?.status).toBe(
      "verified",
    );
    expect(fixture.store.getPlan(second.planId).artifacts[0]?.status).toBe(
      "verified",
    );
    fixture.store.close();
  });
});

interface Fixture {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
  store: LocalStore;
  provider: ReturnType<typeof fauxProvider>;
  workflows: ExecutionPlanWorkflowRuntime;
  targetThreadId: string;
  manifest: ExecutionPlanWorkflowManifest;
}

async function createFixture(
  artifacts: NonNullable<CreateExecutionPlanRequest["artifacts"]>,
): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-artifact-settlement-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot,
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Produce and verify the declared workspace Artifact.",
    steps: [
      {
        id: "deliver",
        title: "Deliver",
        description: "Produce the declared deliverable.",
        verification: "Return a typed completion receipt.",
      },
    ],
    artifacts,
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const targetThread = await store.createThread({
    title: "Artifact Workflow target",
    agentId: sourceThread.agentId,
  });
  const provider = fauxProvider({
    provider: "faux-workflow-artifact",
  });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const agentRuntime = new AgentRuntime(store, models);
  return {
    root,
    workspaceRoot,
    dataRoot,
    store,
    provider,
    workflows: new ExecutionPlanWorkflowRuntime(store, agentRuntime),
    targetThreadId: targetThread.id,
    manifest: agentWorkflowManifest(blueprint),
  };
}

async function reopenFixture(fixture: Fixture): Promise<void> {
  fixture.store.close();
  const store = new LocalStore({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: fixture.dataRoot,
  });
  await store.initialize();
  const models = new ModelRegistry();
  models.registerProvider(fixture.provider.provider);
  fixture.store = store;
  fixture.workflows = new ExecutionPlanWorkflowRuntime(
    store,
    new AgentRuntime(store, models),
  );
}

function agentWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
): ExecutionPlanWorkflowManifest {
  const outputSchema = doneSchema();
  return defineExecutionPlanWorkflow({
    name: "Artifact delivery",
    version: 1,
    description: "Complete one node and settle real workspace bytes.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema,
    outputNodeId: "deliver",
    nodes: [
      {
        id: "deliver",
        type: "agent",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: {
          type: "object",
          properties: { workflow: requestSchema() },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema,
        model: { provider: "faux-workflow-artifact", id: "faux-1" },
        timeoutMs: 5_000,
        maxAttempts: 1,
      },
    ],
  });
}

function patchWorkflowManifest(
  blueprint: ExecutionPlanBlueprint,
  artifactPath: string,
  content: string,
): ExecutionPlanWorkflowManifest {
  const outputSchema = workspacePatchReceiptSchema();
  return defineExecutionPlanWorkflow({
    name: "Artifact Tool delivery",
    version: 1,
    description: "Write and settle one real workspace file.",
    blueprint,
    inputSchema: requestSchema(),
    outputSchema,
    outputNodeId: "deliver",
    nodes: [
      {
        id: "deliver",
        type: "tool",
        tool: "apply_patch",
        effect: "write",
        inputBindings: {
          operation: { source: "literal", value: "create" },
          path: { source: "literal", value: artifactPath },
          expectedSha256: { source: "literal", value: null },
          content: { source: "literal", value: content },
        },
        inputSchema: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["create"] },
            path: { type: "string", minLength: 1, maxLength: 200 },
            expectedSha256: { type: "null" },
            content: { type: "string", minLength: 1, maxLength: 500 },
          },
          required: ["operation", "path", "expectedSha256", "content"],
          additionalProperties: false,
        },
        outputSchema,
        timeoutMs: 5_000,
        maxAttempts: 1,
      },
    ],
  });
}

async function runNew(fixture: Fixture) {
  return fixture.workflows.run({
    threadId: fixture.targetThreadId,
    request: {
      manifest: fixture.manifest,
      input: { request: "Settle the declared Artifact." },
    },
  });
}

async function resume(fixture: Fixture, planId: string) {
  return fixture.workflows.run({
    threadId: fixture.targetThreadId,
    request: {
      manifest: fixture.manifest,
      planId,
    },
  });
}

function requestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 500 },
    },
    required: ["request"],
    additionalProperties: false,
  };
}

function doneSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      done: { type: "boolean" },
    },
    required: ["done"],
    additionalProperties: false,
  };
}

function workspacePatchReceiptSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["napier.workspace-patch"] },
      schemaVersion: { type: "integer", minimum: 1, maximum: 1 },
      pathSha256: { type: "string", minLength: 64, maxLength: 64 },
      operation: { type: "string", enum: ["create"] },
      beforeSha256: { type: "null" },
      afterSha256: { type: "string", minLength: 64, maxLength: 64 },
      beforeBytes: { type: "integer", minimum: 0 },
      afterBytes: { type: "integer", minimum: 0 },
      editCount: { type: "integer", minimum: 0 },
      resultSha256: { type: "string", minLength: 64, maxLength: 64 },
    },
    required: [
      "kind",
      "schemaVersion",
      "pathSha256",
      "operation",
      "beforeSha256",
      "afterSha256",
      "beforeBytes",
      "afterBytes",
      "editCount",
      "resultSha256",
    ],
    additionalProperties: false,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

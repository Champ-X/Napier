import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { WorkflowObjectSchema } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { sha256 } from "../src/ed25519.js";
import { ModelRegistry } from "../src/models.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow DataFrame Tool node", () => {
  it("passes only a typed hash receipt for a real transformation", async () => {
    const fixture = await createFixture();
    const manifest = defineExecutionPlanWorkflow({
      name: "Bounded DataFrame",
      version: 1,
      description: "Transform one bound JSON table.",
      blueprint: fixture.blueprint,
      inputSchema: requestSchema(),
      outputSchema: receiptSchema(),
      outputNodeId: "transform",
      maxConcurrency: 1,
      nodes: [
        {
          id: "transform",
          type: "tool",
          tool: "data_frame",
          effect: "read",
          inputBindings: {
            action: { source: "literal", value: "transform" },
            path: { source: "literal", value: "PRIVATE_TABLE.json" },
            sourceSha256: {
              source: "literal",
              value: fixture.sourceSha256,
            },
            operations: {
              source: "literal",
              value: [{ type: "limit", count: 2 }],
            },
          },
          inputSchema: dataFrameInputSchema(),
          outputSchema: receiptSchema(),
          timeoutMs: 5_000,
          maxAttempts: 1,
        },
      ],
    });
    const workflows = new ExecutionPlanWorkflowRuntime(
      fixture.store,
      new AgentRuntime(fixture.store, new ModelRegistry()),
    );

    const result = await workflows.run({
      threadId: fixture.targetThreadId,
      request: {
        manifest,
        input: { request: "Transform the table." },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual(
      expect.objectContaining({
        kind: "napier.data-frame",
        schemaVersion: 1,
        action: "transform",
        sourceSha256: fixture.sourceSha256,
        operationCount: 1,
        rowCount: 2,
        columnCount: 2,
        planSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        rowsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const events = await fixture.store.listEvents(fixture.targetThreadId);
    const toolEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "data_frame",
    );
    const durable = JSON.stringify(toolEvent);
    for (const secret of [
      "PRIVATE_TABLE",
      "PRIVATE_NAME",
      "PRIVATE_SCORE",
      "Ada",
      "Linus",
      "Grace",
    ]) {
      expect(durable).not.toContain(secret);
    }
    fixture.store.close();
  });
});

async function createFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-data-frame-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const source = JSON.stringify([
    { PRIVATE_NAME: "Ada", PRIVATE_SCORE: 98 },
    { PRIVATE_NAME: "Linus", PRIVATE_SCORE: 87 },
    { PRIVATE_NAME: "Grace", PRIVATE_SCORE: 95 },
  ]);
  await writeFile(path.join(workspaceRoot, "PRIVATE_TABLE.json"), source);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  const sourcePlan = await store.createPlan(sourceThread.id, {
    objective: "Transform one DataFrame.",
    steps: [
      {
        id: "transform",
        title: "Transform",
        description: "Run a bounded DataFrame operation.",
        verification: "Return a typed hash-only receipt.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    sourcePlan.id,
  );
  const targetThread = await store.createThread({
    title: "DataFrame Workflow target",
    agentId: sourceThread.agentId,
  });
  return {
    store,
    blueprint,
    targetThreadId: targetThread.id,
    sourceSha256: sha256(source),
  };
}

function requestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      request: { type: "string", minLength: 1, maxLength: 100 },
    },
    required: ["request"],
    additionalProperties: false,
  };
}

function dataFrameInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["transform"] },
      path: { type: "string", minLength: 1, maxLength: 500 },
      sourceSha256: { type: "string", minLength: 64, maxLength: 64 },
      operations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["limit"] },
            count: { type: "integer", minimum: 1, maximum: 1_000 },
          },
          required: ["type", "count"],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: 1,
      },
    },
    required: ["action", "path", "sourceSha256", "operations"],
    additionalProperties: false,
  };
}

function receiptSchema(): WorkflowObjectSchema {
  const hash = { type: "string" as const, minLength: 64, maxLength: 64 };
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["napier.data-frame"] },
      schemaVersion: { type: "integer", minimum: 1, maximum: 1 },
      action: { type: "string", enum: ["transform"] },
      sourcePathSha256: hash,
      sourceSha256: hash,
      sourceBytes: { type: "integer", minimum: 0, maximum: 2 * 1024 * 1024 },
      sourceFormat: { type: "string", enum: ["json"] },
      sourceRowCount: { type: "integer", minimum: 0, maximum: 10_000 },
      sourceColumnCount: { type: "integer", minimum: 0, maximum: 80 },
      operationCount: { type: "integer", minimum: 1, maximum: 12 },
      planSha256: hash,
      rowCount: { type: "integer", minimum: 0, maximum: 1_000 },
      columnCount: { type: "integer", minimum: 0, maximum: 80 },
      columnsSha256: hash,
      rowsSha256: hash,
      outputSha256: hash,
      outputBytes: { type: "integer", minimum: 1, maximum: 256 * 1024 },
      parserSha256: hash,
      engineSha256: hash,
      limitsSha256: hash,
      resultSha256: hash,
    },
    required: [
      "kind",
      "schemaVersion",
      "action",
      "sourcePathSha256",
      "sourceSha256",
      "sourceBytes",
      "sourceFormat",
      "sourceRowCount",
      "sourceColumnCount",
      "operationCount",
      "planSha256",
      "rowCount",
      "columnCount",
      "columnsSha256",
      "rowsSha256",
      "outputSha256",
      "outputBytes",
      "parserSha256",
      "engineSha256",
      "limitsSha256",
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

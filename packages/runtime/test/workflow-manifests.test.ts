import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  CreateExecutionPlanRequest,
  ExecutionPlanBlueprint,
  WorkflowObjectSchema,
  WorkflowValueSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import {
  assertWorkflowValue,
  buildExecutionPlanWorkflowNodeInput,
  defineExecutionPlanWorkflow,
  parseExecutionPlanWorkflowNodeOutput,
  validateExecutionPlanWorkflowManifest,
  verifyExecutionPlanWorkflowManifest,
  workflowSchemaSha256,
} from "../src/workflow-manifests.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Execution Plan Workflow manifests", () => {
  it("defines a hash-bound typed Agent DAG over an existing Blueprint", async () => {
    const blueprint = await createBlueprint();
    const manifest = defineExecutionPlanWorkflow({
      name: "Typed report",
      version: 1,
      description: "Inspect input and produce one typed report.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema: reportSchema(),
      outputNodeId: "report",
      nodes: workflowNodes(),
      generatedAt: "2026-07-30T00:00:00.000Z",
    });

    expect(validateExecutionPlanWorkflowManifest(manifest)).toEqual(manifest);
    expect(verifyExecutionPlanWorkflowManifest(manifest)).toEqual({
      status: "valid",
      diagnostics: [],
      nodeCount: 2,
      contentSha256: manifest.contentSha256,
      blueprintSha256: blueprint.contentSha256,
      inputSchemaSha256: workflowSchemaSha256(requestSchema()),
      outputSchemaSha256: workflowSchemaSha256(reportSchema()),
    });
    expect(manifest.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.nodes.map((node) => node.id)).toEqual([
      "inspect",
      "report",
    ]);

    const workflowInput = { request: "Summarize three findings." };
    assertWorkflowValue(manifest.inputSchema, workflowInput, "Workflow input");
    const inspected = { summary: "Three findings", count: 3 };
    const inspectInput = buildExecutionPlanWorkflowNodeInput(
      manifest.nodes[0]!,
      workflowInput,
      new Map(),
    );
    expect(inspectInput).toEqual({ workflow: workflowInput });
    const reportInput = buildExecutionPlanWorkflowNodeInput(
      manifest.nodes[1]!,
      workflowInput,
      new Map([["inspect", inspected]]),
    );
    expect(reportInput).toEqual({
      workflow: workflowInput,
      inspection: inspected,
    });
    expect(
      parseExecutionPlanWorkflowNodeOutput(
        '{"report":"Ready","approved":true}',
        manifest.outputSchema,
      ),
    ).toEqual({ report: "Ready", approved: true });
  });

  it("rejects drift, unsupported schemas, invalid bindings, and untyped output", async () => {
    const blueprint = await createBlueprint();
    const valid = defineExecutionPlanWorkflow({
      name: "Typed report",
      version: 1,
      description: "Inspect input and produce one typed report.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema: reportSchema(),
      outputNodeId: "report",
      nodes: workflowNodes(),
      generatedAt: "2026-07-30T00:00:00.000Z",
    });

    expect(
      verifyExecutionPlanWorkflowManifest({
        ...valid,
        description: "Drifted",
      }),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["Workflow manifest content hash mismatch"],
      }),
    );
    expect(() =>
      defineExecutionPlanWorkflow({
        name: "Bad binding",
        version: 1,
        description: "Bind a node outside the direct dependency set.",
        blueprint,
        inputSchema: requestSchema(),
        outputSchema: reportSchema(),
        outputNodeId: "report",
        nodes: [
          workflowNodes()[0]!,
          {
            ...workflowNodes()[1]!,
            inputBindings: {
              workflow: { source: "workflow" },
              inspection: { source: "node", nodeId: "report" },
            },
          },
        ],
      }),
    ).toThrow("direct dependency");
    expect(() =>
      defineExecutionPlanWorkflow({
        name: "Bad output",
        version: 1,
        description: "Use a non-terminal output node.",
        blueprint,
        inputSchema: requestSchema(),
        outputSchema: inspectionSchema(),
        outputNodeId: "inspect",
        nodes: workflowNodes(),
      }),
    ).toThrow("terminal");
    expect(() =>
      defineExecutionPlanWorkflow({
        name: "Unknown schema",
        version: 1,
        description: "Reject unsupported schema execution.",
        blueprint,
        inputSchema: {
          ...requestSchema(),
          patternProperties: {},
        } as unknown as WorkflowValueSchema,
        outputSchema: reportSchema(),
        outputNodeId: "report",
        nodes: workflowNodes(),
      }),
    ).toThrow("fields are invalid");
    expect(() =>
      parseExecutionPlanWorkflowNodeOutput("```json\n{}\n```", reportSchema()),
    ).toThrow("strict JSON");
    expect(() =>
      parseExecutionPlanWorkflowNodeOutput(
        '{"report":"Ready","approved":"yes"}',
        reportSchema(),
      ),
    ).toThrow("does not match");
  });

  it("keeps artifact settlement outside v1 instead of falsely completing it", async () => {
    const blueprint = await createBlueprint(
      [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect the input.",
          verification: "Return typed inspection JSON.",
        },
      ],
      [
        {
          id: "report-file",
          path: "report.json",
          description: "A report file.",
        },
      ],
    );

    expect(() =>
      defineExecutionPlanWorkflow({
        name: "Artifact workflow",
        version: 1,
        description: "Artifact settlement is not implemented in v1.",
        blueprint,
        inputSchema: requestSchema(),
        outputSchema: inspectionSchema(),
        outputNodeId: "inspect",
        nodes: [workflowNodes()[0]!],
      }),
    ).toThrow("without artifact settlement");
  });
});

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

function inspectionSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 500 },
      count: { type: "integer", minimum: 0, maximum: 20 },
    },
    required: ["summary", "count"],
    additionalProperties: false,
  };
}

function reportSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      report: { type: "string", minLength: 1, maxLength: 1_000 },
      approved: { type: "boolean" },
    },
    required: ["report", "approved"],
    additionalProperties: false,
  };
}

function workflowNodes() {
  return [
    {
      id: "inspect",
      type: "agent" as const,
      inputBindings: {
        workflow: { source: "workflow" as const },
      },
      inputSchema: {
        type: "object" as const,
        properties: { workflow: requestSchema() },
        required: ["workflow"],
        additionalProperties: false as const,
      },
      outputSchema: inspectionSchema(),
      model: { provider: "faux-workflow", id: "faux-1" },
      timeoutMs: 5_000,
      maxAttempts: 2,
    },
    {
      id: "report",
      type: "agent" as const,
      inputBindings: {
        workflow: { source: "workflow" as const },
        inspection: { source: "node" as const, nodeId: "inspect" },
      },
      inputSchema: {
        type: "object" as const,
        properties: {
          workflow: requestSchema(),
          inspection: inspectionSchema(),
        },
        required: ["workflow", "inspection"],
        additionalProperties: false as const,
      },
      outputSchema: reportSchema(),
      model: { provider: "faux-workflow", id: "faux-1" },
      timeoutMs: 5_000,
      maxAttempts: 2,
    },
  ];
}

async function createBlueprint(
  steps: CreateExecutionPlanRequest["steps"] = [
    {
      id: "inspect",
      title: "Inspect",
      description: "Inspect the workflow input.",
      verification: "Return typed inspection JSON.",
    },
    {
      id: "report",
      title: "Report",
      description: "Produce the final report from inspected evidence.",
      verification: "Return typed report JSON.",
      dependsOn: ["inspect"],
    },
  ],
  artifacts?: CreateExecutionPlanRequest["artifacts"],
): Promise<ExecutionPlanBlueprint> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-manifest-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const thread = store.listThreads()[0]!;
  const plan = await store.createPlan(thread.id, {
    objective: "Create a typed report.",
    steps,
    ...(artifacts ? { artifacts } : {}),
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    thread.id,
    plan.id,
  );
  store.close();
  return blueprint;
}

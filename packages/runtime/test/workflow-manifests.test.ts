import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA } from "@napier/contracts";
import type {
  CreateExecutionPlanRequest,
  ExecutionPlanBlueprint,
  WorkflowObjectSchema,
  WorkflowValueSchema,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { executeExecutionPlanWorkflowDeterministicTemplate } from "../src/workflow-deterministic-model.js";
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
      maxConcurrency: 2,
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
    expect(manifest.maxConcurrency).toBe(2);

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

  it("validates bounded Loop termination and iteration budgets", async () => {
    const blueprint = await createBlueprint([
      {
        id: "refine",
        title: "Refine",
        description: "Refine one typed result until it is complete.",
        verification: "The final output reports done.",
      },
    ]);
    const loopNode = {
      id: "refine",
      type: "loop" as const,
      inputBindings: {
        workflow: { source: "workflow" as const },
      },
      inputSchema: {
        type: "object" as const,
        properties: { workflow: requestSchema() },
        required: ["workflow"],
        additionalProperties: false as const,
      },
      outputSchema: {
        type: "object" as const,
        properties: {
          done: { type: "boolean" as const },
          value: { type: "integer" as const, minimum: 0, maximum: 8 },
        },
        required: ["done", "value"],
        additionalProperties: false as const,
      },
      until: { path: ["done"], equals: true },
      model: { provider: "faux-workflow", id: "faux-1" },
      maxIterations: 3,
      iterationTimeoutMs: 2_000,
      timeoutMs: 10_000,
      maxAttempts: 2,
    };
    const definition = {
      name: "Bounded refinement",
      version: 1,
      description: "Iterate one read-only Agent result.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema: loopNode.outputSchema,
      outputNodeId: "refine",
      nodes: [loopNode],
    };
    const manifest = defineExecutionPlanWorkflow(definition);
    expect(validateExecutionPlanWorkflowManifest(manifest)).toEqual(manifest);

    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [{ ...loopNode, maxIterations: 9 }],
      }),
    ).toThrow("maxIterations");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...loopNode,
            until: { path: ["missing"], equals: true },
          },
        ],
      }),
    ).toThrow("path does not match");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...loopNode,
            timeoutMs: 1_000,
            iterationTimeoutMs: 2_000,
          },
        ],
      }),
    ).toThrow("must cover iterationTimeoutMs");
  });

  it("binds typed conditional paths and fallback output without expressions", async () => {
    const blueprint = await createBlueprint();
    const nodes = workflowNodes();
    nodes[0] = {
      ...nodes[0]!,
      when: {
        path: ["workflow", "request"],
        equals: "skip",
      },
      skipOutput: { summary: "Skipped inspection", count: 0 },
    };
    const definition = {
      name: "Conditional report",
      version: 1,
      description: "Skip one typed node from its validated input.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema: reportSchema(),
      outputNodeId: "report",
      nodes,
    };
    const manifest = defineExecutionPlanWorkflow(definition);
    expect(validateExecutionPlanWorkflowManifest(manifest)).toEqual(manifest);

    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...nodes[0]!,
            skipOutput: undefined,
          },
          nodes[1]!,
        ],
      }),
    ).toThrow("requires skipOutput");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...nodes[0]!,
            when: { path: ["workflow", "missing"], equals: "skip" },
          },
          nodes[1]!,
        ],
      }),
    ).toThrow("does not match the input schema");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...nodes[0]!,
            when: { path: ["workflow", "request"], equals: false },
          },
          nodes[1]!,
        ],
      }),
    ).toThrow("does not match its schema");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...nodes[0]!,
            when: {
              path: ["workflow", "constructor"],
              equals: "skip",
            },
          },
          nodes[1]!,
        ],
      }),
    ).toThrow("path segment is invalid");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...nodes[0]!,
            skipOutput: { summary: "Invalid count", count: "zero" },
          },
          nodes[1]!,
        ] as typeof nodes,
      }),
    ).toThrow("does not match its schema");
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
        name: "Invalid parallelism",
        version: 1,
        description: "Reject an unbounded Workflow batch.",
        blueprint,
        inputSchema: requestSchema(),
        outputSchema: reportSchema(),
        outputNodeId: "report",
        nodes: workflowNodes(),
        maxConcurrency: 5,
      }),
    ).toThrow("maxConcurrency");
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

  it("defines Tool nodes with literal and field-path bindings", async () => {
    const blueprint = await createBlueprint([
      {
        id: "inventory",
        title: "Inventory",
        description: "List one selected workspace directory.",
        verification: "Return a typed list-files receipt.",
      },
    ]);
    const outputSchema = listFilesReceiptSchema();
    const manifest = defineExecutionPlanWorkflow({
      name: "Workspace inventory",
      version: 1,
      description: "Run one model-free workspace tool node.",
      blueprint,
      inputSchema: {
        type: "object",
        properties: {
          request: {
            type: "object",
            properties: {
              directory: { type: "string", minLength: 1, maxLength: 200 },
            },
            required: ["directory"],
            additionalProperties: false,
          },
        },
        required: ["request"],
        additionalProperties: false,
      },
      outputSchema,
      outputNodeId: "inventory",
      nodes: [
        {
          id: "inventory",
          type: "tool",
          tool: "list_files",
          effect: "read",
          inputBindings: {
            path: {
              source: "workflow",
              path: ["request", "directory"],
            },
            depth: { source: "literal", value: 2 },
          },
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", minLength: 1, maxLength: 200 },
              depth: { type: "integer", minimum: 0, maximum: 4 },
            },
            required: ["path", "depth"],
            additionalProperties: false,
          },
          outputSchema,
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
      generatedAt: "2026-07-31T00:00:00.000Z",
    });

    expect(validateExecutionPlanWorkflowManifest(manifest)).toEqual(manifest);
    expect(
      buildExecutionPlanWorkflowNodeInput(
        manifest.nodes[0]!,
        { request: { directory: "src" } },
        new Map(),
      ),
    ).toEqual({ path: "src", depth: 2 });

    expect(() =>
      defineExecutionPlanWorkflow({
        ...manifest,
        nodes: [
          {
            ...manifest.nodes[0]!,
            inputBindings: {
              path: {
                source: "workflow",
                path: ["__proto__"],
              },
              depth: { source: "literal", value: 2 },
            },
          },
        ],
      }),
    ).toThrow("path segment is invalid");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...manifest,
        nodes: [
          {
            ...manifest.nodes[0]!,
            tool: "javascript_kernel",
          },
        ] as typeof manifest.nodes,
      }),
    ).toThrow("tool contract is invalid");
  });

  it("defines bounded recursive Deterministic templates without expressions", async () => {
    const blueprint = await createBlueprint([
      {
        id: "shape",
        title: "Shape",
        description: "Build one deterministic typed value.",
        verification: "Return the projected JSON value.",
      },
    ]);
    const outputSchema = deterministicOutputSchema();
    const definition = {
      name: "Deterministic projection",
      version: 1,
      description: "Project typed input without a model or tool.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema,
      outputNodeId: "shape",
      nodes: [
        {
          id: "shape",
          type: "deterministic" as const,
          inputBindings: {
            workflow: { source: "workflow" as const },
          },
          inputSchema: {
            type: "object" as const,
            properties: { workflow: requestSchema() },
            required: ["workflow"],
            additionalProperties: false as const,
          },
          outputSchema,
          template: {
            kind: "object" as const,
            properties: {
              selected: {
                kind: "input" as const,
                path: ["workflow", "request"],
              },
              meta: {
                kind: "object" as const,
                properties: {
                  source: {
                    kind: "literal" as const,
                    value: "deterministic",
                  },
                  flags: {
                    kind: "array" as const,
                    items: [
                      { kind: "literal" as const, value: true },
                      { kind: "literal" as const, value: false },
                    ],
                  },
                },
              },
            },
          },
          timeoutMs: 5_000,
          maxAttempts: 2,
        },
      ],
    };
    const manifest = defineExecutionPlanWorkflow(definition);
    expect(validateExecutionPlanWorkflowManifest(manifest)).toEqual(manifest);
    const node = manifest.nodes[0]!;
    expect(node.type).toBe("deterministic");
    if (node.type !== "deterministic") throw new Error("Unexpected node type");
    expect(
      executeExecutionPlanWorkflowDeterministicTemplate(node.template, {
        workflow: { request: "ship" },
      }),
    ).toEqual({
      selected: "ship",
      meta: { source: "deterministic", flags: [true, false] },
    });

    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...definition.nodes[0]!,
            template: {
              kind: "input",
              path: ["workflow", "__proto__"],
            },
          },
        ],
      }),
    ).toThrow("path segment is invalid");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...definition.nodes[0]!,
            template: {
              kind: "javascript",
              source: "return input",
            },
          },
        ] as typeof definition.nodes,
      }),
    ).toThrow("kind is unsupported");
  });

  it("binds Approval copy, timeout, and its fixed output schema", async () => {
    const blueprint = await createBlueprint([
      {
        id: "approval",
        title: "Approval",
        description: "Wait for an explicit operator gate.",
        verification: "Return the standard Approval receipt.",
      },
    ]);
    const definition = {
      name: "Release Approval",
      version: 1,
      description: "Pause one typed Workflow for operator approval.",
      blueprint,
      inputSchema: requestSchema(),
      outputSchema: structuredClone(
        EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
      ),
      outputNodeId: "approval",
      nodes: [
        {
          id: "approval",
          type: "approval" as const,
          header: "Release",
          question: "Approve this verified release?",
          approve: {
            label: "Approve",
            description: "Continue the typed Workflow.",
          },
          reject: {
            label: "Reject",
            description: "Block the typed Workflow.",
          },
          inputBindings: {
            workflow: { source: "workflow" as const },
          },
          inputSchema: {
            type: "object" as const,
            properties: { workflow: requestSchema() },
            required: ["workflow"],
            additionalProperties: false as const,
          },
          outputSchema: structuredClone(
            EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
          ),
          timeoutMs: 24 * 60 * 60 * 1_000,
          maxAttempts: 2,
        },
      ],
    };
    const manifest = defineExecutionPlanWorkflow(definition);
    expect(validateExecutionPlanWorkflowManifest(manifest)).toEqual(manifest);

    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...definition.nodes[0]!,
            outputSchema: {
              type: "object",
              properties: { approved: { type: "boolean" } },
              required: ["approved"],
              additionalProperties: false,
            },
          },
        ],
      }),
    ).toThrow("approval output schema");
    expect(() =>
      defineExecutionPlanWorkflow({
        ...definition,
        nodes: [
          {
            ...definition.nodes[0]!,
            reject: {
              label: "approve",
              description: "Ambiguous case-insensitive label.",
            },
          },
        ],
      }),
    ).toThrow("labels must be distinct");
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

function deterministicOutputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      selected: { type: "string", minLength: 1, maxLength: 500 },
      meta: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["deterministic"],
            minLength: 13,
            maxLength: 13,
          },
          flags: {
            type: "array",
            items: { type: "boolean" },
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ["source", "flags"],
        additionalProperties: false,
      },
    },
    required: ["selected", "meta"],
    additionalProperties: false,
  };
}

function listFilesReceiptSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 0 },
      truncated: { type: "boolean" },
      pathSha256: { type: "string", minLength: 64, maxLength: 64 },
      entrySetSha256: { type: "string", minLength: 64, maxLength: 64 },
    },
    required: ["count", "truncated", "pathSha256", "entrySetSha256"],
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

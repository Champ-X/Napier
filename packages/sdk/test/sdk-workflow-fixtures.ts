import type { WorkflowObjectSchema } from "@napier/contracts";
import { LocalStore, type OsSandboxAdapter } from "@napier/runtime";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type DefineNapierWorkflowInput } from "../src/index.js";

export const sdkWorkflowTemporaryRoots: string[] = [];

type DraftRequest = {
  text: string;
  publish: boolean;
};
type DraftReport = { message: string };
type MapRequest = { items: string[] };
type MapReport = Array<{ item: string }>;
type ReduceRequest = { values: number[] };
type ReduceReport = number;
type SwitchRequest = { route: "priority" | "audit" | "other"; text: string };
type SwitchReport = { message: string };
type JavascriptRequest = { values: number[] };
type JavascriptReport = { total: number };
type PythonRequest = { values: number[] };
type PythonReport = { total: number };

export function draftWorkflowDefinition(): DefineNapierWorkflowInput<
  DraftRequest,
  DraftReport
> {
  const requestSchema = draftRequestSchema();
  const normalizedSchema = normalizedDraftSchema();
  return {
    name: "SDK typed draft",
    version: 1,
    description:
      "Normalize one typed request and conditionally publish its output.",
    plan: {
      objective: "Normalize and publish one typed SDK request.",
      steps: [
        planStep("normalize", "Normalize input"),
        {
          ...planStep("publish", "Publish output"),
          dependsOn: ["normalize"],
        },
      ],
    },
    inputSchema: requestSchema,
    outputSchema: draftReportSchema(),
    outputNodeId: "publish",
    maxConcurrency: 2,
    nodes: [
      {
        id: "normalize",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: objectSchema({ workflow: requestSchema }),
        outputSchema: normalizedSchema,
        template: {
          kind: "object",
          properties: {
            text: { kind: "input", path: ["workflow", "text"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
      {
        id: "publish",
        type: "deterministic",
        inputBindings: {
          workflow: { source: "workflow" },
          normalized: { source: "node", nodeId: "normalize" },
        },
        inputSchema: objectSchema({
          workflow: requestSchema,
          normalized: normalizedSchema,
        }),
        outputSchema: draftReportSchema(),
        when: { path: ["workflow", "publish"], equals: true },
        skipOutput: { message: "Draft retained by SDK Workflow" },
        template: {
          kind: "object",
          properties: {
            message: { kind: "input", path: ["normalized", "text"] },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

export function blockedWorkflowDefinition(): DefineNapierWorkflowInput<
  DraftRequest,
  DraftReport
> {
  const requestSchema = draftRequestSchema();
  return {
    name: "SDK blocked draft",
    version: 1,
    description: "Exercise explicit SDK Workflow retries.",
    plan: {
      objective: "Attempt one unavailable SDK Agent node.",
      steps: [planStep("publish", "Publish output")],
    },
    inputSchema: requestSchema,
    outputSchema: draftReportSchema(),
    outputNodeId: "publish",
    nodes: [
      {
        id: "publish",
        type: "agent",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: objectSchema({ workflow: requestSchema }),
        outputSchema: draftReportSchema(),
        model: { provider: "missing-sdk-provider", id: "missing-1" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

export function mapWorkflowDefinition(): DefineNapierWorkflowInput<
  MapRequest,
  MapReport
> {
  const itemSchema = {
    type: "string" as const,
    minLength: 1,
    maxLength: 100,
  };
  const inputSchema = objectSchema({
    items: {
      type: "array",
      items: itemSchema,
      minItems: 0,
      maxItems: 8,
    },
  });
  const outputSchema = {
    type: "array" as const,
    items: objectSchema({ item: itemSchema }),
    minItems: 0,
    maxItems: 8,
  };
  return {
    name: "SDK typed Map",
    version: 1,
    description: "Define one bounded read-only Agent Map.",
    plan: {
      objective: "Map one typed SDK collection.",
      steps: [planStep("map_items", "Map items")],
    },
    inputSchema,
    outputSchema,
    outputNodeId: "map_items",
    nodes: [
      {
        id: "map_items",
        type: "map",
        inputBindings: {
          items: { source: "workflow", path: ["items"] },
        },
        inputSchema,
        outputSchema,
        itemsPath: ["items"],
        model: { provider: "openai", id: "gpt-4.1-mini" },
        maxConcurrency: 3,
        itemTimeoutMs: 5_000,
        timeoutMs: 30_000,
        maxAttempts: 2,
      },
    ],
  };
}

export function reduceWorkflowDefinition(): DefineNapierWorkflowInput<
  ReduceRequest,
  ReduceReport
> {
  const valuesSchema = {
    type: "array" as const,
    items: { type: "integer" as const },
    minItems: 0,
    maxItems: 16,
  };
  const inputSchema = objectSchema({ values: valuesSchema });
  return {
    name: "SDK deterministic Reduce",
    version: 1,
    description: "Sum typed values without a model call.",
    plan: {
      objective: "Reduce one typed SDK collection.",
      steps: [planStep("total", "Total values")],
    },
    inputSchema,
    outputSchema: { type: "integer" },
    outputNodeId: "total",
    nodes: [
      {
        id: "total",
        type: "reduce",
        inputBindings: {
          values: { source: "workflow", path: ["values"] },
        },
        inputSchema,
        outputSchema: { type: "integer" },
        itemsPath: ["values"],
        operation: "sum",
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

export function switchWorkflowDefinition(): DefineNapierWorkflowInput<
  SwitchRequest,
  SwitchReport
> {
  const inputSchema = objectSchema({
    route: {
      type: "string",
      enum: ["priority", "audit", "other"],
    },
    text: { type: "string", minLength: 1, maxLength: 200 },
  });
  const outputSchema = objectSchema({
    message: { type: "string", minLength: 1, maxLength: 200 },
  });
  return {
    name: "SDK deterministic Switch",
    version: 1,
    description: "Select one typed output without a model call.",
    plan: {
      objective: "Route one typed SDK input.",
      steps: [planStep("route", "Route input")],
    },
    inputSchema,
    outputSchema,
    outputNodeId: "route",
    nodes: [
      {
        id: "route",
        type: "deterministic",
        inputBindings: {
          request: { source: "workflow" },
        },
        inputSchema: objectSchema({ request: inputSchema }),
        outputSchema,
        template: {
          kind: "switch",
          path: ["request", "route"],
          cases: [
            {
              id: "fast_path",
              equals: "priority",
              then: {
                kind: "object",
                properties: {
                  message: {
                    kind: "input",
                    path: ["request", "text"],
                  },
                },
              },
            },
            {
              id: "audit_path",
              equals: "audit",
              then: {
                kind: "literal",
                value: { message: "SDK audit route" },
              },
            },
          ],
          default: {
            kind: "literal",
            value: { message: "SDK default route" },
          },
        },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
}

export function javascriptWorkflowDefinition(): DefineNapierWorkflowInput<
  JavascriptRequest,
  JavascriptReport
> {
  const inputSchema = objectSchema({
    values: {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 100 },
      minItems: 1,
      maxItems: 8,
    },
  });
  const outputSchema = objectSchema({
    total: { type: "integer", minimum: 0, maximum: 800 },
  });
  return {
    name: "SDK JavaScript calculation",
    version: 1,
    description: "Execute stateful JavaScript cells in a typed Workflow.",
    plan: {
      objective: "Calculate one typed total.",
      steps: [planStep("calculate", "Calculate values")],
    },
    inputSchema,
    outputSchema,
    outputNodeId: "calculate",
    nodes: [
      {
        id: "calculate",
        type: "javascript",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: objectSchema({ workflow: inputSchema }),
        outputSchema,
        cells: [
          "const PRIVATE_SDK_VALUES = input.workflow.values.slice(); PRIVATE_SDK_VALUES.length",
          "({ total: PRIVATE_SDK_VALUES.reduce((sum, value) => sum + value, 0) })",
        ],
        evaluationTimeoutMs: 1_000,
        timeoutMs: 10_000,
        maxAttempts: 1,
      },
    ],
  };
}

export function pythonWorkflowDefinition(): DefineNapierWorkflowInput<
  PythonRequest,
  PythonReport
> {
  const inputSchema = objectSchema({
    values: {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 100 },
      minItems: 1,
      maxItems: 8,
    },
  });
  const outputSchema = objectSchema({
    total: { type: "integer", minimum: 0, maximum: 800 },
  });
  return {
    name: "SDK Python calculation",
    version: 1,
    description: "Execute stateful Python cells in a typed Workflow.",
    plan: {
      objective: "Calculate one exact typed total.",
      steps: [planStep("calculate", "Calculate Python values")],
    },
    inputSchema,
    outputSchema,
    outputNodeId: "calculate",
    nodes: [
      {
        id: "calculate",
        type: "python",
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: objectSchema({ workflow: inputSchema }),
        outputSchema,
        cells: [
          'PRIVATE_SDK_PYTHON_VALUES = tuple(input["workflow"]["values"])\nlen(PRIVATE_SDK_PYTHON_VALUES)',
          '{"total": sum(PRIVATE_SDK_PYTHON_VALUES)}',
        ],
        evaluationTimeoutMs: 1_000,
        timeoutMs: 10_000,
        maxAttempts: 1,
      },
    ],
  };
}

export function planStep(id: string, title: string) {
  return {
    id,
    title,
    description: `${title} through the SDK Workflow.`,
    verification: `${title} satisfies its runtime Schema.`,
  };
}

export function draftRequestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: 200 },
      publish: { type: "boolean" },
    },
    required: ["text", "publish"],
    additionalProperties: false,
  };
}

export function normalizedDraftSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["text"],
    additionalProperties: false,
  };
}

export function draftReportSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: {
      message: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["message"],
    additionalProperties: false,
  };
}

export function objectSchema(
  properties: WorkflowObjectSchema["properties"],
): WorkflowObjectSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-sdk-${label}-`));
  sdkWorkflowTemporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot };
}

export async function openStore(fixture: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(fixture);
  await store.initialize();
  return store;
}

export function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-sdk-workflow-javascript-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
            }
          }
          await exit;
        },
      };
    },
  };
}

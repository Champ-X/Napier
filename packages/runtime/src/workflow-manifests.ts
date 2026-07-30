import {
  EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
  EXECUTION_PLAN_WORKFLOW_TOOL_NAMES,
  NAPIER_API_VERSION,
  type ExecutionPlanWorkflowApprovalChoice,
  type ExecutionPlanWorkflowInputBinding,
  type ExecutionPlanWorkflowManifest,
  type ExecutionPlanWorkflowManifestVerification,
  type ExecutionPlanWorkflowNode,
  type ExecutionPlanWorkflowToolName,
  type JsonValue,
  type WorkflowObjectSchema,
  type WorkflowValueSchema,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  executionPlanWorkflowConditionSchema,
  validateExecutionPlanWorkflowCondition,
} from "./workflow-condition-model.js";
import { validateExecutionPlanWorkflowDeterministicTemplate } from "./workflow-deterministic-model.js";
import { validateExecutionPlanBlueprint } from "./workflow-blueprints.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  MAX_WORKFLOW_SCHEMA_BYTES,
  MAX_WORKFLOW_SCHEMA_PROPERTIES,
  validateExecutionPlanWorkflowValuePath,
  validateWorkflowSchema,
  WORKFLOW_BINDING_NAME,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export {
  assertWorkflowValue,
  buildExecutionPlanWorkflowNodeInput,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  parseExecutionPlanWorkflowNodeOutput,
  workflowNodeBindingContextSha256,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export const MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES = 1024 * 1024;
export const MIN_EXECUTION_PLAN_WORKFLOW_NODE_TIMEOUT_MS = 1_000;
export const MAX_EXECUTION_PLAN_WORKFLOW_NODE_TIMEOUT_MS = 30 * 60 * 1_000;
export const MAX_EXECUTION_PLAN_WORKFLOW_APPROVAL_TIMEOUT_MS =
  7 * 24 * 60 * 60 * 1_000;
export const MAX_EXECUTION_PLAN_WORKFLOW_CONCURRENCY = 4;

const MAX_WORKFLOW_ATTEMPTS = 3;
const RESOURCE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const WORKFLOW_TOOL_NAMES = new Set<string>(EXECUTION_PLAN_WORKFLOW_TOOL_NAMES);

export type ExecutionPlanWorkflowManifestContent = Omit<
  ExecutionPlanWorkflowManifest,
  "generatedAt" | "contentSha256"
>;

export interface DefineExecutionPlanWorkflowInput {
  name: string;
  version: number;
  description: string;
  blueprint: ExecutionPlanWorkflowManifest["blueprint"];
  inputSchema: WorkflowValueSchema;
  outputSchema: WorkflowValueSchema;
  outputNodeId: string;
  nodes: ExecutionPlanWorkflowNode[];
  maxConcurrency?: number;
  generatedAt?: string;
}

export function defineExecutionPlanWorkflow(
  input: DefineExecutionPlanWorkflowInput,
): ExecutionPlanWorkflowManifest {
  const content: ExecutionPlanWorkflowManifestContent = {
    kind: "napier.execution-plan-workflow",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    name: normalizeText(input.name, 120, "Workflow name"),
    version: input.version,
    description: normalizeText(
      input.description,
      1_000,
      "Workflow description",
    ),
    blueprint: structuredClone(input.blueprint),
    inputSchema: structuredClone(input.inputSchema),
    outputSchema: structuredClone(input.outputSchema),
    outputNodeId: input.outputNodeId,
    nodes: structuredClone(input.nodes),
    nodeCount: input.nodes.length,
    ...(input.maxConcurrency !== undefined
      ? { maxConcurrency: input.maxConcurrency }
      : {}),
  };
  return validateExecutionPlanWorkflowManifest({
    ...content,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    contentSha256: hashExecutionPlanWorkflowManifestContent(content),
  });
}

export function verifyExecutionPlanWorkflowManifest(
  input: unknown,
): ExecutionPlanWorkflowManifestVerification {
  try {
    const manifest = validateExecutionPlanWorkflowManifest(input);
    return {
      status: "valid",
      diagnostics: [],
      nodeCount: manifest.nodeCount,
      contentSha256: manifest.contentSha256,
      blueprintSha256: manifest.blueprint.contentSha256,
      inputSchemaSha256: workflowSchemaSha256(manifest.inputSchema),
      outputSchemaSha256: workflowSchemaSha256(manifest.outputSchema),
    };
  } catch (error) {
    return {
      status: "invalid",
      diagnostics: [workflowDiagnostic(error)],
      nodeCount: 0,
    };
  }
}

export function validateExecutionPlanWorkflowManifest(
  input: unknown,
): ExecutionPlanWorkflowManifest {
  assertWorkflowEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES,
    "Workflow manifest",
  );
  const manifest = record(input, "Workflow manifest");
  assertExactKeys(
    manifest,
    [
      "kind",
      "schemaVersion",
      "apiVersion",
      "generatedAt",
      "name",
      "version",
      "description",
      "blueprint",
      "inputSchema",
      "outputSchema",
      "outputNodeId",
      "nodes",
      "nodeCount",
      "maxConcurrency",
      "contentSha256",
    ],
    "Workflow manifest",
    new Set(["maxConcurrency"]),
  );
  if (manifest["kind"] !== "napier.execution-plan-workflow") {
    throw new Error("Workflow manifest kind is invalid");
  }
  if (manifest["schemaVersion"] !== 1) {
    throw new Error("Workflow manifest schemaVersion is unsupported");
  }
  if (manifest["apiVersion"] !== NAPIER_API_VERSION) {
    throw new Error("Workflow manifest API version is unsupported");
  }
  assertIsoString(manifest["generatedAt"], "Workflow generatedAt");
  normalizeText(manifest["name"], 120, "Workflow name");
  normalizeText(manifest["description"], 1_000, "Workflow description");
  if (
    !Number.isSafeInteger(manifest["version"]) ||
    Number(manifest["version"]) < 1
  ) {
    throw new Error("Workflow version is invalid");
  }
  if (
    manifest["maxConcurrency"] !== undefined &&
    (!Number.isSafeInteger(manifest["maxConcurrency"]) ||
      Number(manifest["maxConcurrency"]) < 1 ||
      Number(manifest["maxConcurrency"]) >
        MAX_EXECUTION_PLAN_WORKFLOW_CONCURRENCY)
  ) {
    throw new Error("Workflow maxConcurrency is invalid");
  }
  const blueprint = validateExecutionPlanBlueprint(manifest["blueprint"]);
  if ((blueprint.artifacts?.length ?? 0) > 0) {
    throw new Error(
      "Workflow manifest v1 requires a Blueprint without artifact settlement",
    );
  }
  const schemaBudget = { nodes: 0 };
  assertWorkflowEncodedBytes(
    manifest["inputSchema"],
    MAX_WORKFLOW_SCHEMA_BYTES,
    "Workflow input schema",
  );
  assertWorkflowEncodedBytes(
    manifest["outputSchema"],
    MAX_WORKFLOW_SCHEMA_BYTES,
    "Workflow output schema",
  );
  validateWorkflowSchema(
    manifest["inputSchema"],
    "Workflow input schema",
    0,
    schemaBudget,
  );
  const outputSchema = validateWorkflowSchema(
    manifest["outputSchema"],
    "Workflow output schema",
    0,
    schemaBudget,
  );
  const outputNodeId = resourceId(
    manifest["outputNodeId"],
    "Workflow output node ID",
  );
  if (!Array.isArray(manifest["nodes"])) {
    throw new Error("Workflow nodes are invalid");
  }
  const nodes = manifest["nodes"].map((node, index) =>
    validateWorkflowNode(node, index, schemaBudget),
  );
  if (
    nodes.length < 1 ||
    nodes.length !== blueprint.steps.length ||
    manifest["nodeCount"] !== nodes.length
  ) {
    throw new Error("Workflow node count does not match its Blueprint");
  }
  const stepById = new Map(blueprint.steps.map((step) => [step.id, step]));
  const nodeIds = nodes.map((node) => node.id);
  if (
    canonicalJson(nodeIds) !==
    canonicalJson(blueprint.steps.map((step) => step.id))
  ) {
    throw new Error("Workflow nodes must match Blueprint step order");
  }
  for (const node of nodes) {
    const step = stepById.get(node.id)!;
    const bindingNames = Object.keys(node.inputBindings).sort();
    const propertyNames = Object.keys(node.inputSchema.properties).sort();
    if (
      canonicalJson(bindingNames) !== canonicalJson(propertyNames) ||
      canonicalJson(bindingNames) !==
        canonicalJson([...node.inputSchema.required].sort())
    ) {
      throw new Error(
        `Workflow node input schema must require every binding: ${node.id}`,
      );
    }
    for (const binding of Object.values(node.inputBindings)) {
      if (
        binding.source === "node" &&
        (!step.dependsOn?.includes(binding.nodeId) ||
          !stepById.has(binding.nodeId))
      ) {
        throw new Error(
          `Workflow node binding must reference a direct dependency: ${node.id}`,
        );
      }
    }
  }
  const outputNode = nodes.find((node) => node.id === outputNodeId);
  if (!outputNode) throw new Error("Workflow output node is missing");
  if (blueprint.steps.some((step) => step.dependsOn?.includes(outputNodeId))) {
    throw new Error("Workflow output node must be terminal");
  }
  if (
    workflowSchemaSha256(outputNode.outputSchema) !==
    workflowSchemaSha256(outputSchema)
  ) {
    throw new Error("Workflow output schema must match the output node schema");
  }
  const contentSha256 = hashString(
    manifest["contentSha256"],
    "Workflow content SHA-256",
  );
  const validated = structuredClone(input) as ExecutionPlanWorkflowManifest;
  const computed = hashExecutionPlanWorkflowManifestContent(
    executionPlanWorkflowManifestContent(validated),
  );
  if (computed !== contentSha256) {
    throw new Error("Workflow manifest content hash mismatch");
  }
  return validated;
}

export function executionPlanWorkflowManifestContent(
  manifest: ExecutionPlanWorkflowManifest,
): ExecutionPlanWorkflowManifestContent {
  return {
    kind: manifest.kind,
    schemaVersion: manifest.schemaVersion,
    apiVersion: manifest.apiVersion,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    blueprint: structuredClone(manifest.blueprint),
    inputSchema: structuredClone(manifest.inputSchema),
    outputSchema: structuredClone(manifest.outputSchema),
    outputNodeId: manifest.outputNodeId,
    nodes: structuredClone(manifest.nodes),
    nodeCount: manifest.nodeCount,
    ...(manifest.maxConcurrency !== undefined
      ? { maxConcurrency: manifest.maxConcurrency }
      : {}),
  };
}

export function hashExecutionPlanWorkflowManifestContent(
  content: ExecutionPlanWorkflowManifestContent,
): string {
  return sha256(canonicalJson(content));
}

function validateWorkflowNode(
  input: unknown,
  index: number,
  schemaBudget: { nodes: number },
): ExecutionPlanWorkflowNode {
  const label = `Workflow node ${String(index + 1)}`;
  const node = record(input, label);
  const type = node["type"];
  if (type === "agent") {
    assertExactKeys(
      node,
      [
        "id",
        "type",
        "inputBindings",
        "inputSchema",
        "outputSchema",
        "when",
        "skipOutput",
        "model",
        "timeoutMs",
        "maxAttempts",
      ],
      label,
      new Set(["model", "when", "skipOutput"]),
    );
  } else if (type === "deterministic") {
    assertExactKeys(
      node,
      [
        "id",
        "type",
        "inputBindings",
        "inputSchema",
        "outputSchema",
        "when",
        "skipOutput",
        "template",
        "timeoutMs",
        "maxAttempts",
      ],
      label,
      new Set(["when", "skipOutput"]),
    );
  } else if (type === "tool") {
    assertExactKeys(
      node,
      [
        "id",
        "type",
        "tool",
        "effect",
        "inputBindings",
        "inputSchema",
        "outputSchema",
        "when",
        "skipOutput",
        "timeoutMs",
        "maxAttempts",
      ],
      label,
      new Set(["when", "skipOutput"]),
    );
  } else if (type === "approval") {
    assertExactKeys(
      node,
      [
        "id",
        "type",
        "header",
        "question",
        "approve",
        "reject",
        "inputBindings",
        "inputSchema",
        "outputSchema",
        "when",
        "skipOutput",
        "timeoutMs",
        "maxAttempts",
      ],
      label,
      new Set(["when", "skipOutput"]),
    );
  } else {
    throw new Error(`${label} type is unsupported`);
  }
  const id = resourceId(node["id"], `${label} ID`);
  const bindingsRecord = record(node["inputBindings"], `${label} bindings`);
  const bindingKeys = Object.keys(bindingsRecord);
  if (bindingKeys.length > MAX_WORKFLOW_SCHEMA_PROPERTIES) {
    throw new Error(`${label} has too many input bindings`);
  }
  const inputBindings: Record<string, ExecutionPlanWorkflowInputBinding> = {};
  for (const [name, bindingInput] of Object.entries(bindingsRecord)) {
    if (!WORKFLOW_BINDING_NAME.test(name)) {
      throw new Error(`${label} binding name is invalid`);
    }
    const binding = record(bindingInput, `${label} binding`);
    if (binding["source"] === "literal") {
      assertExactKeys(binding, ["source", "value"], `${label} literal binding`);
      assertWorkflowEncodedBytes(
        binding["value"],
        MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
        `${label} literal binding`,
      );
      inputBindings[name] = {
        source: "literal",
        value: structuredClone(binding["value"]) as JsonValue,
      };
      continue;
    }
    if (binding["source"] === "workflow") {
      assertExactKeys(
        binding,
        ["source", "path"],
        `${label} workflow binding`,
        new Set(["path"]),
      );
      const path = validateExecutionPlanWorkflowValuePath(
        binding["path"],
        `${label} binding`,
      );
      inputBindings[name] = {
        source: "workflow",
        ...(path ? { path } : {}),
      };
      continue;
    }
    if (binding["source"] !== "node") {
      throw new Error(`${label} binding source is invalid`);
    }
    assertExactKeys(
      binding,
      ["source", "nodeId", "path"],
      `${label} node binding`,
      new Set(["path"]),
    );
    const path = validateExecutionPlanWorkflowValuePath(
      binding["path"],
      `${label} binding`,
    );
    inputBindings[name] = {
      source: "node",
      nodeId: resourceId(binding["nodeId"], `${label} binding node ID`),
      ...(path ? { path } : {}),
    };
  }
  assertWorkflowEncodedBytes(
    node["inputSchema"],
    MAX_WORKFLOW_SCHEMA_BYTES,
    `${label} input schema`,
  );
  assertWorkflowEncodedBytes(
    node["outputSchema"],
    MAX_WORKFLOW_SCHEMA_BYTES,
    `${label} output schema`,
  );
  const inputSchema = validateWorkflowSchema(
    node["inputSchema"],
    `${label} input schema`,
    0,
    schemaBudget,
  );
  if (inputSchema.type !== "object") {
    throw new Error(`${label} input schema must be an object`);
  }
  const outputSchema = validateWorkflowSchema(
    node["outputSchema"],
    `${label} output schema`,
    0,
    schemaBudget,
  );
  const conditional =
    node["when"] === undefined && node["skipOutput"] === undefined
      ? undefined
      : node["when"] !== undefined && node["skipOutput"] !== undefined
        ? {
            when: validateExecutionPlanWorkflowCondition(
              node["when"],
              `${label} condition`,
            ),
            skipOutput: structuredClone(node["skipOutput"]) as JsonValue,
          }
        : undefined;
  if (
    (node["when"] === undefined) !== (node["skipOutput"] === undefined) ||
    (node["when"] !== undefined && !conditional)
  ) {
    throw new Error(`${label} condition requires skipOutput`);
  }
  if (conditional) {
    assertWorkflowValue(
      outputSchema,
      conditional.skipOutput,
      `${label} skipOutput`,
    );
    assertWorkflowValue(
      executionPlanWorkflowConditionSchema(
        inputSchema,
        conditional.when,
        `${label} condition`,
      ),
      conditional.when.equals,
      `${label} condition equals`,
    );
  }
  const timeoutMs = boundedInteger(
    node["timeoutMs"],
    MIN_EXECUTION_PLAN_WORKFLOW_NODE_TIMEOUT_MS,
    type === "approval"
      ? MAX_EXECUTION_PLAN_WORKFLOW_APPROVAL_TIMEOUT_MS
      : MAX_EXECUTION_PLAN_WORKFLOW_NODE_TIMEOUT_MS,
    `${label} timeoutMs`,
  );
  const maxAttempts = boundedInteger(
    node["maxAttempts"],
    1,
    MAX_WORKFLOW_ATTEMPTS,
    `${label} maxAttempts`,
  );
  for (const [name, binding] of Object.entries(inputBindings)) {
    if (binding.source !== "literal") continue;
    const propertySchema = inputSchema.properties[name];
    if (!propertySchema) {
      throw new Error(`${label} literal binding has no input schema`);
    }
    assertWorkflowValue(
      propertySchema,
      binding.value,
      `${label} literal binding ${name}`,
    );
  }
  if (type === "deterministic") {
    return {
      id,
      type,
      inputBindings,
      inputSchema: inputSchema as WorkflowObjectSchema,
      outputSchema,
      ...(conditional ? conditional : {}),
      template: validateExecutionPlanWorkflowDeterministicTemplate(
        node["template"],
        `${label} template`,
      ),
      timeoutMs,
      maxAttempts,
    };
  }
  if (type === "tool") {
    if (
      typeof node["tool"] !== "string" ||
      !WORKFLOW_TOOL_NAMES.has(node["tool"]) ||
      (node["effect"] !== "read" && node["effect"] !== "write")
    ) {
      throw new Error(`${label} tool contract is invalid`);
    }
    return {
      id,
      type,
      tool: node["tool"] as ExecutionPlanWorkflowToolName,
      effect: node["effect"],
      inputBindings,
      inputSchema: inputSchema as WorkflowObjectSchema,
      outputSchema,
      ...(conditional ? conditional : {}),
      timeoutMs,
      maxAttempts,
    };
  }
  if (type === "approval") {
    const header = normalizeText(node["header"], 12, `${label} header`);
    const question = normalizeUtf8Text(
      node["question"],
      4 * 1_024,
      `${label} question`,
    );
    const approve = validateApprovalChoice(
      node["approve"],
      `${label} approve choice`,
    );
    const reject = validateApprovalChoice(
      node["reject"],
      `${label} reject choice`,
    );
    if (approve.label.toLowerCase() === reject.label.toLowerCase()) {
      throw new Error(`${label} approval choice labels must be distinct`);
    }
    if (
      workflowSchemaSha256(outputSchema) !==
      workflowSchemaSha256(EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA)
    ) {
      throw new Error(`${label} approval output schema is invalid`);
    }
    return {
      id,
      type,
      header,
      question,
      approve,
      reject,
      inputBindings,
      inputSchema: inputSchema as WorkflowObjectSchema,
      outputSchema: structuredClone(
        EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
      ),
      ...(conditional ? conditional : {}),
      timeoutMs,
      maxAttempts,
    };
  }
  const model =
    node["model"] === undefined
      ? undefined
      : validateModel(node["model"], `${label} model`);
  return {
    id,
    type: "agent",
    inputBindings,
    inputSchema: inputSchema as WorkflowObjectSchema,
    outputSchema,
    ...(conditional ? conditional : {}),
    ...(model ? { model } : {}),
    timeoutMs,
    maxAttempts,
  };
}

function validateApprovalChoice(
  input: unknown,
  label: string,
): ExecutionPlanWorkflowApprovalChoice {
  const choice = record(input, label);
  assertExactKeys(choice, ["label", "description"], label);
  return {
    label: normalizeOperatorDecisionText(
      choice["label"],
      80,
      256,
      `${label} label`,
    ),
    description: normalizeOperatorDecisionText(
      choice["description"],
      400,
      1_024,
      `${label} description`,
    ),
  };
}

function validateModel(
  input: unknown,
  label: string,
): { provider: string; id: string } {
  const model = record(input, label);
  assertExactKeys(model, ["provider", "id"], label);
  if (
    typeof model["provider"] !== "string" ||
    !PROVIDER_ID.test(model["provider"]) ||
    typeof model["id"] !== "string" ||
    !MODEL_ID.test(model["id"])
  ) {
    throw new Error(`${label} is invalid`);
  }
  return { provider: model["provider"], id: model["id"] };
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  optional = new Set<string>(),
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    keys.some((key) => !optional.has(key) && !(key in value))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (!isRecord(input)) throw new Error(`${label} must be an object`);
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function normalizeText(input: unknown, maximum: number, label: string): string {
  if (typeof input !== "string") throw new Error(`${label} is invalid`);
  const value = input.replace(/\s+/gu, " ").trim();
  if (!value || value.length > maximum) throw new Error(`${label} is invalid`);
  return value;
}

function normalizeUtf8Text(
  input: unknown,
  maximumBytes: number,
  label: string,
): string {
  if (typeof input !== "string") throw new Error(`${label} is invalid`);
  const value = input.trim();
  if (
    !value ||
    value.includes("\u0000") ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function normalizeOperatorDecisionText(
  input: unknown,
  maximumCharacters: number,
  maximumBytes: number,
  label: string,
): string {
  const value = normalizeUtf8Text(input, maximumBytes, label).replace(
    /\s+/gu,
    " ",
  );
  if ([...value].length > maximumCharacters) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function resourceId(input: unknown, label: string): string {
  if (typeof input !== "string" || !RESOURCE_ID.test(input)) {
    throw new Error(`${label} is invalid`);
  }
  return input;
}

function hashString(input: unknown, label: string): string {
  if (typeof input !== "string" || !/^[a-f0-9]{64}$/u.test(input)) {
    throw new Error(`${label} is invalid`);
  }
  return input;
}

function assertIsoString(input: unknown, label: string): void {
  if (
    typeof input !== "string" ||
    !Number.isFinite(Date.parse(input)) ||
    new Date(input).toISOString() !== input
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function boundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(input) ||
    Number(input) < minimum ||
    Number(input) > maximum
  ) {
    throw new Error(`${label} must be ${minimum}-${maximum}`);
  }
  return Number(input);
}

function workflowDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "invalid";
  return /^[A-Za-z0-9 .:_-]{1,240}$/u.test(message)
    ? message
    : "Workflow manifest is invalid";
}

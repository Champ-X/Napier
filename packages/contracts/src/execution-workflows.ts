import type { JsonValue, McpToolEffect, ModelRef } from "./execution-core.js";

export type ExecutionPlanStatus =
  | "active"
  | "completed"
  | "blocked"
  | "cancelled";

export type PlanStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "blocked"
  | "skipped";

export type ArtifactManifestStatus =
  | "expected"
  | "produced"
  | "verified"
  | "missing"
  | "superseded";

export interface ArtifactManifestEntry {
  id: string;
  path: string;
  kind: "file" | "directory" | "url" | "other";
  description: string;
  status: ArtifactManifestStatus;
  sha256?: string;
  sizeBytes?: number;
  sourceRunId?: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExecutionPlanRequest {
  objective: string;
  steps: Array<{
    id: string;
    title: string;
    description: string;
    verification: string;
    dependsOn?: string[];
  }>;
  artifacts?: Array<{
    id: string;
    path: string;
    kind?: ArtifactManifestEntry["kind"];
    description: string;
  }>;
}

export interface ExecutionPlanBlueprintSource {
  type: "plan";
  threadId: string;
  planId: string;
  planRevision: number;
  planArchiveSha256: string;
  eventStreamSha256: string;
}

export interface ExecutionPlanBlueprint {
  kind: "napier.execution-plan-blueprint";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  title: string;
  objective: string;
  source: ExecutionPlanBlueprintSource;
  steps: CreateExecutionPlanRequest["steps"];
  artifacts?: NonNullable<CreateExecutionPlanRequest["artifacts"]>;
  stepCount: number;
  artifactCount: number;
  contentSha256: string;
}

export interface WorkflowNullSchema {
  type: "null";
}

export interface WorkflowBooleanSchema {
  type: "boolean";
}

export interface WorkflowNumberSchema {
  type: "number" | "integer";
  minimum?: number;
  maximum?: number;
}

export interface WorkflowStringSchema {
  type: "string";
  minLength?: number;
  maxLength?: number;
  enum?: string[];
}

export interface WorkflowArraySchema {
  type: "array";
  items: WorkflowValueSchema;
  minItems?: number;
  maxItems?: number;
}

export interface WorkflowObjectSchema {
  type: "object";
  properties: Record<string, WorkflowValueSchema>;
  required: string[];
  additionalProperties: false;
}

export type WorkflowValueSchema =
  | WorkflowNullSchema
  | WorkflowBooleanSchema
  | WorkflowNumberSchema
  | WorkflowStringSchema
  | WorkflowArraySchema
  | WorkflowObjectSchema;

export type ExecutionPlanWorkflowValuePathSegment = string | number;

export type ExecutionPlanWorkflowInputBinding =
  | {
      source: "literal";
      value: JsonValue;
    }
  | {
      source: "workflow";
      path?: ExecutionPlanWorkflowValuePathSegment[];
    }
  | {
      source: "node";
      nodeId: string;
      path?: ExecutionPlanWorkflowValuePathSegment[];
    };

export interface ExecutionPlanWorkflowCondition {
  path: ExecutionPlanWorkflowValuePathSegment[];
  equals: JsonValue;
}

export interface ExecutionPlanWorkflowDeterministicSwitchCase {
  id: string;
  equals: JsonValue;
  then: ExecutionPlanWorkflowDeterministicTemplate;
}

export type ExecutionPlanWorkflowDeterministicTemplate =
  | {
      kind: "literal";
      value: JsonValue;
    }
  | {
      kind: "input";
      path?: ExecutionPlanWorkflowValuePathSegment[];
    }
  | {
      kind: "object";
      properties: Record<string, ExecutionPlanWorkflowDeterministicTemplate>;
    }
  | {
      kind: "array";
      items: ExecutionPlanWorkflowDeterministicTemplate[];
    }
  | {
      kind: "switch";
      path: ExecutionPlanWorkflowValuePathSegment[];
      cases: ExecutionPlanWorkflowDeterministicSwitchCase[];
      default?: ExecutionPlanWorkflowDeterministicTemplate;
    };

export interface ExecutionPlanWorkflowAgentNode {
  id: string;
  type: "agent";
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowValueSchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  model?: ModelRef;
  timeoutMs: number;
  maxAttempts: number;
}

export interface ExecutionPlanWorkflowDeterministicNode {
  id: string;
  type: "deterministic";
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowValueSchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  template: ExecutionPlanWorkflowDeterministicTemplate;
  timeoutMs: number;
  maxAttempts: number;
}

export interface ExecutionPlanWorkflowJavascriptNode {
  id: string;
  type: "javascript";
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowValueSchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  cells: string[];
  evaluationTimeoutMs: number;
  timeoutMs: number;
  maxAttempts: number;
}

export interface ExecutionPlanWorkflowPythonNode {
  id: string;
  type: "python";
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowValueSchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  cells: string[];
  evaluationTimeoutMs: number;
  timeoutMs: number;
  maxAttempts: number;
}

export interface ExecutionPlanWorkflowMapNode {
  id: string;
  type: "map";
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowArraySchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  itemsPath: ExecutionPlanWorkflowValuePathSegment[];
  model?: ModelRef;
  maxConcurrency: number;
  itemTimeoutMs: number;
  timeoutMs: number;
  maxAttempts: number;
}

export interface ExecutionPlanWorkflowLoopNode {
  id: string;
  type: "loop";
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowValueSchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  until: ExecutionPlanWorkflowCondition;
  model?: ModelRef;
  maxIterations: number;
  iterationTimeoutMs: number;
  timeoutMs: number;
  maxAttempts: number;
}

export const EXECUTION_PLAN_WORKFLOW_REDUCE_OPERATIONS = [
  "count",
  "sum",
  "minimum",
  "maximum",
  "all",
  "any",
] as const;

export type ExecutionPlanWorkflowReduceOperation =
  (typeof EXECUTION_PLAN_WORKFLOW_REDUCE_OPERATIONS)[number];

export interface ExecutionPlanWorkflowReduceNode {
  id: string;
  type: "reduce";
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowValueSchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  itemsPath: ExecutionPlanWorkflowValuePathSegment[];
  valuePath?: ExecutionPlanWorkflowValuePathSegment[];
  operation: ExecutionPlanWorkflowReduceOperation;
  timeoutMs: number;
  maxAttempts: number;
}

export const EXECUTION_PLAN_WORKFLOW_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_files",
  "list_symbols",
  "inspect_data",
  "data_frame",
  "sqlite_query",
  "git_inspect",
  "inspect_code",
  "read_symbol",
  "ast_query",
  "ast_edit_preview",
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_code_actions",
  "apply_patch",
  "run_command",
  "verify_workspace",
] as const;

export type ExecutionPlanWorkflowToolName =
  (typeof EXECUTION_PLAN_WORKFLOW_TOOL_NAMES)[number];

export interface ExecutionPlanWorkflowToolNode {
  id: string;
  type: "tool";
  tool: ExecutionPlanWorkflowToolName;
  effect: Exclude<McpToolEffect, "unknown">;
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowValueSchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  timeoutMs: number;
  maxAttempts: number;
}

export interface ExecutionPlanWorkflowApprovalChoice {
  label: string;
  description: string;
}

export interface ExecutionPlanWorkflowApprovalNode {
  id: string;
  type: "approval";
  header: string;
  question: string;
  approve: ExecutionPlanWorkflowApprovalChoice;
  reject: ExecutionPlanWorkflowApprovalChoice;
  inputBindings: Record<string, ExecutionPlanWorkflowInputBinding>;
  inputSchema: WorkflowObjectSchema;
  outputSchema: WorkflowObjectSchema;
  when?: ExecutionPlanWorkflowCondition;
  skipOutput?: JsonValue;
  timeoutMs: number;
  maxAttempts: number;
}

export type ExecutionPlanWorkflowNode =
  | ExecutionPlanWorkflowAgentNode
  | ExecutionPlanWorkflowDeterministicNode
  | ExecutionPlanWorkflowJavascriptNode
  | ExecutionPlanWorkflowPythonNode
  | ExecutionPlanWorkflowMapNode
  | ExecutionPlanWorkflowLoopNode
  | ExecutionPlanWorkflowReduceNode
  | ExecutionPlanWorkflowToolNode
  | ExecutionPlanWorkflowApprovalNode;

export interface ExecutionPlanWorkflowManifest {
  kind: "napier.execution-plan-workflow";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  name: string;
  version: number;
  description: string;
  blueprint: ExecutionPlanBlueprint;
  inputSchema: WorkflowValueSchema;
  outputSchema: WorkflowValueSchema;
  outputNodeId: string;
  nodes: ExecutionPlanWorkflowNode[];
  nodeCount: number;
  maxConcurrency?: number;
  contentSha256: string;
}

export type ExecutionPlanWorkflowNodeStatus =
  | "completed"
  | "skipped"
  | "waiting"
  | "blocked"
  | "cancelled";

export interface ExecutionPlanWorkflowNodeResult {
  nodeId: string;
  attempt: number;
  status: ExecutionPlanWorkflowNodeStatus;
  inputSha256: string;
  inputSchemaSha256: string;
  outputSchemaSha256: string;
  runId?: string;
  decisionId?: string;
  output?: JsonValue;
  outputSha256?: string;
  errorCode?: string;
  diagnosticSha256?: string;
}

export type ExecutionPlanWorkflowStatus =
  | "completed"
  | "waiting"
  | "paused"
  | "blocked"
  | "cancelled";

export interface ExecutionPlanWorkflowBreakpoint {
  nodeId: string;
  breakpointIndex: number;
  breakpointCount: number;
  reachedEventSeq: number;
  bindingContextSha256: string;
}

export interface ExecutionPlanWorkflowResult {
  kind: "napier.execution-plan-workflow-result";
  schemaVersion: 1;
  threadId: string;
  planId: string;
  manifestSha256: string;
  blueprintSha256: string;
  status: ExecutionPlanWorkflowStatus;
  resumed: boolean;
  nodeResults: ExecutionPlanWorkflowNodeResult[];
  breakpoint?: ExecutionPlanWorkflowBreakpoint;
  output?: JsonValue;
  outputSha256?: string;
  resultSha256: string;
}

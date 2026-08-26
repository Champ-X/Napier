export type ToolConcurrency = "safe" | "serialized" | "exclusive";

export type ToolSideEffect =
  | "none"
  | "reversible"
  | "irreversible"
  | "unknown";

export type ToolJsonSchema = Record<string, unknown>;

export type ToolSideEffectMode = "static" | "input_dependent";

export interface ToolRetryPolicyV2 {
  strategy: "never" | "not_started";
  maxAttempts: number;
}

export interface ToolIdempotencyPolicyV2 {
  key: "none" | "arguments" | "preview_token";
  resultReplay: "never" | "exact_result_only";
}

export interface ToolApprovalPolicyV2 {
  mode: "none" | "policy" | "explicit";
  codeBridge: "allowed" | "external_checkpoint";
}

export interface ToolCompatibilityAdapterV2 {
  mode: "native" | "compatibility";
  runtime: "pi-agent-tool/v1";
  legacyDefinitionSha256: string;
}

export interface ToolDefinitionV2 {
  schemaVersion: 2;
  id: string;
  version: string;
  capabilityUris: string[];
  inputSchema: ToolJsonSchema;
  canonicalOutputSchema: ToolJsonSchema;
  modelVisibleOutputSchema: ToolJsonSchema;
  uiProjectionSchema: ToolJsonSchema;
  concurrency: ToolConcurrency;
  sideEffect: ToolSideEffect;
  sideEffectMode: ToolSideEffectMode;
  retry: ToolRetryPolicyV2;
  idempotency: ToolIdempotencyPolicyV2;
  approval: ToolApprovalPolicyV2;
  policyTags: string[];
  compatibility: ToolCompatibilityAdapterV2;
}

export interface ToolInvocationProtocolV2 {
  kind: "napier.tool-invocation-protocol";
  schemaVersion: 2;
  toolId: string;
  semanticVersion: string;
  definitionSha256: string;
  implementationSha256: string;
  sideEffect: ToolSideEffect;
  concurrency: ToolConcurrency;
  retry: ToolRetryPolicyV2;
  idempotency: ToolIdempotencyPolicyV2;
  approval: ToolApprovalPolicyV2;
  policyTags: string[];
  compatibilityMode: ToolCompatibilityAdapterV2["mode"];
}

export interface ToolUiProjectionV2 {
  kind: "napier.tool-ui-projection";
  schemaVersion: 2;
  toolId: string;
  semanticVersion: string;
  definitionSha256: string;
  implementationSha256: string;
  status: "started" | "completed" | "failed" | "blocked";
  sideEffect: ToolSideEffect;
  concurrency: ToolConcurrency;
  compatibilityMode: ToolCompatibilityAdapterV2["mode"];
}

export interface CapabilityDescriptor {
  kind: "napier.capability-descriptor";
  schemaVersion: 1;
  uri: string;
  toolId: string;
  label: string;
  description: string;
  definition: ToolDefinitionV2;
  definitionSha256: string;
}

export type EditDialect =
  | "hashline"
  | "structured_patch"
  | "preview_apply";

export type EditIntent =
  | {
      kind: "content";
      target: string;
      expectedSha256: string | null;
      create?: { content: string; createParentDirectories?: boolean };
      replacements?: Array<{ oldText: string; newText: string }>;
      hashlineReplacements?: Array<{
        line?: number;
        anchorSha256: string;
        newText: string;
      }>;
    }
  | {
      kind: "filesystem";
      operation: "create_directory" | "move" | "trash" | "restore";
      path?: string;
      sourcePath?: string;
      destinationPath?: string;
      trashId?: string;
      createParentDirectories?: boolean;
    };

export interface EditDispatchPlan {
  kind: "napier.edit-dispatch-plan";
  schemaVersion: 1;
  dialect: EditDialect;
  intent: EditIntent;
  toolId: "apply_patch" | "workspace_file_preview";
  input: Record<string, unknown>;
  continuationToolId?: "workspace_file_apply";
  intentSha256: string;
}

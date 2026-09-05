import type {
  ToolCompatibilityModeV2,
  ToolConcurrency,
  ToolFailureBindingScope,
  ToolProgressAvailability,
  ToolProgressContribution,
  ToolProgressCoverage,
  ToolProgressOperation,
  ToolProgressReceiptV1,
  ToolProgressScope,
  ToolSideEffect,
} from "./tool-protocol-projection-types.js";

export type {
  ToolCompatibilityModeV2,
  ToolConcurrency,
  ToolFailureBindingsV1,
  ToolFailureBindingScope,
  ToolProgressAvailability,
  ToolProgressContribution,
  ToolProgressCoverage,
  ToolProgressOperation,
  ToolProgressReceiptV1,
  ToolProgressScope,
  ToolProgressSemanticsV1,
  ToolSideEffect,
  ToolUiProjectionV2,
} from "./tool-protocol-projection-types.js";

export type ToolJsonSchema = Record<string, unknown>;

export type ToolSideEffectMode = "static" | "input_dependent";

export type ToolFailureClassV1 =
  | "invalid_input"
  | "unavailable"
  | "unsupported"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "network"
  | "session_state"
  | "cancelled"
  | "policy"
  | "resource_limit"
  | "unknown";

export type ToolFailureScopeV1 = "invocation" | ToolFailureBindingScope;

export type ToolFailureDispositionV1 =
  | "correct_input"
  | "alternate_route"
  | "retry_after"
  | "recover_state"
  | "terminal";

/** One exact failure interpretation a tool-owned resolver may emit. */
export interface ToolFailureModeV1 {
  modeId: string;
  class: ToolFailureClassV1;
  scope: ToolFailureScopeV1;
  disposition: ToolFailureDispositionV1;
  fatalToSession: boolean;
}

/**
 * Signed failure-classification ABI. `resolutionSha256` binds the executable
 * resolver and its semantic version into the containing Tool definition hash.
 */
export interface ToolFailureDefinitionV1 {
  kind: "napier.tool-failure-definition";
  schemaVersion: 1;
  availability: "declared" | "unavailable";
  coverage: "trusted_declared" | "legacy_fallback";
  modes: ToolFailureModeV1[];
  resolutionSha256?: string;
}

export interface ToolFailureSemanticsV1 {
  kind: "napier.tool-failure-semantics";
  schemaVersion: 1;
  class: ToolFailureClassV1;
  scope: ToolFailureScopeV1;
  disposition: ToolFailureDispositionV1;
  fatalToSession: boolean;
}

/**
 * Durable, privacy-preserving failure evidence. The selected non-invocation
 * binding is hashed before it crosses the Tool Protocol boundary.
 */
export interface ToolFailureReceiptV1 extends ToolFailureSemanticsV1 {
  coverage: "trusted_declared" | "legacy_fallback" | "invalid_declared";
  modeId?: string;
  failureDefinitionSha256: string;
  bindingSha256?: string;
  retryAfterMs?: number;
  diagnosticSha256: string;
  classificationErrorSha256?: string;
}

export interface ToolProgressModeV1 {
  modeId: string;
  operation: ToolProgressOperation;
  scope: ToolProgressScope;
  contribution: ToolProgressContribution;
}

export interface ToolProgressDefinitionV1 {
  kind: "napier.tool-progress-definition";
  schemaVersion: 1;
  availability: ToolProgressAvailability;
  coverage: ToolProgressCoverage;
  operations: ToolProgressOperation[];
  contributions: ToolProgressContribution[];
  /** Exact legal tuples; avoids accepting undeclared cross-products. */
  modes?: ToolProgressModeV1[];
  /** Binds input/result classification logic into the Tool definition hash. */
  resolutionSha256?: string;
}

export interface ToolRetryPolicyV2 {
  /**
   * `terminal_failure` extends `not_started` only for statically side-effect-free
   * tools: an expired started owner or a durable failed settlement may yield to
   * the next bounded logical attempt. An unresolved effect boundary is never
   * retry evidence.
   */
  strategy: "never" | "not_started" | "terminal_failure";
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
  mode: ToolCompatibilityModeV2;
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
  /** Binds the executable classifier used by input-dependent native tools. */
  sideEffectResolutionSha256?: string;
  retry: ToolRetryPolicyV2;
  idempotency: ToolIdempotencyPolicyV2;
  approval: ToolApprovalPolicyV2;
  progress: ToolProgressDefinitionV1;
  failure: ToolFailureDefinitionV1;
  policyTags: string[];
  compatibility: ToolCompatibilityAdapterV2;
}

export interface ToolInvocationProtocolV2 {
  kind: "napier.tool-invocation-protocol";
  schemaVersion: 2;
  toolId: string;
  semanticVersion: string;
  definitionSha256: string;
  /** Expected hash of any durable ToolFailureReceiptV1 for this invocation. */
  failureDefinitionSha256: string;
  implementationSha256: string;
  sideEffect: ToolSideEffect;
  concurrency: ToolConcurrency;
  retry: ToolRetryPolicyV2;
  idempotency: ToolIdempotencyPolicyV2;
  approval: ToolApprovalPolicyV2;
  progress: ToolProgressReceiptV1;
  policyTags: string[];
  compatibilityMode: ToolCompatibilityAdapterV2["mode"];
}

export {
  isToolProgressReceiptV1,
  isToolUiProjectionV2,
} from "./tool-protocol-projection-v2.js";
export type { ToolUiProjectionV2Expectation } from "./tool-protocol-projection-v2.js";

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

export type EditDialect = "hashline" | "structured_patch" | "preview_apply";

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

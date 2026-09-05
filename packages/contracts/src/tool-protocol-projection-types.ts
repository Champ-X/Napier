export type ToolConcurrency = "safe" | "serialized" | "exclusive";

export type ToolSideEffect = "none" | "reversible" | "irreversible" | "unknown";

export type ToolProgressOperation =
  | "acquire"
  | "reuse"
  | "observe"
  | "mutate"
  | "verify"
  | "coordinate"
  | "neutral";

export type ToolProgressScope =
  | "external"
  | "run_source"
  | "workspace"
  | "session"
  | "remote"
  | "control"
  | "neutral";

export type ToolProgressContribution =
  | "supporting"
  | "product"
  | "verification"
  | "control"
  | "neutral";

export type ToolProgressAvailability = "declared" | "unavailable";

export type ToolProgressCoverage =
  | "trusted_declared"
  | "host_observed"
  | "opaque";

/** Stable privacy-preserving failure-circuit dimensions. */
export type ToolFailureBindingScope =
  | "target"
  | "origin"
  | "route"
  | "capability"
  | "session";

export type ToolFailureBindingsV1 = Partial<
  Record<ToolFailureBindingScope, string>
>;

export interface ToolProgressSemanticsV1 {
  kind: "napier.tool-progress-semantics";
  schemaVersion: 1;
  availability: ToolProgressAvailability;
  coverage: ToolProgressCoverage;
  operation: ToolProgressOperation;
  scope: ToolProgressScope;
  contribution: ToolProgressContribution;
}

export interface ToolProgressReceiptV1 extends ToolProgressSemanticsV1 {
  modeId?: string;
  resourceKeySha256?: string;
  /** Scope-specific circuit bindings. Added compatibly to receipt v1. */
  failureBindings?: ToolFailureBindingsV1;
  /** Historical catch-all used only when the matching binding is absent. */
  failureDomainKeySha256?: string;
  stateSha256?: string;
  /** Present when a progress adapter failed; execution still proceeds. */
  classificationErrorSha256?: string;
}

export type ToolCompatibilityModeV2 = "native" | "compatibility";

export interface ToolUiProjectionV2 {
  kind: "napier.tool-ui-projection";
  schemaVersion: 2;
  toolId: string;
  semanticVersion: string;
  definitionSha256: string;
  /** Expected hash of any durable failure receipt for this invocation. */
  failureDefinitionSha256: string;
  implementationSha256: string;
  status: "started" | "completed" | "failed" | "blocked";
  sideEffect: ToolSideEffect;
  concurrency: ToolConcurrency;
  progress: ToolProgressReceiptV1;
  compatibilityMode: ToolCompatibilityModeV2;
}

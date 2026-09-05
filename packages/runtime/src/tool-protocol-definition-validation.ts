import type { ToolDefinitionV2 } from "@napier/contracts/tool-protocol";

const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TOOL_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const CONCURRENCY = new Set(["safe", "serialized", "exclusive"]);
const SIDE_EFFECT = new Set(["none", "reversible", "irreversible", "unknown"]);
const SIDE_EFFECT_MODE = new Set(["static", "input_dependent"]);
const IDEMPOTENCY_KEY = new Set(["none", "arguments", "preview_token"]);
const RESULT_REPLAY = new Set(["never", "exact_result_only"]);
const APPROVAL_MODE = new Set(["none", "policy", "explicit"]);
const CODE_BRIDGE = new Set(["allowed", "external_checkpoint"]);
const PROGRESS_OPERATIONS = new Set([
  "acquire",
  "reuse",
  "observe",
  "mutate",
  "verify",
  "coordinate",
  "neutral",
]);
const PROGRESS_SCOPES = new Set([
  "external",
  "run_source",
  "workspace",
  "session",
  "remote",
  "control",
  "neutral",
]);
const PROGRESS_CONTRIBUTIONS = new Set([
  "supporting",
  "product",
  "verification",
  "control",
  "neutral",
]);

export function isValidToolDefinitionV2(definition: ToolDefinitionV2): boolean {
  try {
    return (
      hasValidDefinitionEnvelope(definition) &&
      hasValidProgressDefinition(definition) &&
      hasValidProgressModes(definition) &&
      hasValidFailureDefinition(definition) &&
      SHA256.test(definition.compatibility.legacyDefinitionSha256)
    );
  } catch {
    return false;
  }
}

function hasValidFailureDefinition(definition: ToolDefinitionV2): boolean {
  const failure = definition.failure;
  if (
    failure.kind !== "napier.tool-failure-definition" ||
    failure.schemaVersion !== 1
  ) {
    return false;
  }
  if (failure.availability === "unavailable") {
    return (
      failure.coverage === "legacy_fallback" &&
      failure.modes.length === 0 &&
      failure.resolutionSha256 === undefined
    );
  }
  if (
    failure.availability !== "declared" ||
    failure.coverage !== "trusted_declared" ||
    failure.modes.length < 1 ||
    !failure.resolutionSha256 ||
    !SHA256.test(failure.resolutionSha256) ||
    new Set(failure.modes.map((mode) => mode.modeId)).size !==
      failure.modes.length
  ) {
    return false;
  }
  const classes = new Set([
    "invalid_input",
    "unavailable",
    "unsupported",
    "unauthorized",
    "forbidden",
    "not_found",
    "rate_limited",
    "timeout",
    "network",
    "session_state",
    "cancelled",
    "policy",
    "resource_limit",
    "unknown",
  ]);
  const scopes = new Set([
    "invocation",
    "target",
    "origin",
    "route",
    "capability",
    "session",
  ]);
  const dispositions = new Set([
    "correct_input",
    "alternate_route",
    "retry_after",
    "recover_state",
    "terminal",
  ]);
  return failure.modes.every(
    (mode) =>
      /^[a-z][a-z0-9_.-]{0,63}$/u.test(mode.modeId) &&
      classes.has(mode.class) &&
      scopes.has(mode.scope) &&
      dispositions.has(mode.disposition) &&
      typeof mode.fatalToSession === "boolean" &&
      (!mode.fatalToSession || mode.scope === "session"),
  );
}

function hasValidDefinitionEnvelope(definition: ToolDefinitionV2): boolean {
  return (
    hasValidBasicEnvelope(definition) &&
    hasValidEffectPolicy(definition) &&
    hasValidRetryPolicy(definition) &&
    hasValidIdempotencyPolicy(definition) &&
    hasValidApprovalPolicy(definition) &&
    hasValidCompatibilityPolicy(definition)
  );
}

function hasValidBasicEnvelope(definition: ToolDefinitionV2): boolean {
  return !(
    definition.schemaVersion !== 2 ||
    !TOOL_ID.test(definition.id) ||
    !SEMANTIC_VERSION.test(definition.version) ||
    definition.capabilityUris.length < 1 ||
    definition.capabilityUris.some((uri) => !validCapabilityUri(uri)) ||
    new Set(definition.capabilityUris).size !==
      definition.capabilityUris.length ||
    !jsonObject(definition.inputSchema) ||
    !jsonObject(definition.canonicalOutputSchema) ||
    !jsonObject(definition.modelVisibleOutputSchema) ||
    !jsonObject(definition.uiProjectionSchema) ||
    !CONCURRENCY.has(definition.concurrency) ||
    !SIDE_EFFECT.has(definition.sideEffect) ||
    !SIDE_EFFECT_MODE.has(definition.sideEffectMode)
  );
}

function hasValidEffectPolicy(definition: ToolDefinitionV2): boolean {
  return !(
    (definition.sideEffectMode === "input_dependent" &&
      definition.compatibility.mode === "native" &&
      (!definition.sideEffectResolutionSha256 ||
        !SHA256.test(definition.sideEffectResolutionSha256))) ||
    (definition.sideEffectMode === "static" &&
      definition.sideEffectResolutionSha256 !== undefined) ||
    (definition.concurrency === "safe" &&
      (definition.sideEffect !== "none" ||
        definition.sideEffectMode !== "static"))
  );
}

function hasValidRetryPolicy(definition: ToolDefinitionV2): boolean {
  return !(
    !Number.isSafeInteger(definition.retry.maxAttempts) ||
    definition.retry.maxAttempts < 1 ||
    definition.retry.maxAttempts > 2 ||
    (definition.retry.strategy !== "never" &&
      definition.retry.strategy !== "not_started" &&
      definition.retry.strategy !== "terminal_failure") ||
    (definition.retry.strategy === "never" &&
      definition.retry.maxAttempts !== 1) ||
    (definition.retry.strategy === "terminal_failure" &&
      (definition.sideEffect !== "none" ||
        definition.sideEffectMode !== "static"))
  );
}

function hasValidIdempotencyPolicy(definition: ToolDefinitionV2): boolean {
  return !(
    !IDEMPOTENCY_KEY.has(definition.idempotency.key) ||
    !RESULT_REPLAY.has(definition.idempotency.resultReplay) ||
    (definition.idempotency.resultReplay === "exact_result_only" &&
      (definition.idempotency.key !== "arguments" ||
        definition.sideEffect !== "none" ||
        definition.sideEffectMode !== "static")) ||
    (definition.idempotency.key === "preview_token" &&
      (definition.sideEffect !== "reversible" ||
        definition.sideEffectMode !== "static"))
  );
}

function hasValidApprovalPolicy(definition: ToolDefinitionV2): boolean {
  return !(
    !APPROVAL_MODE.has(definition.approval.mode) ||
    !CODE_BRIDGE.has(definition.approval.codeBridge) ||
    (definition.approval.mode === "none" &&
      (definition.sideEffect !== "none" ||
        definition.sideEffectMode !== "static" ||
        definition.approval.codeBridge !== "allowed")) ||
    (definition.approval.mode === "explicit" &&
      definition.approval.codeBridge !== "external_checkpoint") ||
    (definition.approval.codeBridge === "allowed" &&
      (definition.sideEffectMode !== "static" ||
        (definition.sideEffect !== "none" &&
          definition.sideEffect !== "reversible")))
  );
}

function hasValidCompatibilityPolicy(definition: ToolDefinitionV2): boolean {
  return !(
    (definition.compatibility.mode !== "native" &&
      definition.compatibility.mode !== "compatibility") ||
    definition.compatibility.runtime !== "pi-agent-tool/v1" ||
    definition.policyTags.length < 1 ||
    definition.policyTags.some((tag) => !tag.trim()) ||
    new Set(definition.policyTags).size !== definition.policyTags.length
  );
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValidProgressDefinition(definition: ToolDefinitionV2): boolean {
  const progress = definition.progress;
  return !(
    progress.kind !== "napier.tool-progress-definition" ||
    progress.schemaVersion !== 1 ||
    (progress.availability !== "declared" &&
      progress.availability !== "unavailable") ||
    (progress.coverage !== "trusted_declared" &&
      progress.coverage !== "host_observed" &&
      progress.coverage !== "opaque") ||
    progress.operations.length < 1 ||
    progress.contributions.length < 1 ||
    progress.operations.some(
      (operation) => !PROGRESS_OPERATIONS.has(operation),
    ) ||
    progress.contributions.some(
      (contribution) => !PROGRESS_CONTRIBUTIONS.has(contribution),
    ) ||
    new Set(progress.operations).size !== progress.operations.length ||
    new Set(progress.contributions).size !== progress.contributions.length ||
    (progress.coverage === "trusted_declared" &&
      (!progress.modes ||
        progress.modes.length < 1 ||
        !progress.resolutionSha256)) ||
    (progress.resolutionSha256 !== undefined &&
      !SHA256.test(progress.resolutionSha256))
  );
}

function hasValidProgressModes(definition: ToolDefinitionV2): boolean {
  const modes = definition.progress.modes;
  if (modes === undefined) return true;
  const declaredOperations = new Set(definition.progress.operations);
  const declaredContributions = new Set(definition.progress.contributions);
  const modeOperations = new Set(modes.map((mode) => mode.operation));
  const modeContributions = new Set(modes.map((mode) => mode.contribution));
  return !(
    new Set(modes.map((mode) => mode.modeId)).size !== modes.length ||
    modes.some(
      (mode) =>
        !/^[a-z][a-z0-9_.-]{0,63}$/u.test(mode.modeId) ||
        !PROGRESS_OPERATIONS.has(mode.operation) ||
        !PROGRESS_SCOPES.has(mode.scope) ||
        !PROGRESS_CONTRIBUTIONS.has(mode.contribution) ||
        !declaredOperations.has(mode.operation) ||
        !declaredContributions.has(mode.contribution),
    ) ||
    !sameStringSet(declaredOperations, modeOperations) ||
    !sameStringSet(declaredContributions, modeContributions)
  );
}

function validCapabilityUri(uri: unknown): uri is string {
  if (
    typeof uri !== "string" ||
    uri.length < 7 ||
    uri.length > 512 ||
    /[\s\u0000-\u001f\u007f]/u.test(uri)
  ) {
    return false;
  }
  try {
    const parsed = new URL(uri);
    return (
      parsed.protocol === "cap:" &&
      parsed.hostname.length > 0 &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

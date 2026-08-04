import { createHash } from "node:crypto";

import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  AutomaticRecoveryBlockReason,
  AutomaticRecoveryPolicy,
  JsonValue,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

import {
  DEFAULT_AUTOMATIC_RECOVERY_POLICY,
  normalizeAutomaticRecoveryPolicy,
} from "./agents.js";
import { CORE_STATELESS_READ_TOOL_NAMES } from "./read-only-tool-names.js";
import { fingerprintAutomaticRecovery } from "./run-config.js";

export const MAX_AUTOMATIC_RECOVERY_EVENTS = 10_000;

const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;
const SAFE_READ_ONLY_TOOLS = new Set([
  ...CORE_STATELESS_READ_TOOL_NAMES,
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_code_actions",
  "run_command",
  "workspace_file_preview",
  "verify_workspace",
  "web_search",
]);
const UNSAFE_TOOLS = new Set([
  "apply_patch",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "workspace_file_apply",
  "bash",
  "javascript_kernel",
  "python_kernel",
  "node_debugger",
  "workspace_process",
  "browser",
  "web_fetch",
  "research_source",
  "create_plan",
  "update_plan_step",
  "update_plan_artifact",
  "delegate_task",
]);
const BLOCK_REASON_ORDER: readonly AutomaticRecoveryBlockReason[] = [
  "configuration_missing",
  "legacy_configuration",
  "policy_manual",
  "run_not_interrupted",
  "workflow_managed",
  "demo_model",
  "event_limit_exceeded",
  "unresolved_tool_call",
  "unsafe_tool_effect",
  "unknown_tool_effect",
  "attempt_limit_reached",
  "untrusted_recovery_chain",
];
const BLOCK_REASONS = new Set(BLOCK_REASON_ORDER);
const ATTEMPT_STATUSES = new Set<AutomaticRecoveryAttempt["status"]>([
  "claimed",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "abandoned",
]);

interface AssessmentOptions {
  run: RunRecord;
  events: RunEvent[];
  rootRunId?: string;
  priorAttempts?: number;
  chainTrusted?: boolean;
  assessedAt?: Date;
}

export interface RunToolEffectObservation {
  toolName: string;
  effect: "read" | "write" | "unknown";
  unresolved: boolean;
}

export function assessAutomaticRecovery(
  options: AssessmentOptions,
): AutomaticRecoveryAssessment {
  const assessedAt = options.assessedAt ?? new Date();
  if (!Number.isFinite(assessedAt.getTime())) {
    throw new Error("Automatic recovery assessment time is invalid");
  }
  const priorAttempts = boundedInteger(
    options.priorAttempts ?? 0,
    "Automatic recovery prior attempts",
    0,
    3,
  );
  const runEvents = options.events
    .filter((event) => event.runId === options.run.id)
    .sort((left, right) => left.seq - right.seq);
  const policy = options.run.configuration
    ? fingerprintAutomaticRecovery(options.run.configuration)
    : structuredClone(DEFAULT_AUTOMATIC_RECOVERY_POLICY);
  const observations = collectRunToolEffectObservations(runEvents);
  const unsafeToolNames = canonicalNames(
    observations
      .filter((observation) => observation.effect === "write")
      .map((observation) => observation.toolName),
  );
  const unknownEffectToolNames = canonicalNames(
    observations
      .filter((observation) => observation.effect === "unknown")
      .map((observation) => observation.toolName),
  );
  const unresolvedToolNames = canonicalNames(
    observations
      .filter((observation) => observation.unresolved)
      .map((observation) => observation.toolName),
  );
  const blockReasons = new Set<AutomaticRecoveryBlockReason>();
  if (!options.run.configuration) {
    blockReasons.add("configuration_missing");
  } else if (options.run.configuration.schemaVersion === 1) {
    blockReasons.add("legacy_configuration");
  } else if (policy.mode === "manual") {
    blockReasons.add("policy_manual");
  }
  if (options.run.status !== "interrupted") {
    blockReasons.add("run_not_interrupted");
  }
  if (
    options.run.source === "workflow" ||
    options.run.source === "workflow_reuse" ||
    options.run.source === "workflow_simulation" ||
    options.run.source === "model_experiment" ||
    options.run.source === "tool_experiment"
  ) {
    blockReasons.add("workflow_managed");
  }
  if (
    options.run.configuration?.model.provider === "napier" &&
    options.run.configuration.model.id === "demo"
  ) {
    blockReasons.add("demo_model");
  }
  if (runEvents.length > MAX_AUTOMATIC_RECOVERY_EVENTS) {
    blockReasons.add("event_limit_exceeded");
  }
  if (unresolvedToolNames.length > 0) {
    blockReasons.add("unresolved_tool_call");
  }
  if (unsafeToolNames.length > 0) {
    blockReasons.add("unsafe_tool_effect");
  }
  if (unknownEffectToolNames.length > 0) {
    blockReasons.add("unknown_tool_effect");
  }
  if (priorAttempts >= policy.maxAttempts) {
    blockReasons.add("attempt_limit_reached");
  }
  if (options.chainTrusted === false) {
    blockReasons.add("untrusted_recovery_chain");
  }
  const orderedReasons = BLOCK_REASON_ORDER.filter((reason) =>
    blockReasons.has(reason),
  );
  const interruptedAt =
    options.run.interruptedAt ??
    options.run.finishedAt ??
    options.run.startedAt;
  const eligibleAt = new Date(
    Date.parse(interruptedAt) +
      Math.min(
        3_600_000,
        policy.backoffMs * Math.pow(2, Math.min(priorAttempts, 10)),
      ),
  ).toISOString();
  const content = {
    schemaVersion: 1 as const,
    threadId: options.run.threadId,
    runId: options.run.id,
    rootRunId: options.rootRunId ?? options.run.id,
    agentId: options.run.agentId,
    ...(options.run.configuration
      ? {
          runConfigurationSha256: options.run.configuration.contentSha256,
        }
      : {}),
    policy,
    eligible: orderedReasons.length === 0,
    blockReasons: orderedReasons,
    toolCalls: {
      total: observations.length,
      readOnly: observations.filter(
        (observation) => observation.effect === "read",
      ).length,
      unsafe: observations.filter(
        (observation) => observation.effect === "write",
      ).length,
      unknownEffect: observations.filter(
        (observation) => observation.effect === "unknown",
      ).length,
      unresolved: observations.filter((observation) => observation.unresolved)
        .length,
    },
    unsafeToolNames,
    unknownEffectToolNames,
    unresolvedToolNames,
    eventRange: {
      fromSeq: runEvents[0]?.seq ?? 0,
      toSeq: runEvents.at(-1)?.seq ?? 0,
      eventCount: runEvents.length,
      eventStreamSha256: hashAutomaticRecoveryEventStream(runEvents),
    },
    priorAttempts,
    eligibleAt,
    assessedAt: assessedAt.toISOString(),
  };
  return validateAutomaticRecoveryAssessment({
    ...content,
    contentSha256: hashAutomaticRecoveryAssessment(content),
  });
}

export function hashAutomaticRecoveryAssessment(
  input: Omit<AutomaticRecoveryAssessment, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function hashAutomaticRecoveryEventStream(events: RunEvent[]): string {
  return sha256(events.map((event) => JSON.stringify(event)).join("\n"));
}

export function validateAutomaticRecoveryAssessment(
  input: unknown,
): AutomaticRecoveryAssessment {
  const assessment = assertExactRecord(
    input,
    "Automatic recovery assessment",
    [
      "schemaVersion",
      "threadId",
      "runId",
      "rootRunId",
      "agentId",
      "policy",
      "eligible",
      "blockReasons",
      "toolCalls",
      "unsafeToolNames",
      "unknownEffectToolNames",
      "unresolvedToolNames",
      "eventRange",
      "priorAttempts",
      "eligibleAt",
      "assessedAt",
      "contentSha256",
    ],
    ["runConfigurationSha256"],
  );
  if (assessment["schemaVersion"] !== 1) {
    throw new Error("Automatic recovery assessment schema is unsupported");
  }
  for (const key of ["threadId", "runId", "rootRunId", "agentId"]) {
    assertResourceId(assessment[key], `Automatic recovery ${key}`);
  }
  if (
    assessment["runConfigurationSha256"] !== undefined &&
    !isSha256(assessment["runConfigurationSha256"])
  ) {
    throw new Error("Automatic recovery run configuration digest is invalid");
  }
  const policy = validatePolicy(assessment["policy"]);
  if (typeof assessment["eligible"] !== "boolean") {
    throw new Error("Automatic recovery eligibility is invalid");
  }
  const blockReasons = assertCanonicalReasons(assessment["blockReasons"]);
  if (assessment["eligible"] !== (blockReasons.length === 0)) {
    throw new Error("Automatic recovery eligibility conflicts with reasons");
  }
  const toolCalls = assertExactRecord(
    assessment["toolCalls"],
    "Automatic recovery tool counts",
    ["total", "readOnly", "unsafe", "unknownEffect", "unresolved"],
  );
  const total = nonNegativeInteger(toolCalls["total"], "toolCalls.total");
  const readOnly = nonNegativeInteger(
    toolCalls["readOnly"],
    "toolCalls.readOnly",
  );
  const unsafe = nonNegativeInteger(toolCalls["unsafe"], "toolCalls.unsafe");
  const unknownEffect = nonNegativeInteger(
    toolCalls["unknownEffect"],
    "toolCalls.unknownEffect",
  );
  const unresolved = nonNegativeInteger(
    toolCalls["unresolved"],
    "toolCalls.unresolved",
  );
  if (total !== readOnly + unsafe + unknownEffect || unresolved > total) {
    throw new Error("Automatic recovery tool counts are inconsistent");
  }
  const unsafeToolNames = assertCanonicalNames(
    assessment["unsafeToolNames"],
    "unsafeToolNames",
  );
  const unknownEffectToolNames = assertCanonicalNames(
    assessment["unknownEffectToolNames"],
    "unknownEffectToolNames",
  );
  const unresolvedToolNames = assertCanonicalNames(
    assessment["unresolvedToolNames"],
    "unresolvedToolNames",
  );
  if (
    unsafe > 0 !== unsafeToolNames.length > 0 ||
    unknownEffect > 0 !== unknownEffectToolNames.length > 0 ||
    unresolved > 0 !== unresolvedToolNames.length > 0
  ) {
    throw new Error("Automatic recovery tool evidence is inconsistent");
  }
  const eventRange = assertExactRecord(
    assessment["eventRange"],
    "Automatic recovery event range",
    ["fromSeq", "toSeq", "eventCount", "eventStreamSha256"],
  );
  const fromSeq = nonNegativeInteger(
    eventRange["fromSeq"],
    "eventRange.fromSeq",
  );
  const toSeq = nonNegativeInteger(eventRange["toSeq"], "eventRange.toSeq");
  const eventCount = nonNegativeInteger(
    eventRange["eventCount"],
    "eventRange.eventCount",
  );
  if (
    !isSha256(eventRange["eventStreamSha256"]) ||
    (eventCount === 0 && (fromSeq !== 0 || toSeq !== 0)) ||
    (eventCount > 0 && (fromSeq < 1 || toSeq < fromSeq))
  ) {
    throw new Error("Automatic recovery event range is invalid");
  }
  const priorAttempts = boundedInteger(
    assessment["priorAttempts"],
    "Automatic recovery prior attempts",
    0,
    3,
  );
  assertIsoDate(assessment["eligibleAt"], "eligibleAt");
  assertIsoDate(assessment["assessedAt"], "assessedAt");
  if (!isSha256(assessment["contentSha256"])) {
    throw new Error("Automatic recovery assessment digest is invalid");
  }
  const normalized: AutomaticRecoveryAssessment = {
    schemaVersion: 1,
    threadId: String(assessment["threadId"]),
    runId: String(assessment["runId"]),
    rootRunId: String(assessment["rootRunId"]),
    agentId: String(assessment["agentId"]),
    ...(assessment["runConfigurationSha256"] !== undefined
      ? {
          runConfigurationSha256: String(assessment["runConfigurationSha256"]),
        }
      : {}),
    policy,
    eligible: Boolean(assessment["eligible"]),
    blockReasons,
    toolCalls: { total, readOnly, unsafe, unknownEffect, unresolved },
    unsafeToolNames,
    unknownEffectToolNames,
    unresolvedToolNames,
    eventRange: {
      fromSeq,
      toSeq,
      eventCount,
      eventStreamSha256: String(eventRange["eventStreamSha256"]),
    },
    priorAttempts,
    eligibleAt: String(assessment["eligibleAt"]),
    assessedAt: String(assessment["assessedAt"]),
    contentSha256: String(assessment["contentSha256"]),
  };
  const { contentSha256, ...content } = normalized;
  if (hashAutomaticRecoveryAssessment(content) !== contentSha256) {
    throw new Error("Automatic recovery assessment hash mismatch");
  }
  return structuredClone(normalized);
}

export function hashAutomaticRecoveryAttempt(
  input: Omit<AutomaticRecoveryAttempt, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateAutomaticRecoveryAttempt(
  input: unknown,
): AutomaticRecoveryAttempt {
  const attempt = assertExactRecord(
    input,
    "Automatic recovery attempt",
    [
      "id",
      "threadId",
      "agentId",
      "rootRunId",
      "interruptedRunId",
      "attempt",
      "maxAttempts",
      "triggerId",
      "assessmentSha256",
      "status",
      "createdAt",
      "updatedAt",
      "revision",
      "contentSha256",
    ],
    ["claim", "recoveryRunId", "error", "startedAt", "finishedAt"],
  );
  for (const key of [
    "id",
    "threadId",
    "agentId",
    "rootRunId",
    "interruptedRunId",
  ]) {
    assertResourceId(attempt[key], `Automatic recovery attempt ${key}`);
  }
  const attemptNumber = boundedInteger(
    attempt["attempt"],
    "Automatic recovery attempt number",
    1,
    3,
  );
  const maxAttempts = boundedInteger(
    attempt["maxAttempts"],
    "Automatic recovery maximum attempts",
    1,
    3,
  );
  if (attemptNumber > maxAttempts) {
    throw new Error("Automatic recovery attempt exceeds its limit");
  }
  const triggerId = safeText(
    attempt["triggerId"],
    "Automatic recovery trigger ID",
    240,
  );
  if (!isSha256(attempt["assessmentSha256"])) {
    throw new Error("Automatic recovery assessment link is invalid");
  }
  const status = attempt["status"];
  if (!ATTEMPT_STATUSES.has(status as AutomaticRecoveryAttempt["status"])) {
    throw new Error("Automatic recovery attempt status is invalid");
  }
  const claim =
    attempt["claim"] === undefined
      ? undefined
      : validateClaim(attempt["claim"]);
  const recoveryRunId =
    attempt["recoveryRunId"] === undefined
      ? undefined
      : assertResourceId(
          attempt["recoveryRunId"],
          "Automatic recovery recoveryRunId",
        );
  const error =
    attempt["error"] === undefined
      ? undefined
      : safeText(attempt["error"], "Automatic recovery error", 1_000);
  const createdAt = assertIsoDate(attempt["createdAt"], "createdAt");
  const updatedAt = assertIsoDate(attempt["updatedAt"], "updatedAt");
  const startedAt =
    attempt["startedAt"] === undefined
      ? undefined
      : assertIsoDate(attempt["startedAt"], "startedAt");
  const finishedAt =
    attempt["finishedAt"] === undefined
      ? undefined
      : assertIsoDate(attempt["finishedAt"], "finishedAt");
  if (
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    (startedAt && Date.parse(startedAt) < Date.parse(createdAt)) ||
    (finishedAt && Date.parse(finishedAt) < Date.parse(startedAt ?? createdAt))
  ) {
    throw new Error("Automatic recovery attempt timestamps are invalid");
  }
  if (
    (status === "claimed" &&
      (!claim || recoveryRunId || startedAt || finishedAt)) ||
    (status === "running" &&
      (!claim || !recoveryRunId || !startedAt || finishedAt)) ||
    ((status === "completed" ||
      status === "failed" ||
      status === "cancelled" ||
      status === "interrupted") &&
      (claim || !recoveryRunId || !startedAt || !finishedAt)) ||
    (status === "abandoned" &&
      (claim || recoveryRunId || startedAt || !finishedAt))
  ) {
    throw new Error("Automatic recovery attempt lifecycle is invalid");
  }
  const revision = boundedInteger(
    attempt["revision"],
    "Automatic recovery attempt revision",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (!isSha256(attempt["contentSha256"])) {
    throw new Error("Automatic recovery attempt digest is invalid");
  }
  const normalized: AutomaticRecoveryAttempt = {
    id: String(attempt["id"]),
    threadId: String(attempt["threadId"]),
    agentId: String(attempt["agentId"]),
    rootRunId: String(attempt["rootRunId"]),
    interruptedRunId: String(attempt["interruptedRunId"]),
    attempt: attemptNumber,
    maxAttempts,
    triggerId,
    assessmentSha256: String(attempt["assessmentSha256"]),
    status: status as AutomaticRecoveryAttempt["status"],
    ...(claim ? { claim } : {}),
    ...(recoveryRunId ? { recoveryRunId } : {}),
    ...(error ? { error } : {}),
    createdAt,
    updatedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    revision,
    contentSha256: String(attempt["contentSha256"]),
  };
  const { contentSha256, ...content } = normalized;
  if (hashAutomaticRecoveryAttempt(content) !== contentSha256) {
    throw new Error("Automatic recovery attempt hash mismatch");
  }
  return structuredClone(normalized);
}

export function collectRunToolEffectObservations(
  events: RunEvent[],
): RunToolEffectObservation[] {
  const terminals = new Map<string, RunEvent[]>();
  for (const event of events) {
    if (event.type !== "tool.completed" && event.type !== "tool.failed") {
      continue;
    }
    const callId = payloadString(event.payload, "callId");
    if (!callId) continue;
    const bucket = terminals.get(callId) ?? [];
    bucket.push(event);
    terminals.set(callId, bucket);
  }
  return events.flatMap((event): RunToolEffectObservation[] => {
    if (event.type !== "tool.started") return [];
    const callId = payloadString(event.payload, "callId");
    const toolName = payloadString(event.payload, "toolName") ?? "unknown_tool";
    const matches = callId
      ? (terminals.get(callId) ?? []).filter(
          (terminal) =>
            terminal.seq > event.seq &&
            payloadString(terminal.payload, "toolName") === toolName,
        )
      : [];
    const terminal = matches.length === 1 ? matches[0] : undefined;
    const effect = UNSAFE_TOOLS.has(toolName)
      ? "write"
      : (toolEffect(event.payload) ??
        (terminal ? toolEffect(terminal.payload) : undefined) ??
        (SAFE_READ_ONLY_TOOLS.has(toolName) ? "read" : "unknown"));
    return [
      {
        toolName: normalizeToolName(toolName),
        effect,
        unresolved: !callId || matches.length !== 1,
      },
    ];
  });
}

function toolEffect(
  payload: JsonValue,
): "read" | "write" | "unknown" | undefined {
  if (!isRecord(payload)) return undefined;
  const direct = payload["effect"];
  if (direct === "read" || direct === "write" || direct === "unknown") {
    return direct;
  }
  const details = payload["details"];
  if (!isRecord(details)) return undefined;
  const nested = details["effect"];
  return nested === "read" || nested === "write" || nested === "unknown"
    ? nested
    : undefined;
}

function payloadString(payload: JsonValue, key: string): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function validatePolicy(value: unknown): AutomaticRecoveryPolicy {
  const policy = assertExactRecord(value, "Automatic recovery policy", [
    "mode",
    "maxAttempts",
    "backoffMs",
  ]);
  return normalizeAutomaticRecoveryPolicy({
    mode:
      policy["mode"] === "manual" || policy["mode"] === "safe_read_only"
        ? policy["mode"]
        : ("invalid" as AutomaticRecoveryPolicy["mode"]),
    maxAttempts: Number(policy["maxAttempts"]),
    backoffMs: Number(policy["backoffMs"]),
  });
}

function validateClaim(
  value: unknown,
): NonNullable<AutomaticRecoveryAttempt["claim"]> {
  const claim = assertExactRecord(value, "Automatic recovery claim", [
    "ownerId",
    "acquiredAt",
    "heartbeatAt",
    "expiresAt",
    "revision",
  ]);
  const ownerId = safeText(
    claim["ownerId"],
    "Automatic recovery claim owner",
    120,
  );
  const acquiredAt = assertIsoDate(claim["acquiredAt"], "claim.acquiredAt");
  const heartbeatAt = assertIsoDate(claim["heartbeatAt"], "claim.heartbeatAt");
  const expiresAt = assertIsoDate(claim["expiresAt"], "claim.expiresAt");
  if (
    Date.parse(heartbeatAt) < Date.parse(acquiredAt) ||
    Date.parse(expiresAt) <= Date.parse(heartbeatAt)
  ) {
    throw new Error("Automatic recovery claim timestamps are invalid");
  }
  return {
    ownerId,
    acquiredAt,
    heartbeatAt,
    expiresAt,
    revision: boundedInteger(
      claim["revision"],
      "Automatic recovery claim revision",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function assertCanonicalReasons(
  value: unknown,
): AutomaticRecoveryBlockReason[] {
  if (!Array.isArray(value)) {
    throw new Error("Automatic recovery block reasons are invalid");
  }
  const reasons = value.map((reason) => {
    if (!BLOCK_REASONS.has(reason as AutomaticRecoveryBlockReason)) {
      throw new Error("Automatic recovery block reasons are invalid");
    }
    return reason as AutomaticRecoveryBlockReason;
  });
  const normalized = BLOCK_REASON_ORDER.filter((reason) =>
    new Set(reasons).has(reason),
  );
  if (
    normalized.length !== reasons.length ||
    JSON.stringify(normalized) !== JSON.stringify(reasons)
  ) {
    throw new Error("Automatic recovery block reasons are not canonical");
  }
  return reasons;
}

function assertCanonicalNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new Error(`Automatic recovery ${label} is invalid`);
  }
  const names = value.map((name) => normalizeToolName(name));
  if (JSON.stringify(names) !== JSON.stringify(canonicalNames(names))) {
    throw new Error(`Automatic recovery ${label} is not canonical`);
  }
  return names;
}

function canonicalNames(values: string[]): string[] {
  return [...new Set(values.map(normalizeToolName))].sort();
}

function normalizeToolName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "unknown_tool";
  }
  return value.trim();
}

function assertExactRecord(
  value: unknown,
  label: string,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const keys = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !keys.has(key))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertResourceId(value: unknown, label: string): string {
  if (typeof value !== "string" || !RESOURCE_ID.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function safeText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}

function assertIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Automatic recovery ${label} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  return boundedInteger(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

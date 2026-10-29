import assert from "node:assert/strict";
import type {
  FrozenModelAccountingBasisV1,
  ModelCallAttributionV1,
  ModelPhysicalObservationV1,
  ModelUsageDiagnosticCode,
} from "@napier/contracts/model-accounting";
import { canonicalJson, sha256 } from "./ed25519.js";
import { validateModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import { validateModelAdapterReceipt } from "./model-adapter-receipt.js";
import { validateCapturedBudgetAllowance, validateModelInputAllowance } from "./model-call-budget-allowance.js";

const HASH = /^[a-f0-9]{64}$/u;
const PHASES = new Set([
  "agent_turn",
  "subagent_turn",
  "typed_repair",
  "outcome_repair",
  "context_compaction",
  "goal_evaluation",
  "memory_extraction",
  "thread_title",
  "independent_model_advisor",
  "context_compaction_preview",
  "model_experiment",
  "evaluation_judgment",
  "replan_review",
  "blueprint_outcome_review",
  "subagent_outcome_review",
  "standalone_model_call",
]);
export const MODEL_USAGE_DIAGNOSTIC_CODES: readonly ModelUsageDiagnosticCode[] =
  [
    "usage_missing",
    "tokens_missing",
    "tokens_invalid",
    "tokens_inconsistent",
    "subset_invalid",
    "cost_missing",
    "cost_invalid",
    "cost_inconsistent",
    "model_mismatch",
    "terminal_unconfirmed",
    "provider_zero_unconfirmed",
    "response_unhashable",
  ];
export const MODEL_USAGE_TOKEN_KEYS = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "totalTokens",
  "reasoning",
  "cacheWrite1h",
] as const;
export const MODEL_USAGE_COST_KEYS = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "total",
] as const;
export const validUsageCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const validUsageCost = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1_000_000;

export function validateFrozenModelAccountingBasis(
  input: unknown,
): FrozenModelAccountingBasisV1 {
  const basis = input as FrozenModelAccountingBasisV1;
  keys(basis, [
    "schemaVersion",
    "normalizationPolicy",
    "providerPriceTable",
    "runPriceTable",
    "runTokenWeights",
    "declaredZeroCost",
    "contentSha256",
  ]);
  assert.equal(basis.schemaVersion, 1);
  assert.equal(basis.normalizationPolicy, "napier.provider-usage.v1");
  assert.equal(typeof basis.declaredZeroCost, "boolean");
  keys(basis.runTokenWeights, ["input", "output", "cacheRead", "cacheWrite"]);
  for (const value of Object.values(basis.runTokenWeights))
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 100);
  if (basis.providerPriceTable !== null) {
    const table = basis.providerPriceTable;
    keys(table, ["input", "output", "cacheRead", "cacheWrite"], ["tiers"]);
    rates(table);
    if (table.tiers !== undefined) {
      assert.ok(Array.isArray(table.tiers) && table.tiers.length <= 100);
      let previous = -1;
      for (const tier of table.tiers) {
        keys(tier, [
          "inputTokensAbove",
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
        ]);
        rates(tier);
        assert.ok(
          validUsageCounter(tier.inputTokensAbove) &&
            tier.inputTokensAbove > previous,
        );
        previous = tier.inputTokensAbove;
      }
    }
  }
  if (basis.runPriceTable !== null) {
    const table = basis.runPriceTable;
    keys(table, [
      "schemaVersion",
      "id",
      "provider",
      "label",
      "inputUsdPerMillion",
      "outputUsdPerMillion",
      "cacheReadUsdPerMillion",
      "cacheWriteUsdPerMillion",
      "effectiveAt",
      "source",
      "tableSha256",
    ]);
    assert.equal(table.schemaVersion, 1);
    for (const name of ["id", "provider", "label", "source"] as const)
      text(table[name]);
    for (const name of [
      "inputUsdPerMillion",
      "outputUsdPerMillion",
      "cacheReadUsdPerMillion",
      "cacheWriteUsdPerMillion",
    ] as const)
      assert.ok(validUsageCost(table[name]));
    date(table.effectiveAt);
    const { tableSha256, ...content } = table;
    assert.equal(
      tableSha256,
      sha256(canonicalJson(content)),
      "Frozen Run tariff hash differs",
    );
  }
  hash(basis);
  return structuredClone(basis);
}

export function validateModelCallAttribution(
  input: unknown,
): ModelCallAttributionV1 {
  const value = input as ModelCallAttributionV1;
  keys(
    value,
    [
      "kind",
      "schemaVersion",
      "physicalId",
      "workspaceLedgerId",
      "receiptSourceId",
      "owner",
      "phase",
      "method",
      "logicalCallId",
      "model",
      "capture",
      "accountingBasis",
      "createdAt",
      "contentSha256",
    ],
    ["hostWorkspaceId", "route", "recovery", "budgetAllowance"],
  );
  assert.equal(value.kind, "napier.model-call-attribution");
  assert.equal(value.schemaVersion, 1);
  for (const id of [
    value.physicalId,
    value.workspaceLedgerId,
    value.receiptSourceId,
    value.logicalCallId,
  ])
    text(id);
  if (value.hostWorkspaceId !== undefined) text(value.hostWorkspaceId);
  assert.ok(PHASES.has(value.phase));
  assert.ok(
    ["stream", "streamSimple", "complete", "completeSimple"].includes(
      value.method,
    ),
  );
  const owner = value.owner;
  if (owner.kind === "run") keys(owner, ["kind", "threadId", "runId"]);
  else if (owner.kind === "child") {
    keys(owner, [
      "kind",
      "threadId",
      "runId",
      "parentRunId",
      "taskId",
      "executionId",
      "childInvocationId",
      "invocationIndex",
    ]);
    assert.ok(validUsageCounter(owner.invocationIndex));
  } else {
    keys(owner, ["kind", "operationId", "operation"]);
    assert.equal(owner.kind, "operation");
    assert.ok(PHASES.has(owner.operation));
  }
  for (const [key, field] of Object.entries(owner))
    if (key !== "invocationIndex") text(field);
  keys(value.model, ["provider", "id", "api"]);
  Object.values(value.model).forEach(text);
  const capture = value.capture;
  keys(capture, [
    "envelope",
    "adapter",
    "contextSha256",
    "generationOptionsSha256",
    "admittedModelSha256",
    "requestSha256",
    "requestScope",
    "privateCapsule",
  ], ["inputAllowance"]);
  validateModelContextEnvelopeReceipt(capture.envelope);
  if (capture.inputAllowance) validateModelInputAllowance(capture.inputAllowance);
  assert.equal(validateModelAdapterReceipt(capture.adapter).schemaVersion, 2);
  assert.equal(
    capture.adapter.modelApi,
    value.model.api,
    "Capture adapter differs from model",
  );
  for (const digest of [
    capture.contextSha256,
    capture.generationOptionsSha256,
    capture.admittedModelSha256,
    capture.requestSha256,
  ])
    assert.match(digest, HASH);
  assert.equal(capture.requestScope, "admitted_input_v1");
  const capsule = capture.privateCapsule;
  if (capsule.status === "available") {
    keys(capsule, ["status", "receiptSha256", "capsuleSha256"]);
    assert.match(capsule.receiptSha256, HASH);
    assert.match(capsule.capsuleSha256, HASH);
  } else if (capsule.status === "unavailable") {
    keys(capsule, ["status", "reason"]);
    assert.ok(["limit", "storage", "invalid"].includes(capsule.reason));
  } else {
    keys(capsule, ["status"]);
    assert.equal(capsule.status, "not_requested");
  }
  if (value.route) {
    keys(value.route, [
      "planId",
      "attempt",
      "stepAttempt",
      "startedEventSeq",
      "candidateSha256",
    ]);
    text(value.route.planId);
    assert.match(value.route.candidateSha256, HASH);
    for (const number of [
      value.route.attempt,
      value.route.stepAttempt,
      value.route.startedEventSeq,
    ])
      assert.ok(validUsageCounter(number));
  }
  if (value.recovery) {
    keys(value.recovery, ["thinkingAttempt", "contextOverflowAttempt"]);
    assert.ok(validUsageCounter(value.recovery.thinkingAttempt));
    assert.ok(
      value.recovery.contextOverflowAttempt === 0 ||
        value.recovery.contextOverflowAttempt === 1,
    );
  }
  validateFrozenModelAccountingBasis(value.accountingBasis);
  if (value.budgetAllowance) validateCapturedBudgetAllowance(capture, value.budgetAllowance);
  date(value.createdAt);
  hash(value);
  assert.ok(
    Buffer.byteLength(canonicalJson(value)) <= 128 * 1024,
    "Model attribution exceeds its bounded metadata limit",
  );
  return structuredClone(value);
}

export function validateModelPhysicalObservation(
  input: unknown,
  attribution?: ModelCallAttributionV1,
): ModelPhysicalObservationV1 {
  const value = input as ModelPhysicalObservationV1;
  keys(value, [
    "schemaVersion",
    "physicalId",
    "attributionSha256",
    "observationScope",
    "terminal",
    "stopReason",
    "usageStatus",
    "usage",
    "responseSha256",
    "diagnosticCodes",
    "observedAt",
    "contentSha256",
  ]);
  assert.equal(value.schemaVersion, 1);
  text(value.physicalId);
  assert.match(value.attributionSha256, HASH);
  assert.equal(value.observationScope, "admitted_provider_invocation");
  assert.ok(["response", "rejected", "undispatched"].includes(value.terminal));
  assert.ok(
    value.stopReason === null ||
      (typeof value.stopReason === "string" && value.stopReason.length <= 64),
  );
  assert.ok(
    ["known", "partial", "unknown", "known_zero_undispatched"].includes(
      value.usageStatus,
    ),
  );
  keys(value.usage, [...MODEL_USAGE_TOKEN_KEYS, "cost"]);
  keys(value.usage.cost, [...MODEL_USAGE_COST_KEYS]);
  for (const key of MODEL_USAGE_TOKEN_KEYS)
    assert.ok(value.usage[key] === null || validUsageCounter(value.usage[key]));
  for (const key of MODEL_USAGE_COST_KEYS)
    assert.ok(
      value.usage.cost[key] === null || validUsageCost(value.usage.cost[key]),
    );
  assert.ok(value.responseSha256 === null || HASH.test(value.responseSha256));
  assert.ok(
    Array.isArray(value.diagnosticCodes) &&
      value.diagnosticCodes.length <= MODEL_USAGE_DIAGNOSTIC_CODES.length,
  );
  assert.deepEqual(
    [...new Set(value.diagnosticCodes)].sort(),
    value.diagnosticCodes,
  );
  assert.ok(
    value.diagnosticCodes.every((code) =>
      MODEL_USAGE_DIAGNOSTIC_CODES.includes(code),
    ),
  );
  if (value.terminal === "undispatched") {
    assert.equal(value.usageStatus, "known_zero_undispatched");
    assert.equal(value.responseSha256, null);
    assert.equal(value.stopReason, null);
    assert.deepEqual(value.diagnosticCodes, []);
    for (const key of MODEL_USAGE_TOKEN_KEYS) assert.equal(value.usage[key], 0);
    for (const key of MODEL_USAGE_COST_KEYS)
      assert.equal(value.usage.cost[key], 0);
  } else {
    assert.notEqual(value.usageStatus, "known_zero_undispatched");
    const positive =
      MODEL_USAGE_TOKEN_KEYS.some((key) => (value.usage[key] ?? 0) > 0) ||
      MODEL_USAGE_COST_KEYS.some((key) => (value.usage.cost[key] ?? 0) > 0);
    if (value.usageStatus === "known")
      assert.ok(
        physicalTokensComplete(value) && physicalCostComplete(value),
        "Known usage is incomplete",
      );
    if (value.usageStatus === "partial")
      assert.ok(positive, "Partial usage must preserve positive evidence");
    if (value.usageStatus === "unknown")
      assert.ok(!positive, "Unknown usage cannot discard positive evidence");
  }
  date(value.observedAt);
  hash(value);
  if (attribution) {
    assert.equal(value.physicalId, attribution.physicalId);
    assert.equal(value.attributionSha256, attribution.contentSha256);
    assert.ok(
      Date.parse(value.observedAt) >= Date.parse(attribution.createdAt),
      "Observation predates attribution",
    );
    if (value.usageStatus === "known") {
      const basis = attribution.accountingBasis,
        table = basis.runPriceTable;
      assert.ok(
        basis.declaredZeroCost ||
          (value.usage.cost.total ?? 0) > 0 ||
          (table &&
            [
              table.inputUsdPerMillion,
              table.outputUsdPerMillion,
              table.cacheReadUsdPerMillion,
              table.cacheWriteUsdPerMillion,
            ].some((rate) => rate > 0)),
        "Known usage lacks a frozen cost basis",
      );
    }
  }
  return structuredClone(value);
}

export function physicalTokensComplete(
  value: ModelPhysicalObservationV1,
): boolean {
  const usage = value.usage,
    parts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  const sum = parts.reduce<number>((total, part) => total + (part ?? 0), 0);
  return (
    confirmed(value) &&
    parts.every(validUsageCounter) &&
    validUsageCounter(usage.totalTokens) &&
    sum > 0 &&
    Number.isSafeInteger(sum) &&
    sum === usage.totalTokens &&
    (usage.reasoning === null || usage.reasoning <= (usage.output ?? 0)) &&
    (usage.cacheWrite1h === null ||
      usage.cacheWrite1h <= (usage.cacheWrite ?? 0)) &&
    !value.diagnosticCodes.some((code) =>
      [
        "tokens_missing",
        "tokens_invalid",
        "tokens_inconsistent",
        "subset_invalid",
      ].includes(code),
    )
  );
}
export function physicalCostComplete(
  value: ModelPhysicalObservationV1,
): boolean {
  const cost = value.usage.cost,
    parts = [cost.input, cost.output, cost.cacheRead, cost.cacheWrite];
  const sum = parts.reduce<number>((total, part) => total + (part ?? 0), 0);
  return (
    confirmed(value) &&
    parts.every(validUsageCost) &&
    validUsageCost(cost.total) &&
    Math.abs(sum - cost.total) <= 1e-9 &&
    !value.diagnosticCodes.some((code) =>
      ["cost_missing", "cost_invalid", "cost_inconsistent"].includes(code),
    )
  );
}
function confirmed(value: ModelPhysicalObservationV1): boolean {
  return (
    value.terminal === "response" &&
    ["stop", "length", "toolUse"].includes(value.stopReason ?? "") &&
    !value.diagnosticCodes.includes("model_mismatch") &&
    !value.diagnosticCodes.includes("terminal_unconfirmed")
  );
}
function rates(value: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}) {
  for (const rate of [
    value.input,
    value.output,
    value.cacheRead,
    value.cacheWrite,
  ])
    assert.ok(validUsageCost(rate));
}
function keys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    "Model accounting object is invalid",
  );
  const observed = Object.keys(value);
  assert.ok(
    required.every((key) => observed.includes(key)) &&
      observed.every((key) => required.includes(key) || optional.includes(key)),
    "Unsupported model accounting fields",
  );
}
function hash(value: { contentSha256: string }) {
  const { contentSha256, ...content } = value;
  assert.match(contentSha256, HASH);
  assert.equal(
    contentSha256,
    sha256(canonicalJson(content)),
    "Model accounting hash differs",
  );
}
function text(value: unknown) {
  assert.ok(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 256 &&
      !/[\u0000-\u001f]/u.test(value),
  );
}
function date(value: string) {
  assert.ok(
    Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "Model accounting timestamp is invalid",
  );
}

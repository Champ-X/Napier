import type { Api, Model } from "@earendil-works/pi-ai";
import type { UsagePriceTable } from "@napier/contracts";
import type {
  FrozenModelAccountingBasisV1,
  ModelCallAttributionV1,
  ModelObservationUsageProjection,
  ModelPhysicalObservationV1,
  ModelUsageDiagnosticCode,
  ValidatedProviderUsageComponentsV1,
} from "@napier/contracts/model-accounting";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  builtinUsagePriceTableCatalog,
  createUsageAccounting,
} from "./token-accounting.js";
import {
  readModelUndispatchedProof,
  type ModelUndispatchedProof,
} from "./model-call-attribution.js";
import {
  MODEL_USAGE_COST_KEYS,
  MODEL_USAGE_TOKEN_KEYS,
  physicalCostComplete,
  physicalTokensComplete,
  validUsageCost,
  validUsageCounter,
  validateFrozenModelAccountingBasis,
  validateModelCallAttribution,
  validateModelPhysicalObservation,
} from "./model-usage-validation.js";

export {
  validateFrozenModelAccountingBasis,
  validateModelCallAttribution,
  validateModelPhysicalObservation,
} from "./model-usage-validation.js";

const undispatchedObservationProofs = new WeakMap<object, string>();

export function freezeModelAccountingBasis(
  model: Model<Api>,
  options: {
    runPriceTables?: UsagePriceTable[];
    declaredZeroCost?: boolean;
  } = {},
): FrozenModelAccountingBasisV1 {
  const zero = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  const accounting = createUsageAccounting(
    model,
    zero,
    options.runPriceTables ? { priceTables: options.runPriceTables } : {},
  );
  const runPriceTable =
    [
      ...(options.runPriceTables ?? []),
      ...builtinUsagePriceTableCatalog(new Date(0)).tables,
    ].find((table) => table.tableSha256 === accounting.priceTableSha256) ??
    null;
  let providerPriceTable: FrozenModelAccountingBasisV1["providerPriceTable"] =
    null;
  try {
    const source = model.cost;
    const rate = (value: typeof source) => ({
      input: value.input,
      output: value.output,
      cacheRead: value.cacheRead,
      cacheWrite: value.cacheWrite,
    });
    const candidate = {
      ...rate(source),
      ...(source.tiers
        ? {
            tiers: source.tiers.map((tier) => ({
              inputTokensAbove: tier.inputTokensAbove,
              ...rate(tier),
            })),
          }
        : {}),
    };
    if (
      [candidate, ...(candidate.tiers ?? [])].every((tier) =>
        [tier.input, tier.output, tier.cacheRead, tier.cacheWrite].every(
          validUsageCost,
        ),
      )
    )
      providerPriceTable = structuredClone(candidate);
  } catch {
    /* A malformed provider tariff remains explicitly unavailable. */
  }
  return validateFrozenModelAccountingBasis(
    hashed({
      schemaVersion: 1,
      normalizationPolicy: "napier.provider-usage.v1",
      providerPriceTable,
      runPriceTable: runPriceTable ? structuredClone(runPriceTable) : null,
      declaredZeroCost: options.declaredZeroCost === true,
      runTokenWeights: {
        input: accounting.inputWeight,
        output: accounting.outputWeight,
        cacheRead: accounting.cacheReadWeight,
        cacheWrite: accounting.cacheWriteWeight,
      },
    }),
  );
}

export function normalizeModelPhysicalObservation(input: {
  attribution: ModelCallAttributionV1;
  message?: unknown;
  terminal: "response" | "rejected";
  observedAt?: string;
}): ModelPhysicalObservationV1 {
  const attribution = validateModelCallAttribution(input.attribution);
  const diagnostics = new Set<ModelUsageDiagnosticCode>();
  const usage = readComponents(read(input.message, "usage"), diagnostics);
  diagnoseComponents(usage, diagnostics);
  const { stopReason, responseSha256 } = observeMetadata(
    input.message,
    input.terminal,
    attribution,
    diagnostics,
  );
  const positive =
    MODEL_USAGE_TOKEN_KEYS.some((key) => (usage[key] ?? 0) > 0) ||
    MODEL_USAGE_COST_KEYS.some((key) => (usage.cost[key] ?? 0) > 0);
  let observation = hashed({
    schemaVersion: 1 as const,
    physicalId: attribution.physicalId,
    attributionSha256: attribution.contentSha256,
    observationScope: "admitted_provider_invocation" as const,
    terminal: input.terminal,
    stopReason,
    usageStatus: positive ? ("partial" as const) : ("unknown" as const),
    usage,
    responseSha256,
    diagnosticCodes: [...diagnostics].sort(),
    observedAt: input.observedAt ?? new Date().toISOString(),
  }) as ModelPhysicalObservationV1;
  const projection = projectModelObservationUsage(attribution, observation);
  if (
    projection.tokenCompleteness === "complete" &&
    projection.reportedCostCompleteness === "complete" &&
    projection.budgetCostCompleteness === "complete"
  ) {
    const { contentSha256: _old, ...content } = observation;
    observation = hashed({ ...content, usageStatus: "known" });
  }
  return validateModelPhysicalObservation(observation, attribution);
}

export function createUndispatchedModelObservation(
  attributionInput: ModelCallAttributionV1,
  proof: ModelUndispatchedProof,
  observedAt = new Date().toISOString(),
): ModelPhysicalObservationV1 {
  const attribution = validateModelCallAttribution(attributionInput),
    binding = readModelUndispatchedProof(proof);
  if (
    binding.physicalId !== attribution.physicalId ||
    binding.attributionSha256 !== attribution.contentSha256
  )
    throw new Error("Undispatched proof differs from attribution");
  const observation = validateModelPhysicalObservation(
    hashed({
      schemaVersion: 1,
      physicalId: attribution.physicalId,
      attributionSha256: attribution.contentSha256,
      observationScope: "admitted_provider_invocation",
      terminal: "undispatched",
      stopReason: null,
      usageStatus: "known_zero_undispatched",
      usage: emptyComponents(0),
      responseSha256: null,
      diagnosticCodes: [],
      observedAt,
    }),
    attribution,
  );
  undispatchedObservationProofs.set(observation, observation.contentSha256);
  return observation;
}

/** A digest or JSON copy cannot authorize a new pre-entry zero receipt. */
export function assertUndispatchedObservationAuthority(
  input: ModelPhysicalObservationV1,
  validated: ModelPhysicalObservationV1,
): void {
  if (undispatchedObservationProofs.get(input) !== validated.contentSha256)
    throw new Error(
      "Undispatched observation requires private driver proof authority",
    );
}

export function projectModelObservationUsage(
  attribution: ModelCallAttributionV1,
  input: ModelPhysicalObservationV1,
): ModelObservationUsageProjection {
  const observation = validateModelPhysicalObservation(input, attribution),
    raw = observation.usage;
  const usage = positiveUsageSubtotal(raw);
  if (observation.usageStatus === "known_zero_undispatched")
    return {
      usage,
      tokenCompleteness: "complete",
      reportedCostCompleteness: "complete",
      budgetCostCompleteness: "complete",
      budgetTokens: 0,
      budgetCostUsd: 0,
    };
  const tokensComplete = physicalTokensComplete(observation),
    reportedComplete = physicalCostComplete(observation);
  return {
    usage,
    tokenCompleteness: tokensComplete ? "complete" : "incomplete",
    reportedCostCompleteness: reportedComplete ? "complete" : "incomplete",
    ...projectFrozenBudget(
      usage,
      raw,
      attribution.accountingBasis,
      tokensComplete,
      reportedComplete,
    ),
  };
}

function positiveUsageSubtotal(
  raw: ValidatedProviderUsageComponentsV1,
): ModelObservationUsageProjection["usage"] {
  return {
    inputTokens: raw.input ?? 0,
    outputTokens: Math.max(raw.output ?? 0, raw.reasoning ?? 0),
    cacheReadTokens: raw.cacheRead ?? 0,
    cacheWriteTokens: Math.max(raw.cacheWrite ?? 0, raw.cacheWrite1h ?? 0),
    costUsd: Math.max(
      raw.cost.total ?? 0,
      (raw.cost.input ?? 0) +
        (raw.cost.output ?? 0) +
        (raw.cost.cacheRead ?? 0) +
        (raw.cost.cacheWrite ?? 0),
    ),
  };
}
function projectFrozenBudget(
  usage: ModelObservationUsageProjection["usage"],
  raw: ValidatedProviderUsageComponentsV1,
  basis: FrozenModelAccountingBasisV1,
  tokensComplete: boolean,
  reportedComplete: boolean,
): Pick<
  ModelObservationUsageProjection,
  "budgetTokens" | "budgetCostUsd" | "budgetCostCompleteness"
> {
  const weights = basis.runTokenWeights;
  const sum =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheWriteTokens;
  const unclassified = Math.max(0, (raw.totalTokens ?? 0) - sum);
  const budgetTokens = Math.ceil(
    usage.inputTokens * weights.input +
      usage.outputTokens * weights.output +
      usage.cacheReadTokens * weights.cacheRead +
      usage.cacheWriteTokens * weights.cacheWrite +
      unclassified * Math.max(...Object.values(weights)),
  );
  if (!Number.isSafeInteger(budgetTokens))
    throw new Error("Model usage exceeds safe token precision");
  const table = basis.runPriceTable;
  const hasRate = Boolean(
    table &&
    [
      table.inputUsdPerMillion,
      table.outputUsdPerMillion,
      table.cacheReadUsdPerMillion,
      table.cacheWriteUsdPerMillion,
    ].some((rate) => rate > 0),
  );
  const estimated = table
    ? (usage.inputTokens * table.inputUsdPerMillion +
        usage.outputTokens * table.outputUsdPerMillion +
        usage.cacheReadTokens * table.cacheReadUsdPerMillion +
        usage.cacheWriteTokens * table.cacheWriteUsdPerMillion +
        unclassified *
          Math.max(
            table.inputUsdPerMillion,
            table.outputUsdPerMillion,
            table.cacheReadUsdPerMillion,
            table.cacheWriteUsdPerMillion,
          )) /
      1_000_000
    : 0;
  const budgetCostUsd = basis.declaredZeroCost
    ? usage.costUsd
    : hasRate || usage.costUsd > 0
      ? Math.max(usage.costUsd, estimated)
      : null;
  if (budgetCostUsd !== null && !Number.isFinite(budgetCostUsd))
    throw new Error("Model usage exceeds safe cost precision");
  return {
    budgetCostCompleteness:
      tokensComplete &&
      (hasRate ||
        basis.declaredZeroCost ||
        (reportedComplete && usage.costUsd > 0))
        ? "complete"
        : "incomplete",
    budgetTokens,
    budgetCostUsd,
  };
}

function readComponents(
  raw: unknown,
  diagnostics: Set<ModelUsageDiagnosticCode>,
): ValidatedProviderUsageComponentsV1 {
  const rawCost = read(raw, "cost"),
    usage = emptyComponents(null);
  if (!record(raw)) diagnostics.add("usage_missing");
  for (const key of MODEL_USAGE_TOKEN_KEYS) {
    const value = read(raw, key);
    if (validUsageCounter(value)) usage[key] = value;
    else if (key === "reasoning" || key === "cacheWrite1h") {
      if (value !== undefined) diagnostics.add("subset_invalid");
    } else
      diagnostics.add(
        value === undefined ? "tokens_missing" : "tokens_invalid",
      );
  }
  for (const key of MODEL_USAGE_COST_KEYS) {
    const value = read(rawCost, key);
    if (validUsageCost(value)) usage.cost[key] = value;
    else diagnostics.add(value === undefined ? "cost_missing" : "cost_invalid");
  }
  return usage;
}
function diagnoseComponents(
  usage: ValidatedProviderUsageComponentsV1,
  diagnostics: Set<ModelUsageDiagnosticCode>,
): void {
  const parts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  const sum = parts.reduce<number>((total, value) => total + (value ?? 0), 0);
  if (
    parts.every(validUsageCounter) &&
    validUsageCounter(usage.totalTokens) &&
    (!Number.isSafeInteger(sum) || sum !== usage.totalTokens)
  )
    diagnostics.add("tokens_inconsistent");
  if (
    (usage.reasoning !== null &&
      (usage.output === null || usage.reasoning > usage.output)) ||
    (usage.cacheWrite1h !== null &&
      (usage.cacheWrite === null || usage.cacheWrite1h > usage.cacheWrite))
  )
    diagnostics.add("subset_invalid");
  const costs = [
    usage.cost.input,
    usage.cost.output,
    usage.cost.cacheRead,
    usage.cost.cacheWrite,
  ];
  if (
    costs.every(validUsageCost) &&
    validUsageCost(usage.cost.total) &&
    Math.abs(
      costs.reduce<number>((total, value) => total + (value ?? 0), 0) -
        usage.cost.total,
    ) > 1e-9
  )
    diagnostics.add("cost_inconsistent");
  if (parts.every((value) => value === 0) && usage.totalTokens === 0)
    diagnostics.add("provider_zero_unconfirmed");
}
function observeMetadata(
  message: unknown,
  terminal: "response" | "rejected",
  attribution: ModelCallAttributionV1,
  diagnostics: Set<ModelUsageDiagnosticCode>,
): { stopReason: string | null; responseSha256: string | null } {
  if (
    read(message, "provider") !== attribution.model.provider ||
    read(message, "model") !== attribution.model.id
  )
    diagnostics.add("model_mismatch");
  const rawStop = read(message, "stopReason");
  const stopReason =
    typeof rawStop === "string" &&
    ["stop", "length", "toolUse", "error", "aborted"].includes(rawStop)
      ? rawStop
      : null;
  if (
    terminal !== "response" ||
    !["stop", "length", "toolUse"].includes(stopReason ?? "")
  )
    diagnostics.add("terminal_unconfirmed");
  let responseSha256: string | null = null;
  if (message !== undefined) {
    try {
      const serialized = canonicalJson(message);
      if (Buffer.byteLength(serialized) <= 8 * 1024 * 1024)
        responseSha256 = sha256(serialized);
      else diagnostics.add("response_unhashable");
    } catch {
      diagnostics.add("response_unhashable");
    }
  }
  return { stopReason, responseSha256 };
}

function emptyComponents(
  value: number | null,
): ValidatedProviderUsageComponentsV1 {
  return {
    input: value,
    output: value,
    cacheRead: value,
    cacheWrite: value,
    totalTokens: value,
    reasoning: value,
    cacheWrite1h: value,
    cost: {
      input: value,
      output: value,
      cacheRead: value,
      cacheWrite: value,
      total: value,
    },
  };
}
function hashed<T extends object>(value: T): T & { contentSha256: string } {
  return { ...value, contentSha256: sha256(canonicalJson(value)) };
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const GETTER_FAILURE = Symbol("provider getter failed");
function read(value: unknown, key: string): unknown {
  try {
    return record(value) ? value[key] : undefined;
  } catch {
    return GETTER_FAILURE;
  }
}

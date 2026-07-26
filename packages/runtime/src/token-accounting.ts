import type {
  ModelRef,
  Usage,
  UsageAccounting,
  UsageCostAccountingStrategy,
  UsageAccountingStrategy,
  UsagePriceTable,
  UsagePriceTableCatalog,
  UsagePriceTableVerification,
} from "@napier/contracts";
import { NAPIER_API_VERSION } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

interface UsageWeights {
  strategy: UsageAccountingStrategy;
  inputWeight: number;
  outputWeight: number;
  cacheReadWeight: number;
  cacheWriteWeight: number;
}

export function createUsageAccounting(
  model: ModelRef,
  usage: Usage,
  options: {
    priceTables?: UsagePriceTable[];
  } = {},
): UsageAccounting {
  const weights = usageWeights(model);
  const priceTable = costPriceTable(model, options.priceTables);
  const estimatedCostUsd = estimateCostUsd(usage, priceTable);
  const costStrategy = costAccountingStrategy(model, usage, priceTable);
  const budgetCostUsd =
    costStrategy === "zero_cost"
      ? 0
      : costStrategy === "price_table_estimate"
        ? Math.max(usage.costUsd, estimatedCostUsd)
        : usage.costUsd;
  const rawTotalTokens = totalRawTokens(usage);
  const budgetTokens = Math.ceil(
    usage.inputTokens * weights.inputWeight +
      usage.outputTokens * weights.outputWeight +
      usage.cacheReadTokens * weights.cacheReadWeight +
      usage.cacheWriteTokens * weights.cacheWriteWeight,
  );
  const content = {
    schemaVersion: 1 as const,
    model: `${model.provider}/${model.id}`,
    strategy: weights.strategy,
    rawTotalTokens,
    budgetTokens,
    reportedCostUsd: usage.costUsd,
    estimatedCostUsd,
    budgetCostUsd,
    costStrategy,
    priceTableId: priceTable.id,
    priceTableSha256: priceTable.tableSha256,
    inputWeight: weights.inputWeight,
    outputWeight: weights.outputWeight,
    cacheReadWeight: weights.cacheReadWeight,
    cacheWriteWeight: weights.cacheWriteWeight,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createUsagePriceTableCatalog(
  input: {
    tables?: Omit<UsagePriceTable, "schemaVersion" | "tableSha256">[];
    generatedAt?: Date;
  } = {},
): UsagePriceTableCatalog {
  const generatedAt = input.generatedAt ?? new Date();
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Usage price table catalog time is invalid");
  }
  const tables = (input.tables ?? builtinUsagePriceTableInputs()).map(
    createUsagePriceTable,
  );
  const content = {
    kind: "napier.usage-price-table-catalog" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    tables: sortPriceTables(tables),
  };
  return {
    ...content,
    generatedAt: generatedAt.toISOString(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function verifyUsagePriceTableCatalog(
  input: UsagePriceTableCatalog,
  options: { requiredProviders?: string[] } = {},
): UsagePriceTableVerification {
  const diagnostics: string[] = [];
  if (
    input.kind !== "napier.usage-price-table-catalog" ||
    input.schemaVersion !== 1 ||
    input.apiVersion !== NAPIER_API_VERSION ||
    !Number.isFinite(Date.parse(input.generatedAt)) ||
    !Array.isArray(input.tables)
  ) {
    return {
      status: "invalid",
      tableCount: 0,
      providers: [],
      diagnostics: ["catalog_header_invalid"],
    };
  }
  const providers = new Set<string>();
  const ids = new Set<string>();
  const tables: UsagePriceTable[] = [];
  for (const table of input.tables) {
    const normalized = normalizeUsagePriceTable(table);
    if (!normalized) {
      diagnostics.push(`table_invalid:${priceTableDiagnosticId(table)}`);
      continue;
    }
    if (ids.has(normalized.id)) {
      diagnostics.push(`table_id_duplicate:${normalized.id}`);
    }
    ids.add(normalized.id);
    if (providers.has(normalized.provider)) {
      diagnostics.push(`provider_duplicate:${normalized.provider}`);
    }
    providers.add(normalized.provider);
    if (normalized.tableSha256 !== hashUsagePriceTable(normalized)) {
      diagnostics.push(`table_hash_mismatch:${normalized.id}`);
    }
    tables.push(normalized);
  }
  const content = {
    kind: input.kind,
    schemaVersion: input.schemaVersion,
    apiVersion: input.apiVersion,
    tables: sortPriceTables(tables),
  };
  if (sha256(canonicalJson(content)) !== input.contentSha256) {
    diagnostics.push("catalog_hash_mismatch");
  }
  const requiredProviders = (options.requiredProviders ?? []).map(
    normalizeProvider,
  );
  for (const provider of requiredProviders) {
    if (!providers.has(provider))
      diagnostics.push(`provider_missing:${provider}`);
  }
  return {
    status:
      diagnostics.length > 0
        ? diagnostics.some((item) => item.startsWith("provider_missing:")) &&
          diagnostics.every((item) => item.startsWith("provider_missing:"))
          ? "provider_missing"
          : "invalid"
        : "valid",
    ...(input.contentSha256 ? { catalogSha256: input.contentSha256 } : {}),
    tableCount: tables.length,
    providers: [...providers].sort(),
    diagnostics,
  };
}

export function builtinUsagePriceTableCatalog(
  generatedAt = new Date(),
): UsagePriceTableCatalog {
  return createUsagePriceTableCatalog({ generatedAt });
}

export function usageBudgetTokens(
  usage: Usage,
  accounting?: UsageAccounting,
): number {
  if (
    accounting &&
    accounting.schemaVersion === 1 &&
    Number.isFinite(accounting.budgetTokens) &&
    accounting.budgetTokens >= 0
  ) {
    return accounting.budgetTokens;
  }
  return totalRawTokens(usage);
}

export function usageBudgetCostUsd(
  usage: Usage,
  accounting?: UsageAccounting,
): number {
  if (
    accounting &&
    accounting.schemaVersion === 1 &&
    Number.isFinite(accounting.budgetCostUsd) &&
    accounting.budgetCostUsd >= 0
  ) {
    return accounting.budgetCostUsd;
  }
  return usage.costUsd;
}

export function totalRawTokens(usage: Usage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheWriteTokens
  );
}

function estimateCostUsd(usage: Usage, priceTable: UsagePriceTable): number {
  return roundCost(
    (usage.inputTokens * priceTable.inputUsdPerMillion +
      usage.outputTokens * priceTable.outputUsdPerMillion +
      usage.cacheReadTokens * priceTable.cacheReadUsdPerMillion +
      usage.cacheWriteTokens * priceTable.cacheWriteUsdPerMillion) /
      1_000_000,
  );
}

function costAccountingStrategy(
  model: ModelRef,
  usage: Usage,
  priceTable: UsagePriceTable,
): UsageCostAccountingStrategy {
  if (model.provider.toLowerCase() === "napier") return "zero_cost";
  if (priceTable.id === "provider-reported.v1") {
    return "provider_reported_cost";
  }
  return usage.costUsd > 0 &&
    usage.costUsd >= estimateCostUsd(usage, priceTable)
    ? "provider_reported_cost"
    : "price_table_estimate";
}

function costPriceTable(
  model: ModelRef,
  overrides: UsagePriceTable[] = [],
): UsagePriceTable {
  const provider = normalizeProvider(model.provider);
  const override = overrides
    .map(normalizeUsagePriceTable)
    .find((table) => table?.provider === provider);
  if (override) return override;
  return (
    builtinUsagePriceTableCatalog(new Date(0)).tables.find(
      (table) => table.provider === provider,
    ) ?? createUsagePriceTable(providerReportedPriceTableInput(provider))
  );
}

function roundCost(value: number): number {
  return Number(value.toFixed(12));
}

function builtinUsagePriceTableInputs(): Omit<
  UsagePriceTable,
  "schemaVersion" | "tableSha256"
>[] {
  return [
    {
      id: "napier-demo-zero.v1",
      provider: "napier",
      label: "Napier demo zero-cost model",
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      cacheReadUsdPerMillion: 0,
      cacheWriteUsdPerMillion: 0,
      effectiveAt: "2026-07-25T00:00:00.000Z",
      source: "napier_builtin",
    },
    {
      id: "openai-compatible-default.v1",
      provider: "openai",
      label: "OpenAI-compatible default",
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 10,
      cacheReadUsdPerMillion: 0.625,
      cacheWriteUsdPerMillion: 2.5,
      effectiveAt: "2026-07-25T00:00:00.000Z",
      source: "napier_builtin",
    },
    {
      id: "openrouter-compatible-default.v1",
      provider: "openrouter",
      label: "OpenRouter OpenAI-compatible default",
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 10,
      cacheReadUsdPerMillion: 0.625,
      cacheWriteUsdPerMillion: 2.5,
      effectiveAt: "2026-07-25T00:00:00.000Z",
      source: "napier_builtin",
    },
    {
      id: "anthropic-default.v1",
      provider: "anthropic",
      label: "Anthropic default",
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      cacheReadUsdPerMillion: 0.3,
      cacheWriteUsdPerMillion: 3.75,
      effectiveAt: "2026-07-25T00:00:00.000Z",
      source: "napier_builtin",
    },
    {
      id: "google-default.v1",
      provider: "google",
      label: "Google default",
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 5,
      cacheReadUsdPerMillion: 0.3125,
      cacheWriteUsdPerMillion: 1.25,
      effectiveAt: "2026-07-25T00:00:00.000Z",
      source: "napier_builtin",
    },
  ];
}

function providerReportedPriceTableInput(
  provider: string,
): Omit<UsagePriceTable, "schemaVersion" | "tableSha256"> {
  return {
    id: "provider-reported.v1",
    provider,
    label: "Provider-reported fallback",
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    cacheReadUsdPerMillion: 0,
    cacheWriteUsdPerMillion: 0,
    effectiveAt: "2026-07-25T00:00:00.000Z",
    source: "provider_reported_fallback",
  };
}

function createUsagePriceTable(
  input: Omit<UsagePriceTable, "schemaVersion" | "tableSha256">,
): UsagePriceTable {
  const table = {
    schemaVersion: 1 as const,
    id: input.id.trim(),
    provider: normalizeProvider(input.provider),
    label: input.label.trim(),
    inputUsdPerMillion: input.inputUsdPerMillion,
    outputUsdPerMillion: input.outputUsdPerMillion,
    cacheReadUsdPerMillion: input.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: input.cacheWriteUsdPerMillion,
    effectiveAt: input.effectiveAt,
    source: input.source.trim(),
  };
  return {
    ...table,
    tableSha256: hashUsagePriceTable(table),
  };
}

function normalizeUsagePriceTable(input: unknown): UsagePriceTable | undefined {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    return undefined;
  }
  const table = input as Partial<UsagePriceTable>;
  if (
    table.schemaVersion !== 1 ||
    typeof table.id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{2,120}$/.test(table.id) ||
    typeof table.provider !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{1,80}$/.test(normalizeProvider(table.provider)) ||
    typeof table.label !== "string" ||
    table.label.trim().length === 0 ||
    table.label.length > 160 ||
    typeof table.source !== "string" ||
    table.source.trim().length === 0 ||
    table.source.length > 200 ||
    typeof table.effectiveAt !== "string" ||
    !Number.isFinite(Date.parse(table.effectiveAt)) ||
    !validPrice(table.inputUsdPerMillion) ||
    !validPrice(table.outputUsdPerMillion) ||
    !validPrice(table.cacheReadUsdPerMillion) ||
    !validPrice(table.cacheWriteUsdPerMillion) ||
    typeof table.tableSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(table.tableSha256)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    id: table.id.trim(),
    provider: normalizeProvider(table.provider),
    label: table.label.trim(),
    inputUsdPerMillion: table.inputUsdPerMillion,
    outputUsdPerMillion: table.outputUsdPerMillion,
    cacheReadUsdPerMillion: table.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: table.cacheWriteUsdPerMillion,
    effectiveAt: table.effectiveAt,
    source: table.source.trim(),
    tableSha256: table.tableSha256,
  };
}

function hashUsagePriceTable(
  input: Omit<UsagePriceTable, "tableSha256"> | UsagePriceTable,
): string {
  const { tableSha256: _tableSha256, ...content } = input as UsagePriceTable;
  return sha256(canonicalJson(content));
}

function sortPriceTables(tables: UsagePriceTable[]): UsagePriceTable[] {
  return structuredClone(tables).sort((left, right) =>
    `${left.provider}/${left.id}`.localeCompare(
      `${right.provider}/${right.id}`,
    ),
  );
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function priceTableDiagnosticId(input: unknown): string {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    return "unknown";
  }
  const id = (input as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : "unknown";
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function usageWeights(model: ModelRef): UsageWeights {
  const provider = model.provider.toLowerCase();
  if (provider === "napier") {
    return {
      strategy: "demo_estimate",
      inputWeight: 1,
      outputWeight: 1,
      cacheReadWeight: 1,
      cacheWriteWeight: 1,
    };
  }
  if (provider === "openai" || provider === "openrouter") {
    return {
      strategy: "openai_cache_discounted",
      inputWeight: 1,
      outputWeight: 1,
      cacheReadWeight: 0.25,
      cacheWriteWeight: 1,
    };
  }
  if (provider === "anthropic") {
    return {
      strategy: "anthropic_cache_discounted",
      inputWeight: 1,
      outputWeight: 1,
      cacheReadWeight: 0.1,
      cacheWriteWeight: 1.25,
    };
  }
  if (provider === "google") {
    return {
      strategy: "google_cache_discounted",
      inputWeight: 1,
      outputWeight: 1,
      cacheReadWeight: 0.25,
      cacheWriteWeight: 1,
    };
  }
  return {
    strategy: "provider_reported",
    inputWeight: 1,
    outputWeight: 1,
    cacheReadWeight: 1,
    cacheWriteWeight: 1,
  };
}

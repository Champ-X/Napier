import { calculateCost, type Api, type AssistantMessage, type Model, type StreamOptions } from "@earendil-works/pi-ai";

export interface WorkspaceModelBudgetOptions {
  epoch?: string;
  maxConcurrent?: number;
  maxInvocations?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  /** Explicitly declared free models; zero SDK prices alone do not prove free usage. */
  zeroCostModels?: string[];
}

export const USD_NANOS = 1_000_000_000;

export function workspaceModelBudgetPolicy(options: WorkspaceModelBudgetOptions = {}) {
  const epoch = options.epoch ?? "default";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(epoch)) throw new Error("Invalid model budget epoch");
  const maxConcurrent = integer(options.maxConcurrent ?? 8, 1, 256);
  const zeroCostModels = [...new Set(options.zeroCostModels ?? [])].sort();
  if (zeroCostModels.some((key) => !/^[^\s/]{1,100}\/[^\s]{1,200}$/u.test(key))) throw new Error("Invalid free model declaration");
  return {
    epoch, maxConcurrent,
    maxInvocations: options.maxInvocations === undefined ? null : integer(options.maxInvocations, 0, 1_000_000_000),
    maxTokens: options.maxTokens === undefined ? null : integer(options.maxTokens, 0, 1_000_000_000_000),
    maxCostNanos: options.maxCostUsd === undefined ? null : money(options.maxCostUsd),
    zeroCostModels,
  };
}

export type WorkspaceModelBudgetPolicy = ReturnType<typeof workspaceModelBudgetPolicy>;

export function workspaceModelBudgetFromEnvironment(env: NodeJS.ProcessEnv): WorkspaceModelBudgetOptions {
  const result: WorkspaceModelBudgetOptions = {};
  if (env["NAPIER_MODEL_BUDGET_EPOCH"] !== undefined) result.epoch = env["NAPIER_MODEL_BUDGET_EPOCH"];
  for (const [name, key] of [
    ["NAPIER_MODEL_MAX_CONCURRENT", "maxConcurrent"],
    ["NAPIER_MODEL_BUDGET_INVOCATIONS", "maxInvocations"],
    ["NAPIER_MODEL_BUDGET_TOKENS", "maxTokens"],
    ["NAPIER_MODEL_BUDGET_USD", "maxCostUsd"],
  ] as const) {
    const value = env[name];
    if (value !== undefined) {
      if (!value.trim()) throw new Error(`Invalid ${name}`);
      result[key] = Number(value);
    }
  }
  if (env["NAPIER_MODEL_ZERO_COST_MODELS"] !== undefined) {
    const parsed: unknown = JSON.parse(env["NAPIER_MODEL_ZERO_COST_MODELS"]);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) throw new Error("Invalid free model declarations");
    result.zeroCostModels = parsed;
  }
  workspaceModelBudgetPolicy(result);
  return result;
}

export function modelCallAllowance(model: Model<Api>, options: StreamOptions | undefined, policy: WorkspaceModelBudgetPolicy) {
  const contextTokens = integer(model.contextWindow, 1, 100_000_000);
  const outputTokens = Math.min(integer(model.maxTokens, 1, 100_000_000),
    options?.maxTokens === undefined ? model.maxTokens : integer(options.maxTokens, 1, 100_000_000));
  const priceTable = structuredClone(model.cost);
  const tiers = [priceTable, ...(priceTable.tiers ?? [])];
  const validRates = tiers.every((tier) => [tier.input, tier.output, tier.cacheRead, tier.cacheWrite]
    .every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 1_000_000)) &&
    (priceTable.tiers ?? []).every((tier) => Number.isSafeInteger(tier.inputTokensAbove) && tier.inputTokensAbove >= 0);
  const rates = {
    input: Math.max(...tiers.map((tier) => tier.input)),
    output: Math.max(...tiers.map((tier) => tier.output)),
    cacheRead: Math.max(...tiers.map((tier) => tier.cacheRead)),
    // Matches pi-ai's 1h cache-write accounting: twice the base input rate.
    cacheWrite: Math.max(...tiers.flatMap((tier) => [tier.cacheWrite, 2 * tier.input])),
  };
  const declaredFree = policy.zeroCostModels.includes(`${model.provider}/${model.id}`);
  const priced = validRates && (Object.values(rates).some((rate) => rate > 0) || declaredFree);
  // A conservative allowance from the entire context window and output cap,
  // independent of approximate tokenization. This is nominal usage accounting,
  // not an invoice guarantee or a count of provider HTTP retries.
  const costNanos = priced ? money((contextTokens *
    (rates.input + rates.cacheRead + rates.cacheWrite) + outputTokens * rates.output) / 1_000_000) : null;
  return { tokens: contextTokens + outputTokens, costNanos, priceTable: validRates ? priceTable : null, declaredFree };
}

export type ModelCallAllowance = ReturnType<typeof modelCallAllowance>;

export function modelCallAccounting(message: AssistantMessage | undefined, allowance: ModelCallAllowance) {
  const usage = message?.usage;
  const observed = tokenObservation(usage);
  const price = costObservation(usage, allowance, observed);
  const completed = Boolean(message && ["stop", "length", "toolUse"].includes(message.stopReason));
  return { tokens: observed.tokens, costNanos: price.costNanos, known: completed && observed.consistent && price.known };
}

/** Inconsistent counters cannot refund a reservation, but their higher partial
 * observation must still become debt rather than disappearing from accounting. */
function tokenObservation(usage: AssistantMessage["usage"] | undefined) {
  const raw = [usage?.input, usage?.output, usage?.cacheRead, usage?.cacheWrite];
  const validParts = raw.every(validCounter);
  const longCacheWrite = validCounter(usage?.cacheWrite1h) ? usage.cacheWrite1h : 0;
  const reasoning = validCounter(usage?.reasoning) ? usage.reasoning : 0;
  const counts = {
    input: validCounter(usage?.input) ? usage.input : 0,
    output: Math.max(validCounter(usage?.output) ? usage.output : 0, reasoning),
    cacheRead: validCounter(usage?.cacheRead) ? usage.cacheRead : 0,
    cacheWrite: Math.max(validCounter(usage?.cacheWrite) ? usage.cacheWrite : 0, longCacheWrite),
  };
  const sum = Object.values(counts).reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum)) throw new Error("Model usage exceeds safe accounting precision");
  const validTotal = validCounter(usage?.totalTokens);
  const tokens = Math.max(sum, validTotal ? usage.totalTokens : 0) || null;
  const subsetsValid = optionalSubset(usage?.cacheWrite1h, usage?.cacheWrite) && optionalSubset(usage?.reasoning, usage?.output);
  return { sum, counts, longCacheWrite, tokens, consistent: validParts && validTotal && subsetsValid && sum > 0 && sum === usage.totalTokens };
}

function validCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalSubset(value: unknown, total: unknown): boolean {
  return value === undefined || (validCounter(value) && validCounter(total) && value <= total);
}

function costObservation(usage: AssistantMessage["usage"] | undefined, allowance: ModelCallAllowance, observed: ReturnType<typeof tokenObservation>) {
  const reported = reportedCostObservation(usage?.cost);
  let costNanos: number | null = reported.usd > 0 ? money(reported.usd) : null;
  if (observed.tokens !== null && allowance.priceTable && (allowance.costNanos !== null || costNanos !== null)) {
    // Missing cost/counters cannot erase usage already observed at the frozen
    // tariff. Zero placeholders only estimate the partial observation; they do
    // not make it complete or authorize refunding the full reservation.
    const estimate = { ...observed.counts, totalTokens: observed.sum,
      cacheWrite1h: observed.longCacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const rateCost = calculateCost({ cost: allowance.priceTable } as Model<Api>, estimate).total;
    const unclassified = Math.max(0, observed.tokens - observed.sum);
    const highestRate = Math.max(...[allowance.priceTable, ...(allowance.priceTable.tiers ?? [])]
      .flatMap((tier) => [tier.input, tier.output, tier.cacheRead, tier.cacheWrite, 2 * tier.input]));
    costNanos = Math.max(costNanos ?? 0, money(rateCost + unclassified * highestRate / 1_000_000));
  }
  return { costNanos, known: reported.consistent && costNanos !== null };
}

function reportedCostObservation(cost: AssistantMessage["usage"]["cost"] | undefined) {
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const raw = [cost?.input, cost?.output, cost?.cacheRead, cost?.cacheWrite];
  const sum = raw.reduce<number>((total, value) => total + (valid(value) ? value : 0), 0);
  const reported = valid(cost?.total) ? cost.total : 0;
  return {
    usd: Math.max(sum, reported),
    consistent: raw.every(valid) && valid(cost?.total) && Math.abs(sum - cost.total) <= 1e-9,
  };
}

function integer(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid model resource policy or allowance");
  return value;
}

function money(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0 || usd > 1_000_000) throw new Error("Invalid nominal model cost");
  return Math.ceil(usd * USD_NANOS);
}

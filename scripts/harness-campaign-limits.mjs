// These are recorded-usage stop thresholds, not provider billing guarantees.
export function campaignLimitOverrides(values) {
  const maxCostUsd = Number(values["max-cost-usd"] ?? 3);
  const timeoutMs = Number(values["run-timeout-ms"] ?? 240_000);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 3)
    throw new Error("max-cost-usd must be greater than zero and at most 3");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 3_600_000
  )
    throw new Error("run-timeout-ms must be an integer from 1 to 3600000");
  return { maxCostUsd, timeoutMs };
}

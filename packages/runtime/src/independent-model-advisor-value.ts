import type { Usage as PiUsage } from "@earendil-works/pi-ai";
import type { Usage, ModelRef } from "@napier/contracts";
const SHA256 = /^[a-f0-9]{64}$/u;

export function parseModelCallDisplayLinkage(input: Record<string, unknown>, usage: Usage): {
  physicalId?: string; attributionSha256?: string; accountingMode?: "physical_receipt_v1"; modelCallDisposition?: "not_dispatched";
} {
  if (input["modelCallDisposition"] !== undefined) {
    if (input["modelCallDisposition"] !== "not_dispatched" || Object.values(usage).some((value) => value !== 0) ||
        ["physicalId", "attributionSha256", "accountingMode"].some((key) => input[key] !== undefined))
      throw new Error("Model undispatched display diagnostic is invalid");
    return { modelCallDisposition: "not_dispatched" };
  }
  if (["physicalId", "attributionSha256", "accountingMode"].every((key) => input[key] === undefined)) return {};
  if (typeof input["physicalId"] !== "string" || !/^[a-zA-Z0-9:_-]{1,200}$/u.test(input["physicalId"]) ||
      typeof input["attributionSha256"] !== "string" || !SHA256.test(input["attributionSha256"]) ||
      input["accountingMode"] !== "physical_receipt_v1") throw new Error("Independent Model Advisor accounting linkage is invalid");
  return { physicalId: input["physicalId"], attributionSha256: input["attributionSha256"], accountingMode: "physical_receipt_v1" };
}

export function normalizeUsage(input: PiUsage): Usage {
  return {
    inputTokens: input.input,
    outputTokens: input.output,
    cacheReadTokens: input.cacheRead,
    cacheWriteTokens: input.cacheWrite,
    costUsd: input.cost.total,
  };
}

const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

export function normalizeModel(value: ModelRef): ModelRef {
  if (!value || typeof value !== "object") {
    throw new Error("Independent Model Advisor model is invalid");
  }
  const provider =
    typeof value.provider === "string"
      ? value.provider.trim().toLowerCase()
      : "";
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (
    !PROVIDER_ID.test(provider) ||
    !id ||
    id.length > 200 ||
    /[\u0000-\u001f\u007f<>\s]/u.test(id)
  ) {
    throw new Error("Independent Model Advisor model is invalid");
  }
  return { provider, id };
}

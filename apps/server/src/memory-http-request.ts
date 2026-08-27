import type { CreateMemoryRequest } from "@napier/contracts";

export function parseMemoryProvenanceFields(
  record: Record<string, unknown> | undefined,
):
  | Pick<CreateMemoryRequest, "persistenceReason" | "differenceSummary">
  | undefined {
  const persistenceReason = parseOptionalBoundedText(
    record?.["persistenceReason"],
  );
  const differenceSummary = parseOptionalBoundedText(
    record?.["differenceSummary"],
  );
  if (persistenceReason === null || differenceSummary === null) {
    return undefined;
  }
  return {
    ...(persistenceReason ? { persistenceReason } : {}),
    ...(differenceSummary ? { differenceSummary } : {}),
  };
}

function parseOptionalBoundedText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length >= 1 && normalized.length <= 500 ? normalized : null;
}

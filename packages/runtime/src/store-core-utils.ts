import type { RunRecord } from "@napier/contracts";

export function stripRunSecrets(
  run: RunRecord & { leaseTokenSha256?: string },
): RunRecord {
  const output = structuredClone(run);
  delete output.leaseTokenSha256;
  return output;
}

export function normalizeTriggerId(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 240 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("Run trigger ID is invalid");
  }
  return normalized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

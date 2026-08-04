import { requiredValue } from "./cli-option-values.js";

export interface CliSetupOptions {
  workspace: string;
  dataRoot?: string;
  providerId?: string;
  expectedPreviewSha256?: string;
  apply: boolean;
  jsonl: boolean;
}

export const SETUP_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--provider",
  "--expected-preview",
]);
export const SETUP_FLAG_OPTIONS = new Set(["--apply"]);

export function parseSetupOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): { kind: "setup"; options: CliSetupOptions } {
  const providerId = values.get("--provider")?.trim().toLowerCase();
  const expectedPreviewSha256 = values.get("--expected-preview")?.trim();
  if (
    providerId !== undefined &&
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(providerId)
  ) {
    throw new Error("--provider is invalid");
  }
  if (
    expectedPreviewSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(expectedPreviewSha256)
  ) {
    throw new Error("--expected-preview must be a SHA-256 digest");
  }
  if (
    flags.has("--apply") &&
    (!providerId || !expectedPreviewSha256)
  ) {
    throw new Error(
      "--apply requires --provider and --expected-preview",
    );
  }
  return {
    kind: "setup",
    options: {
      workspace: requiredValue(values, "--workspace"),
      apply: flags.has("--apply"),
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(providerId ? { providerId } : {}),
      ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
    },
  };
}

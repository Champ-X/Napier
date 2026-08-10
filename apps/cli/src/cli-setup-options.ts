import { requiredValue } from "./cli-option-values.js";

export const DEFAULT_SETUP_TIMEOUT_MS = 5 * 60 * 1_000;
export const MAX_SETUP_TIMEOUT_MS = 15 * 60 * 1_000;

export interface CliSetupOptions {
  workspace: string;
  dataRoot?: string;
  component?: "browser" | "sandbox";
  providerId?: string;
  expectedPreviewSha256?: string;
  timeoutMs?: number;
  apply: boolean;
  uninstall?: boolean;
  jsonl: boolean;
}

export const SETUP_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--component",
  "--provider",
  "--expected-preview",
  "--timeout-ms",
]);
export const SETUP_FLAG_OPTIONS = new Set(["--apply", "--uninstall"]);

export function parseSetupOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): { kind: "setup"; options: CliSetupOptions } {
  const providerId = setupProvider(values.get("--provider"));
  const component = setupComponent(values.get("--component"));
  const expectedPreviewSha256 = setupPreviewHash(
    values.get("--expected-preview"),
  );
  validateSetupSelection({
    component,
    providerId,
    expectedPreviewSha256,
    apply: flags.has("--apply"),
    uninstall: flags.has("--uninstall"),
    hasDataRoot: values.has("--data-root"),
    hasTimeout: values.has("--timeout-ms"),
  });
  return {
    kind: "setup",
    options: {
      workspace: requiredValue(values, "--workspace"),
      apply: flags.has("--apply"),
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(component ? { component } : {}),
      ...(component
        ? { timeoutMs: setupTimeout(values.get("--timeout-ms")) }
        : {}),
      ...(providerId ? { providerId } : {}),
      ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
      ...(flags.has("--uninstall") ? { uninstall: true } : {}),
    },
  };
}

function setupProvider(value: string | undefined): string | undefined {
  const providerId = value?.trim().toLowerCase();
  if (
    providerId !== undefined &&
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(providerId)
  ) {
    throw new Error("--provider is invalid");
  }
  return providerId;
}

function setupComponent(
  value: string | undefined,
): "browser" | "sandbox" | undefined {
  const component = value?.trim().toLowerCase();
  if (component === undefined) return undefined;
  if (component !== "browser" && component !== "sandbox") {
    throw new Error("--component must be browser or sandbox");
  }
  return component;
}

function setupPreviewHash(value: string | undefined): string | undefined {
  const expectedPreviewSha256 = value?.trim();
  if (
    expectedPreviewSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(expectedPreviewSha256)
  ) {
    throw new Error("--expected-preview must be a SHA-256 digest");
  }
  return expectedPreviewSha256;
}

function validateSetupSelection(input: {
  component: "browser" | "sandbox" | undefined;
  providerId: string | undefined;
  expectedPreviewSha256: string | undefined;
  apply: boolean;
  uninstall: boolean;
  hasDataRoot: boolean;
  hasTimeout: boolean;
}): void {
  if (input.component && input.providerId) {
    throw new Error("--component and --provider are mutually exclusive");
  }
  if (input.uninstall && input.component !== "sandbox") {
    throw new Error("--uninstall requires --component sandbox");
  }
  if (input.component === "browser" && input.hasDataRoot) {
    throw new Error("--data-root is unavailable for Browser setup");
  }
  if (
    input.apply &&
    !input.component &&
    (!input.providerId || !input.expectedPreviewSha256)
  ) {
    throw new Error("--apply requires --provider and --expected-preview");
  }
  if (input.apply && input.component && !input.expectedPreviewSha256) {
    throw new Error("--apply requires --expected-preview");
  }
  if (!input.component && input.hasTimeout) {
    throw new Error("--timeout-ms requires --component browser or sandbox");
  }
}

function setupTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_SETUP_TIMEOUT_MS;
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error("--timeout-ms is invalid");
  }
  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_SETUP_TIMEOUT_MS
  ) {
    throw new Error(`--timeout-ms must be 1000-${MAX_SETUP_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

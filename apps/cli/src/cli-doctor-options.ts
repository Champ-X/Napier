import type { ModelRef } from "@napier/contracts";

import { parseCredentialEnvironment } from "./cli-credential-options.js";
import { optionalModelRef, requiredValue } from "./cli-option-values.js";

export const DEFAULT_DOCTOR_TIMEOUT_MS = 45_000;
export const MAX_DOCTOR_TIMEOUT_MS = 120_000;

export interface CliDoctorOptions {
  workspace: string;
  dataRoot?: string;
  model?: ModelRef;
  credentialEnv?: string;
  browserBackend?:
    | "native_playwright"
    | "browser_use_local"
    | "browser_use_cloud";
  timeoutMs: number;
  online: boolean;
  jsonl: boolean;
}

export const DOCTOR_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--model",
  "--credential-env",
  "--timeout-ms",
  "--browser-backend",
]);
export const DOCTOR_FLAG_OPTIONS = new Set(["--offline"]);

export function parseDoctorOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): { kind: "doctor"; options: CliDoctorOptions } {
  const model = optionalModelRef(values);
  const browserBackend = parseBrowserBackend(values.get("--browser-backend"));
  const credentialEnv =
    browserBackend === "browser_use_cloud" && !model
      ? parseCloudCredentialEnvironment(values.get("--credential-env"))
      : parseCredentialEnvironment(values, model);
  return {
    kind: "doctor",
    options: {
      workspace: requiredValue(values, "--workspace"),
      timeoutMs: doctorTimeout(values.get("--timeout-ms")),
      online: !flags.has("--offline"),
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(model ? { model } : {}),
      ...(credentialEnv ? { credentialEnv } : {}),
      ...(browserBackend ? { browserBackend } : {}),
    },
  };
}

function parseCloudCredentialEnvironment(
  value: string | undefined,
): string | undefined {
  const credentialEnv = value?.trim();
  if (credentialEnv === undefined) return undefined;
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/u.test(credentialEnv)) {
    throw new Error("--credential-env is invalid");
  }
  return credentialEnv;
}

function parseBrowserBackend(
  value: string | undefined,
): "native_playwright" | "browser_use_local" | "browser_use_cloud" | undefined {
  const backend = value?.trim().toLowerCase();
  if (backend === undefined) return undefined;
  if (
    backend !== "native_playwright" &&
    backend !== "browser_use_local" &&
    backend !== "browser_use_cloud"
  ) {
    throw new Error(
      "--browser-backend must be native_playwright, browser_use_local, or browser_use_cloud",
    );
  }
  return backend;
}

function doctorTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_DOCTOR_TIMEOUT_MS;
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error("--timeout-ms is invalid");
  }
  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_DOCTOR_TIMEOUT_MS
  ) {
    throw new Error(`--timeout-ms must be 1000-${MAX_DOCTOR_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

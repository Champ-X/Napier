import type { ModelRef } from "@napier/contracts";

import { parseCredentialEnvironment } from "./cli-credential-options.js";
import { optionalModelRef, requiredValue } from "./cli-option-values.js";

export const DEFAULT_DOCTOR_TIMEOUT_MS = 45_000;
export const MAX_DOCTOR_TIMEOUT_MS = 120_000;

export interface CliDoctorOptions {
  workspace: string;
  model?: ModelRef;
  credentialEnv?: string;
  timeoutMs: number;
  online: boolean;
  jsonl: boolean;
}

export const DOCTOR_VALUE_OPTIONS = new Set([
  "--workspace",
  "--model",
  "--credential-env",
  "--timeout-ms",
]);
export const DOCTOR_FLAG_OPTIONS = new Set(["--offline"]);

export function parseDoctorOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): { kind: "doctor"; options: CliDoctorOptions } {
  const model = optionalModelRef(values);
  const credentialEnv = parseCredentialEnvironment(values, model);
  return {
    kind: "doctor",
    options: {
      workspace: requiredValue(values, "--workspace"),
      timeoutMs: doctorTimeout(values.get("--timeout-ms")),
      online: !flags.has("--offline"),
      jsonl,
      ...(model ? { model } : {}),
      ...(credentialEnv ? { credentialEnv } : {}),
    },
  };
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

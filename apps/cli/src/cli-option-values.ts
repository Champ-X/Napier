import type { ModelRef } from "@napier/contracts";

export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 30 * 60 * 1_000;

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;

export function requiredValue(
  values: Map<string, string>,
  flag: string,
): string {
  const value = values.get(flag)?.trim();
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

export function requiredResourceId(
  values: Map<string, string>,
  flag: string,
): string {
  const value = requiredValue(values, flag);
  if (!RESOURCE_ID.test(value)) throw new Error(`${flag} is invalid`);
  return value;
}

export function optionalResourceId(
  values: Map<string, string>,
  flag: string,
): string | undefined {
  if (!values.has(flag)) return undefined;
  return requiredResourceId(values, flag);
}

export function optionalModelRef(
  values: Map<string, string>,
): ModelRef | undefined {
  return values.has("--model")
    ? parseCliModelRef(requiredValue(values, "--model"))
    : undefined;
}

export function parseTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!/^[0-9]+$/u.test(value)) throw new Error("--timeout-ms is invalid");
  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(`--timeout-ms must be ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

export function parseCliModelRef(value: string): ModelRef {
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (
    separator < 1 ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(id)
  ) {
    throw new Error("--model must be provider/model-id");
  }
  return { provider, id };
}

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type {
  BrowserInteractionAction,
  BrowserInteractionEffect,
} from "@napier/contracts/browser-interaction-confirmation";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import type { BrowserConfirmedFormBenchmarkCase } from "./browser-confirmed-form-benchmark-types.js";

const CASE_KEYS = [
  "kind",
  "schemaVersion",
  "id",
  "title",
  "objective",
  "expectedAssistantText",
  "targetUrlSha256",
  "formValueSha256",
  "expectedConfirmationActions",
  "expectedConfirmationEffects",
  "expectedOutcomeUrlSha256",
  "expectedOutcomeTitleSha256",
  "timeoutMs",
  "maxDurationMs",
  "contentSha256",
] as const;

export async function loadBrowserConfirmedFormBenchmarkCase(
  caseRoot: string,
): Promise<BrowserConfirmedFormBenchmarkCase> {
  const root = await realpath(path.resolve(caseRoot));
  const manifestPath = path.join(root, "manifest.json");
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024) {
    throw new Error("Browser confirmed form benchmark manifest is unsafe");
  }
  return validateBrowserConfirmedFormBenchmarkCase(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
}

export function validateBrowserConfirmedFormBenchmarkCase(
  value: unknown,
): BrowserConfirmedFormBenchmarkCase {
  if (!exactRecord(value, CASE_KEYS)) {
    throw new Error("Browser confirmed form benchmark case is invalid");
  }
  const benchmarkCase = structuredClone(
    value,
  ) as unknown as BrowserConfirmedFormBenchmarkCase;
  const { contentSha256, ...content } = benchmarkCase;
  if (
    benchmarkCase.kind !== "napier.browser-confirmed-form-benchmark-case" ||
    benchmarkCase.schemaVersion !== 1 ||
    !resourceId(benchmarkCase.id) ||
    !boundedText(benchmarkCase.title, 1, 160) ||
    !boundedText(benchmarkCase.objective, 1, 500) ||
    !boundedText(benchmarkCase.expectedAssistantText, 1, 200) ||
    !digest(benchmarkCase.targetUrlSha256) ||
    !digest(benchmarkCase.formValueSha256) ||
    !validActions(benchmarkCase.expectedConfirmationActions) ||
    !validEffects(benchmarkCase.expectedConfirmationEffects) ||
    benchmarkCase.expectedConfirmationActions.length !==
      benchmarkCase.expectedConfirmationEffects.length ||
    !digest(benchmarkCase.expectedOutcomeUrlSha256) ||
    !digest(benchmarkCase.expectedOutcomeTitleSha256) ||
    benchmarkCase.timeoutMs !== 180_000 ||
    benchmarkCase.maxDurationMs !== benchmarkCase.timeoutMs ||
    !digest(contentSha256) ||
    sha256(canonicalJson(content)) !== contentSha256
  ) {
    throw new Error("Browser confirmed form benchmark case hash mismatch");
  }
  return benchmarkCase;
}

export function validateBrowserConfirmedFormBenchmarkInputs(
  benchmarkCase: BrowserConfirmedFormBenchmarkCase,
  targetUrl: string,
  formValue: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("Browser confirmed form benchmark target URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    sha256(targetUrl) !== benchmarkCase.targetUrlSha256 ||
    !boundedText(formValue, 1, 512) ||
    sha256(formValue) !== benchmarkCase.formValueSha256
  ) {
    throw new Error("Browser confirmed form benchmark input hash mismatch");
  }
}

function validActions(value: unknown): value is BrowserInteractionAction[] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "type" &&
    value[1] === "click"
  );
}

function validEffects(value: unknown): value is BrowserInteractionEffect[] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "data_entry" &&
    value[1] === "form_submit"
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

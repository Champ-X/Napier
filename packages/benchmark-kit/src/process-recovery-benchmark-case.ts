import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime";

import type { ProcessRecoveryBenchmarkCase } from "./process-recovery-benchmark-types.js";

const CASE_KEYS = [
  "kind",
  "schemaVersion",
  "id",
  "title",
  "writeScope",
  "targetPath",
  "initialText",
  "mutatedText",
  "expectedProcessStatus",
  "expectedCompensationStatus",
  "expectedExitCode",
  "expectedProcessEventTypes",
  "timeoutMs",
  "contentSha256",
] as const;

const EXPECTED_EVENT_TYPES = [
  "workspace.process.started",
  "workspace.process.settled",
  "workspace.process.rollback_started",
  "workspace.process.rolled_back",
] as const;

export async function loadProcessRecoveryBenchmarkCase(
  caseRoot: string,
): Promise<ProcessRecoveryBenchmarkCase> {
  const root = await realpath(path.resolve(caseRoot));
  const file = path.join(root, "manifest.json");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024) {
    throw new Error("Process recovery benchmark manifest is unsafe");
  }
  return validateProcessRecoveryBenchmarkCase(
    JSON.parse(await readFile(file, "utf8")),
  );
}

export function validateProcessRecoveryBenchmarkCase(
  value: unknown,
): ProcessRecoveryBenchmarkCase {
  if (!exactRecord(value, CASE_KEYS)) {
    throw new Error("Process recovery benchmark case is invalid");
  }
  const benchmarkCase = structuredClone(
    value,
  ) as unknown as ProcessRecoveryBenchmarkCase;
  const { contentSha256, ...content } = benchmarkCase;
  if (
    benchmarkCase.kind !== "napier.process-recovery-benchmark-case" ||
    benchmarkCase.schemaVersion !== 1 ||
    !resourceId(benchmarkCase.id) ||
    !boundedText(benchmarkCase.title, 1, 160) ||
    !safePath(benchmarkCase.writeScope) ||
    !safePath(benchmarkCase.targetPath) ||
    !insideScope(benchmarkCase.targetPath, benchmarkCase.writeScope) ||
    !boundedText(benchmarkCase.initialText, 1, 1_000) ||
    !boundedText(benchmarkCase.mutatedText, 1, 1_000) ||
    benchmarkCase.initialText === benchmarkCase.mutatedText ||
    benchmarkCase.expectedProcessStatus !== "failed" ||
    benchmarkCase.expectedCompensationStatus !== "restored" ||
    benchmarkCase.expectedExitCode !== 17 ||
    !sameStrings(
      benchmarkCase.expectedProcessEventTypes,
      EXPECTED_EVENT_TYPES,
    ) ||
    benchmarkCase.timeoutMs !== 30_000 ||
    !digest(contentSha256) ||
    sha256(canonicalJson(content)) !== contentSha256
  ) {
    throw new Error("Process recovery benchmark case hash mismatch");
  }
  return benchmarkCase;
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

function boundedText(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function safePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 200 &&
    !path.isAbsolute(value) &&
    value
      .split("/")
      .every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function insideScope(target: string, scope: string): boolean {
  return target === scope || target.startsWith(`${scope}/`);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

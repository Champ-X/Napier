import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime/core";

import type { GoalNoProgressBenchmarkCase } from "./goal-no-progress-benchmark-types.js";

const CASE_KEYS = [
  "kind",
  "schemaVersion",
  "id",
  "title",
  "objective",
  "prompt",
  "systemPrompt",
  "expectedAssistantText",
  "expectedContinuationCount",
  "expectedEvaluationCount",
  "expectedNoProgressCount",
  "expectedPrimaryResponseCount",
  "expectedModelResponseCount",
  "timeoutMs",
  "contentSha256",
] as const;

export async function loadGoalNoProgressBenchmarkCase(
  caseRoot: string,
): Promise<GoalNoProgressBenchmarkCase> {
  const root = await realpath(path.resolve(caseRoot));
  const file = path.join(root, "manifest.json");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024) {
    throw new Error("Goal no-progress benchmark manifest is unsafe");
  }
  return validateGoalNoProgressBenchmarkCase(
    JSON.parse(await readFile(file, "utf8")),
  );
}

export function validateGoalNoProgressBenchmarkCase(
  value: unknown,
): GoalNoProgressBenchmarkCase {
  if (!exactRecord(value, CASE_KEYS)) {
    throw new Error("Goal no-progress benchmark case is invalid");
  }
  const benchmarkCase = structuredClone(
    value,
  ) as unknown as GoalNoProgressBenchmarkCase;
  const { contentSha256, ...content } = benchmarkCase;
  if (
    benchmarkCase.kind !== "napier.goal-no-progress-benchmark-case" ||
    benchmarkCase.schemaVersion !== 1 ||
    !resourceId(benchmarkCase.id) ||
    !boundedText(benchmarkCase.title, 1, 160) ||
    !boundedText(benchmarkCase.objective, 1, 500) ||
    !boundedText(benchmarkCase.prompt, 1, 500) ||
    !boundedText(benchmarkCase.systemPrompt, 1, 1_000) ||
    !boundedText(benchmarkCase.expectedAssistantText, 1, 200) ||
    benchmarkCase.expectedContinuationCount !== 2 ||
    benchmarkCase.expectedEvaluationCount !== 3 ||
    benchmarkCase.expectedNoProgressCount !== 2 ||
    benchmarkCase.expectedPrimaryResponseCount !== 3 ||
    benchmarkCase.expectedModelResponseCount !== 7 ||
    benchmarkCase.timeoutMs !== 120_000 ||
    !digest(contentSha256) ||
    sha256(canonicalJson(content)) !== contentSha256
  ) {
    throw new Error("Goal no-progress benchmark case hash mismatch");
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
    value.trim() === value &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

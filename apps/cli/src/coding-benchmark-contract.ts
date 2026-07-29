import path from "node:path";

import { AGENT_TOOL_NAMES, type RunEvent } from "@napier/contracts";
import {
  canonicalJson,
  sha256,
  type WorkspacePathSnapshot,
  type WorkspaceSnapshotDelta,
} from "@napier/runtime";

import type {
  CodingBenchmarkCase,
  CodingBenchmarkDiagnostic,
  CodingBenchmarkEvaluation,
  CodingBenchmarkResult,
  CodingBenchmarkToolMetrics,
} from "./coding-benchmark-types.js";

export * from "./coding-benchmark-ledger.js";
export type * from "./coding-benchmark-types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const AGENT_TOOLS = new Set<string>(AGENT_TOOL_NAMES);
const CASE_KEYS = [
  "kind",
  "schemaVersion",
  "id",
  "title",
  "promptPath",
  "fixturePath",
  "targetPath",
  "expectedTargetPath",
  "allowedChangedPaths",
  "requiredTools",
  "timeoutMs",
  "promptSha256",
  "fixtureSha256",
  "targetBeforeSha256",
  "expectedTargetSha256",
  "expectedTargetAstSha256",
  "contentSha256",
] as const;

export function validateCodingBenchmarkCase(
  input: unknown,
): CodingBenchmarkCase {
  if (!record(input) || !exactKeys(input, CASE_KEYS)) {
    throw new Error("Coding benchmark case must be an exact object");
  }
  if (
    input["kind"] !== "napier.coding-benchmark-case" ||
    input["schemaVersion"] !== 1 ||
    typeof input["id"] !== "string" ||
    !RESOURCE_ID.test(input["id"]) ||
    !boundedText(input["title"], 1, 160) ||
    !safeRelativePath(input["promptPath"]) ||
    !safeRelativePath(input["fixturePath"]) ||
    !safeRelativePath(input["targetPath"]) ||
    !safeRelativePath(input["expectedTargetPath"]) ||
    !stringArray(input["allowedChangedPaths"], 1, 16, safeRelativePath) ||
    !stringArray(
      input["requiredTools"],
      1,
      16,
      (entry): entry is string =>
        typeof entry === "string" && AGENT_TOOLS.has(entry),
    ) ||
    !Number.isSafeInteger(input["timeoutMs"]) ||
    Number(input["timeoutMs"]) < 1_000 ||
    Number(input["timeoutMs"]) > 30 * 60 * 1_000 ||
    !isSha256(input["promptSha256"]) ||
    !isSha256(input["fixtureSha256"]) ||
    !isSha256(input["targetBeforeSha256"]) ||
    !isSha256(input["expectedTargetSha256"]) ||
    !isSha256(input["expectedTargetAstSha256"]) ||
    !isSha256(input["contentSha256"])
  ) {
    throw new Error("Coding benchmark case is invalid");
  }
  const benchmarkCase = structuredClone(
    input,
  ) as unknown as CodingBenchmarkCase;
  if (
    new Set(benchmarkCase.allowedChangedPaths).size !==
      benchmarkCase.allowedChangedPaths.length ||
    new Set(benchmarkCase.requiredTools).size !==
      benchmarkCase.requiredTools.length ||
    !benchmarkCase.allowedChangedPaths.includes(benchmarkCase.targetPath)
  ) {
    throw new Error("Coding benchmark case sets are invalid");
  }
  const { contentSha256, ...content } = benchmarkCase;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Coding benchmark case hash mismatch");
  }
  return benchmarkCase;
}

export function createCodingBenchmarkEvaluation(input: {
  benchmarkCase: CodingBenchmarkCase;
  runStatus: CodingBenchmarkEvaluation["runStatus"];
  before: WorkspacePathSnapshot;
  after: WorkspacePathSnapshot;
  delta: WorkspaceSnapshotDelta;
  targetAfterSha256: string;
  targetAfterAstSha256: string;
}): CodingBenchmarkEvaluation {
  const allowed = [...input.benchmarkCase.allowedChangedPaths].sort();
  const observed = input.delta.entries.map((entry) => entry.path).sort();
  const targetSemanticMatch =
    input.targetAfterAstSha256 === input.benchmarkCase.expectedTargetAstSha256;
  const allowedChangeSetMatch =
    input.delta.status === "changed" &&
    !input.delta.entriesTruncated &&
    JSON.stringify(observed) === JSON.stringify(allowed);
  const diagnostics: CodingBenchmarkDiagnostic[] = [];
  if (input.runStatus !== "completed") diagnostics.push("run_not_completed");
  if (input.before.truncated || input.after.truncated) {
    diagnostics.push("workspace_snapshot_truncated");
  }
  if (!targetSemanticMatch) diagnostics.push("target_mismatch");
  if (input.delta.status === "unchanged") {
    diagnostics.push("expected_change_missing");
  }
  if (!allowedChangeSetMatch && input.delta.status !== "unchanged") {
    diagnostics.push("unexpected_workspace_changes");
  }
  const criteriaSha256 = sha256(
    canonicalJson({
      expectedTargetAstSha256: input.benchmarkCase.expectedTargetAstSha256,
      allowedPathSetSha256: sha256(canonicalJson(allowed)),
    }),
  );
  const content = {
    kind: "napier.coding-benchmark-evaluation" as const,
    schemaVersion: 1 as const,
    caseId: input.benchmarkCase.id,
    caseSha256: input.benchmarkCase.contentSha256,
    status:
      diagnostics.length === 0 ? ("passed" as const) : ("failed" as const),
    runStatus: input.runStatus,
    criteriaSha256,
    workspaceBeforeSha256: input.before.sha256,
    workspaceAfterSha256: input.after.sha256,
    targetBeforeSha256: input.benchmarkCase.targetBeforeSha256,
    targetAfterSha256: input.targetAfterSha256,
    expectedTargetSha256: input.benchmarkCase.expectedTargetSha256,
    targetAfterAstSha256: input.targetAfterAstSha256,
    expectedTargetAstSha256: input.benchmarkCase.expectedTargetAstSha256,
    changedFileCount: input.delta.changedFileCount,
    changedPathSetSha256: input.delta.changedPathSetSha256,
    targetSemanticMatch,
    allowedChangeSetMatch,
    diagnostics,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function collectCodingBenchmarkToolMetrics(
  events: readonly RunEvent[],
  runId: string,
): CodingBenchmarkToolMetrics {
  const runEvents = events.filter((event) => event.runId === runId);
  const started = runEvents.filter((event) => event.type === "tool.started");
  const seen = new Set<string>();
  let repeatedCallCount = 0;
  for (const event of started) {
    const payload = record(event.payload) ? event.payload : {};
    const signature = `${String(payload["toolName"] ?? "")}:${String(
      payload["inputSha256"] ?? "",
    )}`;
    if (seen.has(signature)) repeatedCallCount += 1;
    seen.add(signature);
  }
  return {
    started: started.length,
    completed: countEvents(runEvents, "tool.completed"),
    failed: countEvents(runEvents, "tool.failed"),
    blocked: countEvents(runEvents, "tool.blocked"),
    repeatedCallCount,
    applyPatchCompleted: runEvents.some(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload) &&
        event.payload["toolName"] === "apply_patch",
    ),
  };
}

export function createCodingBenchmarkResult(
  content: Omit<CodingBenchmarkResult, "contentSha256">,
): CodingBenchmarkResult {
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function countEvents(events: readonly RunEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function safeRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 512 &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.includes("\0") &&
    value !== "." &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    !value.startsWith("../")
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

function stringArray(
  value: unknown,
  minimum: number,
  maximum: number,
  validate: (entry: unknown) => entry is string,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every(validate)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

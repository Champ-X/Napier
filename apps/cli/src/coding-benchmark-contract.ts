import path from "node:path";

import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
  type RunEvent,
} from "@napier/contracts";
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
  CodingBenchmarkOutcomeTestEvidence,
  CodingBenchmarkResultV2,
  CodingBenchmarkToolMetricsV2,
} from "./coding-benchmark-types.js";

export * from "./coding-benchmark-ledger.js";
export type * from "./coding-benchmark-types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const AGENT_TOOLS = new Set<string>(AGENT_TOOL_NAMES);
const CASE_V2_KEYS = [
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
  "outcomeTestPath",
  "outcomeTestSha256",
  "contentSha256",
] as const;
const CASE_V3_KEYS = [...CASE_V2_KEYS, "requiredCompletedTools"] as const;

export function validateCodingBenchmarkCase(
  input: unknown,
): CodingBenchmarkCase {
  if (!record(input)) {
    throw new Error("Coding benchmark case must be an exact object");
  }
  const schemaVersion = input["schemaVersion"];
  if (
    (schemaVersion !== 2 && schemaVersion !== 3) ||
    !exactKeys(input, schemaVersion === 3 ? CASE_V3_KEYS : CASE_V2_KEYS)
  ) {
    throw new Error("Coding benchmark case must be an exact object");
  }
  if (
    input["kind"] !== "napier.coding-benchmark-case" ||
    typeof input["id"] !== "string" ||
    !RESOURCE_ID.test(input["id"]) ||
    !boundedText(input["title"], 1, 160) ||
    !safeRelativePath(input["promptPath"]) ||
    !safeRelativePath(input["fixturePath"]) ||
    !safeRelativePath(input["targetPath"]) ||
    !safeRelativePath(input["expectedTargetPath"]) ||
    !safeRelativePath(input["outcomeTestPath"]) ||
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
    !isSha256(input["outcomeTestSha256"]) ||
    !isSha256(input["contentSha256"]) ||
    (schemaVersion === 3 &&
      !stringArray(
        input["requiredCompletedTools"],
        1,
        16,
        (entry): entry is string =>
          typeof entry === "string" && AGENT_TOOLS.has(entry),
      ))
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
    !benchmarkCase.allowedChangedPaths.includes(benchmarkCase.targetPath) ||
    (benchmarkCase.schemaVersion === 3 &&
      (new Set(benchmarkCase.requiredCompletedTools).size !==
        benchmarkCase.requiredCompletedTools.length ||
        benchmarkCase.requiredCompletedTools.some(
          (toolName) => !benchmarkCase.requiredTools.includes(toolName),
        )))
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
  outcomeTest: CodingBenchmarkOutcomeTestEvidence;
  completedToolNames?: readonly string[];
}): CodingBenchmarkEvaluation {
  if (input.outcomeTest.testSha256 !== input.benchmarkCase.outcomeTestSha256) {
    throw new Error("Coding benchmark outcome test evidence hash mismatch");
  }
  const allowed = [...input.benchmarkCase.allowedChangedPaths].sort();
  const observed = input.delta.entries.map((entry) => entry.path).sort();
  const targetSemanticMatch =
    input.targetAfterAstSha256 === input.benchmarkCase.expectedTargetAstSha256;
  const allowedChangeSetMatch =
    input.delta.status === "changed" &&
    !input.delta.entriesTruncated &&
    JSON.stringify(observed) === JSON.stringify(allowed);
  const requiredTools =
    input.benchmarkCase.schemaVersion === 3
      ? [...input.benchmarkCase.requiredCompletedTools].sort()
      : [];
  const completedToolNames = new Set(input.completedToolNames ?? []);
  const completedRequiredTools = requiredTools.filter((toolName) =>
    completedToolNames.has(toolName),
  );
  const requiredToolSetSha256 = sha256(canonicalJson(requiredTools));
  const completedRequiredToolSetSha256 = sha256(
    canonicalJson(completedRequiredTools),
  );
  const diagnostics: CodingBenchmarkDiagnostic[] = [];
  if (input.runStatus !== "completed") diagnostics.push("run_not_completed");
  if (input.before.truncated || input.after.truncated) {
    diagnostics.push("workspace_snapshot_truncated");
  }
  const outcomeTestUnavailable =
    input.outcomeTest.status === "unavailable" ||
    input.outcomeTest.status === "cancelled";
  const cancelledInconclusive =
    input.runStatus === "cancelled" && input.outcomeTest.status === "cancelled";
  if (outcomeTestUnavailable) {
    diagnostics.push("outcome_test_unavailable");
  } else if (!input.outcomeTest.passed) {
    diagnostics.push("outcome_test_failed");
  }
  if (input.delta.status === "unchanged") {
    diagnostics.push("expected_change_missing");
  }
  if (!allowedChangeSetMatch && input.delta.status !== "unchanged") {
    diagnostics.push("unexpected_workspace_changes");
  }
  if (completedRequiredTools.length !== requiredTools.length) {
    diagnostics.push("required_tool_missing");
  }
  const criteriaSha256 = sha256(
    canonicalJson({
      expectedTargetAstSha256: input.benchmarkCase.expectedTargetAstSha256,
      outcomeTestSha256: input.benchmarkCase.outcomeTestSha256,
      allowedPathSetSha256: sha256(canonicalJson(allowed)),
      ...(input.benchmarkCase.schemaVersion === 3
        ? { requiredToolSetSha256 }
        : {}),
    }),
  );
  const schemaVersion =
    input.benchmarkCase.schemaVersion === 3 ? (3 as const) : (2 as const);
  const content = {
    kind: "napier.coding-benchmark-evaluation" as const,
    schemaVersion,
    caseId: input.benchmarkCase.id,
    caseSha256: input.benchmarkCase.contentSha256,
    status:
      diagnostics.length === 0
        ? ("passed" as const)
        : cancelledInconclusive ||
            (outcomeTestUnavailable &&
              diagnostics.every(
                (diagnostic) => diagnostic === "outcome_test_unavailable",
              ))
          ? ("inconclusive" as const)
          : ("failed" as const),
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
    outcomeTest: structuredClone(input.outcomeTest),
    ...(schemaVersion === 3
      ? {
          requiredToolCount: requiredTools.length,
          completedRequiredToolCount: completedRequiredTools.length,
          requiredToolSetSha256,
          completedRequiredToolSetSha256,
        }
      : {}),
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
): CodingBenchmarkToolMetricsV2 {
  const runEvents = events.filter((event) => event.runId === runId);
  const outcomes = new Map<
    string,
    {
      toolName: string;
      started: number;
      completed: number;
      failed: number;
      blocked: number;
      repeatedCallCount: number;
      signatures: Set<string>;
    }
  >();
  for (const event of runEvents) {
    if (
      event.type !== "tool.started" &&
      event.type !== "tool.completed" &&
      event.type !== "tool.failed" &&
      event.type !== "tool.blocked"
    ) {
      continue;
    }
    const payload = record(event.payload) ? event.payload : {};
    const rawToolName = payload["toolName"];
    const toolName =
      typeof rawToolName === "string" &&
      /^[a-z][a-z0-9_.-]{0,79}$/u.test(rawToolName)
        ? rawToolName
        : "unknown";
    let outcome = outcomes.get(toolName);
    if (!outcome) {
      outcome = {
        toolName,
        started: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
        repeatedCallCount: 0,
        signatures: new Set(),
      };
      outcomes.set(toolName, outcome);
    }
    if (event.type === "tool.started") {
      outcome.started += 1;
      const inputSha256 =
        typeof payload["inputSha256"] === "string"
          ? payload["inputSha256"]
          : sha256(canonicalJson(payload["input"] ?? null));
      if (outcome.signatures.has(inputSha256)) {
        outcome.repeatedCallCount += 1;
      }
      outcome.signatures.add(inputSha256);
    } else if (event.type === "tool.completed") {
      outcome.completed += 1;
    } else if (event.type === "tool.failed") {
      outcome.failed += 1;
    } else {
      outcome.blocked += 1;
    }
  }
  const toolOutcomes = [...outcomes.values()]
    .map(({ signatures: _signatures, ...outcome }) => outcome)
    .sort((left, right) => left.toolName.localeCompare(right.toolName));
  const sum = (
    key: "started" | "completed" | "failed" | "blocked" | "repeatedCallCount",
  ) => toolOutcomes.reduce((total, outcome) => total + outcome[key], 0);
  return {
    started: sum("started"),
    completed: sum("completed"),
    failed: sum("failed"),
    blocked: sum("blocked"),
    repeatedCallCount: sum("repeatedCallCount"),
    applyPatchCompleted: toolOutcomes.some(
      (outcome) => outcome.toolName === "apply_patch" && outcome.completed > 0,
    ),
    toolOutcomes,
  };
}

export function completedCodingBenchmarkTools(
  events: readonly RunEvent[],
  runId: string,
): AgentToolName[] {
  const completed = new Set<AgentToolName>();
  for (const event of events) {
    if (event.runId !== runId || event.type !== "tool.completed") continue;
    const payload = record(event.payload) ? event.payload : {};
    const toolName = payload["toolName"];
    if (typeof toolName === "string" && AGENT_TOOLS.has(toolName)) {
      completed.add(toolName as AgentToolName);
    }
  }
  return [...completed].sort();
}

export function createCodingBenchmarkResult(
  content: Omit<CodingBenchmarkResultV2, "contentSha256">,
): CodingBenchmarkResultV2 {
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
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

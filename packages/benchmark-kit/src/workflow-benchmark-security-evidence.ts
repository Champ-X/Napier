import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import type {
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkSqliteEvidenceExpectation,
} from "./workflow-benchmark-types.js";

type PromptInjectionScan = NonNullable<
  WorkflowBenchmarkLedgerBundle["workflow"]["promptInjectionScan"]
>;

const SCAN_KEYS = [
  "kind",
  "schemaVersion",
  "forbiddenStringSha256s",
  "sourceReplaySha256",
  "outputProjectionSha256",
  "leakDetected",
  "contentSha256",
] as const;

export function workflowBenchmarkSqliteEvidenceMatches(
  events: RunEvent[],
  required: WorkflowBenchmarkSqliteEvidenceExpectation[],
): boolean {
  const actual = events.flatMap((event) => {
    const details = sqliteDetails(event);
    return details["action"] === "query" &&
      digest(details["sqlSha256"]) &&
      digest(details["parameterSetSha256"]) &&
      digest(details["rowsSha256"])
      ? [
          {
            runId: event.runId,
            sqlSha256: details["sqlSha256"],
            parameterSetSha256: details["parameterSetSha256"],
            rowsSha256: details["rowsSha256"],
          },
        ]
      : [];
  });
  const matchedRunIds = required.flatMap((expectation) => {
    const match = actual.find((candidate) => {
      const { runId: _runId, ...evidence } = candidate;
      return canonicalJson(evidence) === canonicalJson(expectation);
    });
    return match ? [match.runId] : [];
  });
  return (
    matchedRunIds.length === required.length &&
    new Set(matchedRunIds).size === required.length
  );
}

export function validWorkflowBenchmarkSecurityFields(
  workflow: Record<string, unknown>,
): boolean {
  const required = workflow["requiredSqliteEvidence"];
  const scan = workflow["promptInjectionScan"];
  if (required === undefined && scan === undefined) return true;
  if (required === undefined) {
    return validWorkflowBenchmarkPromptInjectionScan(scan);
  }
  return (
    Array.isArray(required) &&
    required.length >= 2 &&
    required.length <= 8 &&
    required.every(validSqliteEvidenceExpectation) &&
    new Set(required.map((expectation) => canonicalJson(expectation))).size ===
      required.length &&
    validWorkflowBenchmarkPromptInjectionScan(scan)
  );
}

export function promptInjectionLeakDetected(
  projection: unknown,
  forbiddenOutputStrings: string[],
): boolean {
  const serialized = JSON.stringify(projection);
  return forbiddenOutputStrings.some((canary) => serialized.includes(canary));
}

export function createWorkflowBenchmarkPromptInjectionScan(input: {
  forbiddenOutputStrings: string[];
  sourceReplaySha256: string;
  outputProjectionSha256: string;
  leakDetected: boolean;
}): PromptInjectionScan {
  const content = {
    kind: "napier.workflow-benchmark-prompt-injection-scan" as const,
    schemaVersion: 1 as const,
    forbiddenStringSha256s: input.forbiddenOutputStrings
      .map((canary) => sha256(canary))
      .sort(),
    sourceReplaySha256: input.sourceReplaySha256,
    outputProjectionSha256: input.outputProjectionSha256,
    leakDetected: input.leakDetected,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validWorkflowBenchmarkPromptInjectionScan(
  value: unknown,
): value is PromptInjectionScan {
  if (!exactRecord(value, SCAN_KEYS)) return false;
  const { contentSha256, ...content } = value;
  const canaries = value["forbiddenStringSha256s"];
  return (
    value["kind"] === "napier.workflow-benchmark-prompt-injection-scan" &&
    value["schemaVersion"] === 1 &&
    Array.isArray(canaries) &&
    canaries.length >= 2 &&
    canaries.length <= 8 &&
    canaries.every(digest) &&
    new Set(canaries).size === canaries.length &&
    canaries.every(
      (digestValue, index) => index === 0 || canaries[index - 1]! < digestValue,
    ) &&
    digest(value["sourceReplaySha256"]) &&
    digest(value["outputProjectionSha256"]) &&
    typeof value["leakDetected"] === "boolean" &&
    digest(contentSha256) &&
    contentSha256 === sha256(canonicalJson(content as unknown as JsonValue))
  );
}

export function workflowBenchmarkPromptInjectionScanMatches(
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const scan = bundle.workflow.promptInjectionScan;
  return (
    scan === undefined ||
    (validWorkflowBenchmarkPromptInjectionScan(scan) &&
      scan.sourceReplaySha256 === bundle.sourceReplaySha256)
  );
}

function sqliteDetails(event: RunEvent): Record<string, unknown> {
  const payload = record(event.payload) ? event.payload : {};
  return record(payload["details"]) ? payload["details"] : {};
}

function validSqliteEvidenceExpectation(value: unknown): boolean {
  return (
    exactRecord(value, ["sqlSha256", "parameterSetSha256", "rowsSha256"]) &&
    digest(value["sqlSha256"]) &&
    digest(value["parameterSetSha256"]) &&
    digest(value["rowsSha256"])
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

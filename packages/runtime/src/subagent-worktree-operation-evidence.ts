import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_SUBAGENT_CANDIDATE_VERIFICATIONS = 16;
export const MAX_SUBAGENT_CANDIDATE_COMMANDS = 8;

export interface SubagentCandidateVerificationRecord {
  attempt: number;
  toolName: "lsp_diagnostics" | "verify_workspace";
  kind: string;
  status: string;
  passed: boolean;
  inputSha256: string;
  resultSha256: string;
  candidateSnapshotSha256: string;
}

export interface SubagentCandidateVerificationView extends SubagentCandidateVerificationRecord {
  fresh: boolean;
}

export interface SubagentCandidateVerificationSummary {
  attemptCount: number;
  freshCount: number;
  passedCount: number;
  failedCount: number;
  staleCount: number;
  setSha256: string;
  attempts: SubagentCandidateVerificationView[];
}

export interface SubagentCandidateCommandRecord {
  attempt: number;
  runtime: "node";
  status: "succeeded" | "failed" | "timed_out" | "output_capped" | "error";
  succeeded: boolean;
  inputSha256: string;
  resultSha256: string;
  beforeCandidateSnapshotSha256: string;
  candidateSnapshotSha256: string;
}

export interface SubagentCandidateCommandView extends SubagentCandidateCommandRecord {
  fresh: boolean;
}

export interface SubagentCandidateCommandSummary {
  attemptCount: number;
  freshCount: number;
  succeededCount: number;
  failedCount: number;
  staleCount: number;
  setSha256: string;
  attempts: SubagentCandidateCommandView[];
}

export function summarizeCandidateVerification(
  records: SubagentCandidateVerificationRecord[],
  finalCandidateSnapshotSha256: string,
): SubagentCandidateVerificationSummary {
  const attempts = records
    .slice()
    .sort((left, right) => left.attempt - right.attempt)
    .map((record) => ({
      ...record,
      fresh: record.candidateSnapshotSha256 === finalCandidateSnapshotSha256,
    }));
  const fresh = attempts.filter((attempt) => attempt.fresh);
  return {
    attemptCount: attempts.length,
    freshCount: fresh.length,
    passedCount: fresh.filter((attempt) => attempt.passed).length,
    failedCount: fresh.filter((attempt) => !attempt.passed).length,
    staleCount: attempts.length - fresh.length,
    setSha256: sha256(canonicalJson(attempts)),
    attempts,
  };
}

export function summarizeCandidateCommands(
  records: SubagentCandidateCommandRecord[],
  finalCandidateSnapshotSha256: string,
): SubagentCandidateCommandSummary {
  const attempts = records
    .slice()
    .sort((left, right) => left.attempt - right.attempt)
    .map((record) => ({
      ...record,
      fresh: record.candidateSnapshotSha256 === finalCandidateSnapshotSha256,
    }));
  const fresh = attempts.filter((attempt) => attempt.fresh);
  return {
    attemptCount: attempts.length,
    freshCount: fresh.length,
    succeededCount: fresh.filter((attempt) => attempt.succeeded).length,
    failedCount: fresh.filter((attempt) => !attempt.succeeded).length,
    staleCount: attempts.length - fresh.length,
    setSha256: sha256(canonicalJson(attempts)),
    attempts,
  };
}

export function formatSubagentCandidateVerification(
  summary: SubagentCandidateVerificationSummary,
): string[] {
  return [
    `Candidate verification: ${summary.freshCount} fresh / ${summary.passedCount} passed / ${summary.failedCount} failed / ${summary.staleCount} stale`,
    `Candidate verification set SHA-256: ${summary.setSha256}`,
    ...summary.attempts.map(
      (attempt) =>
        `- #${attempt.attempt} ${attempt.toolName}/${attempt.kind}: ${attempt.status} / ${attempt.fresh ? "fresh" : "stale"} / ${attempt.passed ? "passed" : "not-passed"} / ${attempt.resultSha256}`,
    ),
  ];
}

export function formatSubagentCandidateCommands(
  summary: SubagentCandidateCommandSummary,
): string[] {
  return [
    `Candidate commands: ${summary.freshCount} fresh / ${summary.succeededCount} succeeded / ${summary.failedCount} failed / ${summary.staleCount} stale`,
    `Candidate command set SHA-256: ${summary.setSha256}`,
    ...summary.attempts.map(
      (attempt) =>
        `- #${attempt.attempt} ${attempt.runtime}: ${attempt.status} / ${attempt.fresh ? "fresh" : "stale"} / ${attempt.succeeded ? "succeeded" : "not-succeeded"} / ${attempt.resultSha256}`,
    ),
  ];
}

export function successfulVerificationRecord(
  attempt: number,
  toolName: SubagentCandidateVerificationRecord["toolName"],
  inputSha256: string,
  result: unknown,
  candidateSnapshotSha256: string,
): SubagentCandidateVerificationRecord {
  const details = record(record(result)?.["details"]);
  if (!details || typeof details["status"] !== "string") {
    throw new Error("Coder candidate verification details are unavailable");
  }
  const kind = typeof details["kind"] === "string" ? details["kind"] : toolName;
  const resultSha256 = resultHash(details);
  const passed =
    toolName === "verify_workspace"
      ? details["status"] === "passed"
      : details["status"] === "clean" ||
        (details["status"] === "diagnostics" && details["errorCount"] === 0);
  return {
    attempt,
    toolName,
    kind,
    status: details["status"],
    passed,
    inputSha256,
    resultSha256,
    candidateSnapshotSha256,
  };
}

export function successfulCommandRecord(
  attempt: number,
  inputSha256: string,
  result: unknown,
  beforeCandidateSnapshotSha256: string,
  candidateSnapshotSha256: string,
): SubagentCandidateCommandRecord {
  const details = record(record(result)?.["details"]);
  const status = details?.["status"];
  if (
    !details ||
    details["runtime"] !== "node" ||
    (status !== "succeeded" &&
      status !== "failed" &&
      status !== "timed_out" &&
      status !== "output_capped")
  ) {
    throw new Error("Coder candidate command details are unavailable");
  }
  return {
    attempt,
    runtime: "node",
    status,
    succeeded: status === "succeeded",
    inputSha256,
    resultSha256: resultHash(details),
    beforeCandidateSnapshotSha256,
    candidateSnapshotSha256,
  };
}

function resultHash(details: Record<string, unknown>): string {
  return typeof details["resultSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(details["resultSha256"])
    ? details["resultSha256"]
    : sha256(canonicalJson(safeDetails(details)));
}

function safeDetails(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, candidate]) =>
          key !== "path" &&
          key !== "cwd" &&
          key !== "target" &&
          (candidate === null ||
            typeof candidate === "string" ||
            typeof candidate === "number" ||
            typeof candidate === "boolean"),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

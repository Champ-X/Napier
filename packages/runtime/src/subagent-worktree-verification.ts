import type { AgentTool } from "@earendil-works/pi-agent-core";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  observeSubagentWorktreeCandidate,
  type SubagentWorktreeSession,
} from "./subagent-worktree-files.js";

export const MAX_SUBAGENT_CANDIDATE_VERIFICATIONS = 16;

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

export class SubagentWorktreeOperationCoordinator {
  private tail = Promise.resolve();
  private nextAttempt = 1;
  private readonly records: SubagentCandidateVerificationRecord[] = [];

  async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.serial(operation);
  }

  wrapVerificationTool(
    tool: AgentTool,
    session: SubagentWorktreeSession,
    verifyToolchain?: () => Promise<void>,
  ): AgentTool {
    if (tool.name !== "lsp_diagnostics" && tool.name !== "verify_workspace") {
      throw new Error("Coder candidate verification tool is unsupported");
    }
    return {
      ...tool,
      execute: (toolCallId, args, signal) =>
        this.serial(async () => {
          if (this.nextAttempt > MAX_SUBAGENT_CANDIDATE_VERIFICATIONS) {
            throw new Error(
              "Coder candidate verification attempt limit exceeded",
            );
          }
          const attempt = this.nextAttempt;
          this.nextAttempt += 1;
          const inputSha256 = sha256(
            canonicalJson({ toolName: tool.name, args }),
          );
          try {
            await verifyToolchain?.();
            const result = await tool.execute(toolCallId, args, signal);
            await verifyToolchain?.();
            const snapshot = await observeSubagentWorktreeCandidate(
              session,
              signal,
            );
            this.records.push(
              successfulRecord(
                attempt,
                tool.name as SubagentCandidateVerificationRecord["toolName"],
                inputSha256,
                result,
                snapshot.contentSha256,
              ),
            );
            return result;
          } catch (error) {
            const snapshot = await observeSubagentWorktreeCandidate(session);
            this.records.push({
              attempt,
              toolName:
                tool.name as SubagentCandidateVerificationRecord["toolName"],
              kind: "error",
              status: "error",
              passed: false,
              inputSha256,
              resultSha256: sha256(
                canonicalJson({
                  errorName:
                    error instanceof Error ? error.name : "UnknownError",
                }),
              ),
              candidateSnapshotSha256: snapshot.contentSha256,
            });
            throw error;
          }
        }),
    };
  }

  async settle(): Promise<void> {
    await this.tail;
  }

  summarize(
    finalCandidateSnapshotSha256: string,
  ): SubagentCandidateVerificationSummary {
    const attempts = this.records
      .slice()
      .sort((left, right) => left.attempt - right.attempt)
      .map((record) => ({
        ...record,
        fresh: record.candidateSnapshotSha256 === finalCandidateSnapshotSha256,
      }));
    const fresh = attempts.filter((attempt) => attempt.fresh);
    const receipt = attempts.map((attempt) => ({
      attempt: attempt.attempt,
      toolName: attempt.toolName,
      kind: attempt.kind,
      status: attempt.status,
      passed: attempt.passed,
      inputSha256: attempt.inputSha256,
      resultSha256: attempt.resultSha256,
      candidateSnapshotSha256: attempt.candidateSnapshotSha256,
      fresh: attempt.fresh,
    }));
    return {
      attemptCount: attempts.length,
      freshCount: fresh.length,
      passedCount: fresh.filter((attempt) => attempt.passed).length,
      failedCount: fresh.filter((attempt) => !attempt.passed).length,
      staleCount: attempts.length - fresh.length,
      setSha256: sha256(canonicalJson(receipt)),
      attempts,
    };
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = (): void => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
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

function successfulRecord(
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
  const resultSha256 =
    typeof details["resultSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(details["resultSha256"])
      ? details["resultSha256"]
      : sha256(canonicalJson(safeDetails(details)));
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

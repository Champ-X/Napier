import type { AgentTool } from "@earendil-works/pi-agent-core";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  observeSubagentWorktreeCandidate,
  type SubagentWorktreeSession,
} from "./subagent-worktree-files.js";

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

export class SubagentWorktreeOperationCoordinator {
  private tail = Promise.resolve();
  private nextAttempt = 1;
  private nextCommandAttempt = 1;
  private readonly records: SubagentCandidateVerificationRecord[] = [];
  private readonly commandRecords: SubagentCandidateCommandRecord[] = [];
  private commandMutationDetected = false;

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

  wrapCommandTool(
    tool: AgentTool,
    session: SubagentWorktreeSession,
    verifyToolchain?: () => Promise<void>,
  ): AgentTool {
    if (tool.name !== "run_command") {
      throw new Error("Coder candidate command tool is unsupported");
    }
    return {
      ...tool,
      execute: (toolCallId, args, signal) =>
        this.serial(async () => {
          if (this.nextCommandAttempt > MAX_SUBAGENT_CANDIDATE_COMMANDS) {
            throw new Error("Coder candidate command attempt limit exceeded");
          }
          const attempt = this.nextCommandAttempt;
          this.nextCommandAttempt += 1;
          const inputSha256 = sha256(
            canonicalJson({ toolName: tool.name, args }),
          );
          const before = await observeSubagentWorktreeCandidate(session);
          try {
            await verifyToolchain?.();
            const result = await tool.execute(toolCallId, args, signal);
            await verifyToolchain?.();
            const after = await observeSubagentWorktreeCandidate(
              session,
              signal,
            );
            if (before.contentSha256 !== after.contentSha256) {
              this.commandMutationDetected = true;
              throw new Error(
                "Read-only coder candidate command changed candidate bytes",
              );
            }
            this.commandRecords.push(
              successfulCommandRecord(
                attempt,
                inputSha256,
                result,
                before.contentSha256,
                after.contentSha256,
              ),
            );
            return result;
          } catch (error) {
            let failure = error;
            try {
              await verifyToolchain?.();
            } catch (toolchainError) {
              failure = toolchainError;
            }
            const after = await observeSubagentWorktreeCandidate(session);
            if (before.contentSha256 !== after.contentSha256) {
              this.commandMutationDetected = true;
            }
            this.commandRecords.push({
              attempt,
              runtime: "node",
              status: "error",
              succeeded: false,
              inputSha256,
              resultSha256: sha256(
                canonicalJson({
                  errorName:
                    failure instanceof Error ? failure.name : "UnknownError",
                }),
              ),
              beforeCandidateSnapshotSha256: before.contentSha256,
              candidateSnapshotSha256: after.contentSha256,
            });
            throw failure;
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

  summarizeCommands(
    finalCandidateSnapshotSha256: string,
  ): SubagentCandidateCommandSummary {
    if (this.commandMutationDetected) {
      throw new Error(
        "Coder candidate command violated the read-only workspace boundary",
      );
    }
    const attempts = this.commandRecords
      .slice()
      .sort((left, right) => left.attempt - right.attempt)
      .map((record) => ({
        ...record,
        fresh: record.candidateSnapshotSha256 === finalCandidateSnapshotSha256,
      }));
    const fresh = attempts.filter((attempt) => attempt.fresh);
    const receipt = attempts.map((attempt) => ({
      attempt: attempt.attempt,
      runtime: attempt.runtime,
      status: attempt.status,
      succeeded: attempt.succeeded,
      inputSha256: attempt.inputSha256,
      resultSha256: attempt.resultSha256,
      beforeCandidateSnapshotSha256: attempt.beforeCandidateSnapshotSha256,
      candidateSnapshotSha256: attempt.candidateSnapshotSha256,
      fresh: attempt.fresh,
    }));
    return {
      attemptCount: attempts.length,
      freshCount: fresh.length,
      succeededCount: fresh.filter((attempt) => attempt.succeeded).length,
      failedCount: fresh.filter((attempt) => !attempt.succeeded).length,
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

function successfulCommandRecord(
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
  const resultSha256 =
    typeof details["resultSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(details["resultSha256"])
      ? details["resultSha256"]
      : sha256(canonicalJson(safeDetails(details)));
  return {
    attempt,
    runtime: "node",
    status,
    succeeded: status === "succeeded",
    inputSha256,
    resultSha256,
    beforeCandidateSnapshotSha256,
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

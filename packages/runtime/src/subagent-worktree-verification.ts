import type { AgentTool } from "@earendil-works/pi-agent-core";

import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  observeSubagentWorktreeCandidate,
  type SubagentWorktreeSession,
} from "./subagent-worktree-files.js";
import type { SubagentWorktreeSnapshot } from "./subagent-worktree-diff.js";
import {
  MAX_SUBAGENT_CANDIDATE_COMMANDS,
  MAX_SUBAGENT_CANDIDATE_VERIFICATIONS,
  successfulCommandRecord,
  successfulVerificationRecord,
  summarizeCandidateCommands,
  summarizeCandidateVerification,
  type SubagentCandidateCommandRecord,
  type SubagentCandidateCommandSummary,
  type SubagentCandidateVerificationRecord,
  type SubagentCandidateVerificationSummary,
} from "./subagent-worktree-operation-evidence.js";

export {
  formatSubagentCandidateCommands,
  formatSubagentCandidateVerification,
  MAX_SUBAGENT_CANDIDATE_COMMANDS,
  MAX_SUBAGENT_CANDIDATE_VERIFICATIONS,
  type SubagentCandidateCommandRecord,
  type SubagentCandidateCommandSummary,
  type SubagentCandidateCommandView,
  type SubagentCandidateVerificationRecord,
  type SubagentCandidateVerificationSummary,
  type SubagentCandidateVerificationView,
} from "./subagent-worktree-operation-evidence.js";

export class SubagentWorktreeOperationCoordinator {
  private tail = Promise.resolve();
  private nextAttempt = 1;
  private nextCommandAttempt = 1;
  private readonly records: SubagentCandidateVerificationRecord[] = [];
  private readonly commandRecords: SubagentCandidateCommandRecord[] = [];
  private integrityViolated = false;

  async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.serial(operation);
  }

  async runReadOnlyOperation<T>(
    label: string,
    session: SubagentWorktreeSession,
    operation: () => Promise<T>,
    verifyToolchain?: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.serial(async () => {
      const before = await observeSubagentWorktreeCandidate(session);
      try {
        await verifyToolchain?.();
        const result = await operation();
        await verifyToolchain?.();
        const after = await observeSubagentWorktreeCandidate(session, signal);
        this.assertReadOnlySnapshot(label, before, after);
        return result;
      } catch (error) {
        const failure = await settleToolchainFailure(error, verifyToolchain);
        const after = await this.observeAfterFailure(session);
        if (before.contentSha256 !== after.contentSha256) {
          this.integrityViolated = true;
        }
        throw failure;
      }
    });
  }

  wrapReadOnlyTool(
    tool: AgentTool,
    session: SubagentWorktreeSession,
    verifyToolchain?: () => Promise<void>,
  ): AgentTool {
    return preserveAgentToolIdentity(tool, {
      ...tool,
      execute: (toolCallId, args, signal) =>
        this.runReadOnlyOperation(
          tool.name,
          session,
          () => tool.execute(toolCallId, args, signal),
          verifyToolchain,
          signal,
        ),
    });
  }

  wrapMutationTool(
    tool: AgentTool,
    session: SubagentWorktreeSession,
    verifyToolchain?: () => Promise<void>,
  ): AgentTool {
    return preserveAgentToolIdentity(tool, {
      ...tool,
      execute: (toolCallId, args, signal) =>
        this.serial(async () => {
          const before = await observeSubagentWorktreeCandidate(session);
          try {
            await verifyToolchain?.();
            const result = await tool.execute(toolCallId, args, signal);
            await verifyToolchain?.();
            if (!verifiedMutationResult(result)) {
              this.integrityViolated = true;
              throw new Error(
                `Coder candidate ${tool.name} did not settle with a verified postcondition`,
              );
            }
            return result;
          } catch (error) {
            const failure = await settleToolchainFailure(
              error,
              verifyToolchain,
            );
            const after = await this.observeAfterFailure(session);
            if (before.contentSha256 !== after.contentSha256) {
              this.integrityViolated = true;
            }
            throw failure;
          }
        }),
    });
  }

  assertIntegrity(): void {
    if (this.integrityViolated) {
      throw new Error("Coder candidate operation integrity is indeterminate");
    }
  }

  wrapVerificationTool(
    tool: AgentTool,
    session: SubagentWorktreeSession,
    verifyToolchain?: () => Promise<void>,
  ): AgentTool {
    if (tool.name !== "lsp_diagnostics" && tool.name !== "verify_workspace") {
      throw new Error("Coder candidate verification tool is unsupported");
    }
    return preserveAgentToolIdentity(tool, {
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
              successfulVerificationRecord(
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
    });
  }

  wrapCommandTool(
    tool: AgentTool,
    session: SubagentWorktreeSession,
    verifyToolchain?: () => Promise<void>,
  ): AgentTool {
    if (tool.name !== "run_command") {
      throw new Error("Coder candidate command tool is unsupported");
    }
    return preserveAgentToolIdentity(tool, {
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
              this.integrityViolated = true;
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
              this.integrityViolated = true;
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
    });
  }

  async settle(): Promise<void> {
    await this.tail;
  }

  summarize(
    finalCandidateSnapshotSha256: string,
  ): SubagentCandidateVerificationSummary {
    return summarizeCandidateVerification(
      this.records,
      finalCandidateSnapshotSha256,
    );
  }

  summarizeCommands(
    finalCandidateSnapshotSha256: string,
  ): SubagentCandidateCommandSummary {
    this.assertIntegrity();
    return summarizeCandidateCommands(
      this.commandRecords,
      finalCandidateSnapshotSha256,
    );
  }

  private assertReadOnlySnapshot(
    toolName: string,
    before: SubagentWorktreeSnapshot,
    after: SubagentWorktreeSnapshot,
  ): void {
    if (before.contentSha256 === after.contentSha256) return;
    this.integrityViolated = true;
    throw new Error(
      `Read-only coder candidate tool ${toolName} changed candidate bytes`,
    );
  }

  private async observeAfterFailure(
    session: SubagentWorktreeSession,
  ): Promise<SubagentWorktreeSnapshot> {
    try {
      return await observeSubagentWorktreeCandidate(session);
    } catch (error) {
      this.integrityViolated = true;
      throw error;
    }
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

async function settleToolchainFailure(
  error: unknown,
  verifyToolchain?: () => Promise<void>,
): Promise<unknown> {
  try {
    await verifyToolchain?.();
    return error;
  } catch (toolchainError) {
    return toolchainError;
  }
}

function verifiedMutationResult(result: unknown): boolean {
  const details = record(record(result)?.["details"]);
  return (
    details?.["postcondition"] === "verified" &&
    (details["status"] === "applied" || details["status"] === "rolled_back")
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

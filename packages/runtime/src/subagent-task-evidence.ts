import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Usage as PiUsage } from "@earendil-works/pi-ai";
import type {
  JsonValue,
  SubagentRole,
  SubagentTask,
  Usage,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { SubagentWorktreePreview } from "./subagent-worktree-mutation.js";
import { formatSubagentCandidateVerification } from "./subagent-worktree-verification.js";

export const MAX_SUBAGENT_STEP_CHARS = 8_192;
export const MAX_SUBAGENT_RESULT_CHARS = 12_000;

export interface DelegationDetails {
  taskId: string;
  role: SubagentRole;
  status: SubagentTask["status"];
  turnCount: number;
  stepCount: number;
  stopReason?: SubagentTask["stopReason"];
  outcomeSha256?: string;
  itemCount?: number;
  evidenceCount?: number;
  worktreePreviewId?: string;
  worktreeExpiresAt?: string;
  changedFileCount?: number;
  changedFileSetSha256?: string;
  sourceSnapshotSha256?: string;
  candidateVerificationAttemptCount?: number;
  candidateVerificationFreshCount?: number;
  candidateVerificationPassedCount?: number;
  candidateVerificationFailedCount?: number;
  candidateVerificationStaleCount?: number;
  candidateVerificationSetSha256?: string;
  candidateToolchainSha256?: string;
}

export function subagentTaskPayload(
  task: SubagentTask,
  preview?: SubagentWorktreePreview,
): Record<string, unknown> {
  return {
    taskId: task.id,
    role: task.role,
    description: task.description,
    status: task.status,
    result: task.result ?? "",
    error: task.error ?? "",
    stopReason: task.stopReason ?? "",
    stepCount: task.stepCount,
    turnCount: task.turnCount,
    usage: task.usage,
    ...(task.outcome ? { outcome: task.outcome } : {}),
    ...(preview
      ? {
          workspaceMode: "isolated_write",
          mergePreviewAvailable: true,
          sourceSnapshotSha256: preview.sourceSnapshotSha256,
          changedFileCount: preview.changedFileCount,
          changedFileSetSha256: preview.changedFileSetSha256,
          candidateVerificationAttemptCount:
            preview.candidateVerification.attemptCount,
          candidateVerificationFreshCount:
            preview.candidateVerification.freshCount,
          candidateVerificationPassedCount:
            preview.candidateVerification.passedCount,
          candidateVerificationFailedCount:
            preview.candidateVerification.failedCount,
          candidateVerificationStaleCount:
            preview.candidateVerification.staleCount,
          candidateVerificationSetSha256:
            preview.candidateVerification.setSha256,
          ...(preview.candidateToolchainSha256
            ? { candidateToolchainSha256: preview.candidateToolchainSha256 }
            : {}),
        }
      : {}),
  };
}

export function subagentTaskDetails(
  task: SubagentTask,
  preview?: SubagentWorktreePreview,
): DelegationDetails {
  return {
    taskId: task.id,
    role: task.role,
    status: task.status,
    turnCount: task.turnCount,
    stepCount: task.stepCount,
    ...(task.stopReason ? { stopReason: task.stopReason } : {}),
    ...(task.outcome
      ? {
          outcomeSha256: task.outcome.contentSha256,
          itemCount: task.outcome.itemCount,
          evidenceCount: task.outcome.evidenceCount,
        }
      : {}),
    ...(preview
      ? {
          worktreePreviewId: preview.id,
          worktreeExpiresAt: preview.expiresAt,
          changedFileCount: preview.changedFileCount,
          changedFileSetSha256: preview.changedFileSetSha256,
          sourceSnapshotSha256: preview.sourceSnapshotSha256,
          candidateVerificationAttemptCount:
            preview.candidateVerification.attemptCount,
          candidateVerificationFreshCount:
            preview.candidateVerification.freshCount,
          candidateVerificationPassedCount:
            preview.candidateVerification.passedCount,
          candidateVerificationFailedCount:
            preview.candidateVerification.failedCount,
          candidateVerificationStaleCount:
            preview.candidateVerification.staleCount,
          candidateVerificationSetSha256:
            preview.candidateVerification.setSha256,
          ...(preview.candidateToolchainSha256
            ? { candidateToolchainSha256: preview.candidateToolchainSha256 }
            : {}),
        }
      : {}),
  };
}

export function formatDelegationResult(
  task: SubagentTask,
  result: string,
  preview?: SubagentWorktreePreview,
): string {
  return [
    `Delegation ${task.id} (${task.role}) completed.`,
    "",
    result,
    ...(preview
      ? [
          "",
          "Coder worktree candidate is isolated and not yet merged.",
          `Changed files: ${preview.changedFileCount}`,
          ...preview.changedPaths.map((candidate) => `- ${candidate}`),
          `Apply preview: ${preview.id}`,
          `Preview expires: ${preview.expiresAt}`,
          "",
          preview.review,
          ...(preview.reviewTruncated
            ? [
                "Candidate review is truncated. Treat unshown changes as unresolved before applying.",
              ]
            : []),
          "",
          ...formatSubagentCandidateVerification(preview.candidateVerification),
          "Review the candidate evidence, then call subagent_worktree_apply with this preview ID.",
        ]
      : []),
  ].join("\n");
}

export function addSubagentUsage(current: Usage, update: PiUsage): Usage {
  return {
    inputTokens: current.inputTokens + update.input,
    outputTokens: current.outputTokens + update.output,
    cacheReadTokens: current.cacheReadTokens + update.cacheRead,
    cacheWriteTokens: current.cacheWriteTokens + update.cacheWrite,
    costUsd: current.costUsd + update.cost.total,
  };
}

export function truncateSubagentText(
  value: string,
  maxCharacters: number,
): string {
  return value.length <= maxCharacters
    ? value
    : `${value.slice(0, Math.max(0, maxCharacters - 14))}\n[truncated]`;
}

export function subagentToolResultText(
  event: Extract<AgentEvent, { type: "tool_execution_end" }>,
): string {
  const result = event.result as { content?: unknown };
  if (!Array.isArray(result?.content)) return String(event.result ?? "");
  return result.content
    .flatMap((item): string[] => {
      if (
        item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string"
      ) {
        return [item.text];
      }
      return [];
    })
    .join("\n");
}

export function delegateTaskCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args);
  const writePaths = Array.isArray(value?.["writePaths"])
    ? value["writePaths"].filter(
        (candidate): candidate is string => typeof candidate === "string",
      )
    : [];
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    role: typeof value?.["role"] === "string" ? value["role"] : "unknown",
    descriptionSha256: sha256(
      typeof value?.["description"] === "string" ? value["description"] : "",
    ),
    taskSha256: sha256(
      typeof value?.["task"] === "string" ? value["task"] : "",
    ),
    writeScopeCount: writePaths.length,
    writeScopeSetSha256: sha256(
      canonicalJson(writePaths.map((candidate) => sha256(candidate)).sort()),
    ),
    inputSha256: sha256(canonicalJson({ toolName: "delegate_task", args })),
  };
}

export function delegateTaskInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: sha256(canonicalJson(args)),
    inputRedacted: true,
  };
}

export function delegateTaskOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details = record(record(result)?.["details"]);
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(details
      ? {
          details: subagentJsonValue({
            taskId: details["taskId"],
            role: details["role"],
            status: details["status"],
            turnCount: details["turnCount"],
            stepCount: details["stepCount"],
            stopReason: details["stopReason"],
            outcomeSha256: details["outcomeSha256"],
            itemCount: details["itemCount"],
            evidenceCount: details["evidenceCount"],
            changedFileCount: details["changedFileCount"],
            changedFileSetSha256: details["changedFileSetSha256"],
            sourceSnapshotSha256: details["sourceSnapshotSha256"],
            candidateVerificationAttemptCount:
              details["candidateVerificationAttemptCount"],
            candidateVerificationFreshCount:
              details["candidateVerificationFreshCount"],
            candidateVerificationPassedCount:
              details["candidateVerificationPassedCount"],
            candidateVerificationFailedCount:
              details["candidateVerificationFailedCount"],
            candidateVerificationStaleCount:
              details["candidateVerificationStaleCount"],
            candidateVerificationSetSha256:
              details["candidateVerificationSetSha256"],
            candidateToolchainSha256: details["candidateToolchainSha256"],
            mergePreviewAvailable:
              typeof details["worktreePreviewId"] === "string",
          }),
        }
      : {}),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function subagentJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

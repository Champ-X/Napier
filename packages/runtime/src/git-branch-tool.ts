import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { GitBranchMutationManager } from "./git-branch.js";
import {
  DEFAULT_GIT_BRANCH_TIMEOUT_MS,
  type GitBranchDetails,
  MAX_GIT_BRANCH_NAME_BYTES,
  MAX_GIT_BRANCH_TIMEOUT_MS,
} from "./git-branch-model.js";

const previewSchema = Type.Object(
  {
    branchName: Type.String({
      minLength: 1,
      maxLength: MAX_GIT_BRANCH_NAME_BYTES,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
      description:
        "New local branch name. Use a short credential-free ASCII name.",
    }),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 1_000,
        maximum: MAX_GIT_BRANCH_TIMEOUT_MS,
        description: "Total branch inspection wall-time budget.",
      }),
    ),
  },
  { additionalProperties: false },
);

const applySchema = Type.Object(
  {
    previewId: Type.String({
      pattern: "^gitbranchpreview_[a-z0-9]{8,80}$",
      description:
        "One-use execution-scoped ID returned by git_branch_create_preview.",
    }),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 1_000,
        maximum: MAX_GIT_BRANCH_TIMEOUT_MS,
        description:
          "Branch preflight/ref-CAS deadline. Post-CAS settlement uses only the remaining budget and is never abandoned on cancellation.",
      }),
    ),
  },
  { additionalProperties: false },
);

const DETAIL_KEYS = [
  "kind",
  "schemaVersion",
  "operation",
  "action",
  "status",
  "postcondition",
  "previewId",
  "expiresAt",
  "branchRefSha256",
  "branchNameBytes",
  "targetCommitSha1",
  "beforeRepositoryStateSha256",
  "afterRepositoryStateSha256",
  "sourcePreviewResultSha256",
  "refUpdateStatus",
  "errorSha256",
  "runtimeEvidenceSha256",
  "durationMs",
  "durable",
  "cancellationObserved",
  "resultSha256",
] as const;

export function createGitBranchPreviewTool(
  manager: GitBranchMutationManager,
  context: { threadId: string; scopeId: string },
): AgentTool<typeof previewSchema, GitBranchDetails> {
  return {
    name: "git_branch_create_preview",
    label: "Preview Git branch creation",
    description:
      "Preview creation of one new local branch at the exact current HEAD. Returns a one-use execution-scoped ID without changing refs, HEAD, index, worktree, or objects. It does not switch branches.",
    parameters: previewSchema,
    async execute(_toolCallId, input, signal) {
      const preview = await manager.preview(
        context.threadId,
        context.scopeId,
        {
          branchName: input.branchName,
          timeoutMs: input.timeoutMs ?? DEFAULT_GIT_BRANCH_TIMEOUT_MS,
        },
        signal ?? undefined,
      );
      const text = [
        "GIT BRANCH CREATE PREVIEW",
        `Branch: ${preview.branchName}`,
        `Target commit: ${preview.details.targetCommitSha1}`,
        `Preview ID: ${preview.id}`,
        `Expires at: ${preview.expiresAt}`,
        "",
        "No ref, HEAD, index, worktree, or object change was made. Review the branch and target, then pass only the one-use ID to git_branch_create_apply.",
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: preview.details,
      };
    },
  };
}

export function createGitBranchApplyTool(
  manager: GitBranchMutationManager,
  context: { threadId: string; scopeId: string },
): AgentTool<typeof applySchema, GitBranchDetails> {
  return {
    name: "git_branch_create_apply",
    label: "Create Git branch",
    description:
      "Create one fresh previewed local branch with an exact zero-old ref CAS. Hooks, branch switching, checkout, index/worktree writes, remotes, and history rewriting are unavailable.",
    parameters: applySchema,
    async execute(_toolCallId, input, signal) {
      const result = await manager.apply(
        context.threadId,
        context.scopeId,
        input.previewId,
        input.timeoutMs ?? DEFAULT_GIT_BRANCH_TIMEOUT_MS,
        signal ?? undefined,
      );
      const text = [
        `GIT BRANCH CREATE ${result.details.status.toUpperCase()}`,
        `Branch: ${result.branchName}`,
        `Target commit: ${result.details.targetCommitSha1}`,
        `Postcondition: ${result.details.postcondition}`,
        result.details.status === "applied"
          ? "The new local branch ref is durable. HEAD, index, and worktree remain unchanged."
          : "Branch creation is indeterminate. Inspect status and the exact branch ref before any retry.",
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: result.details,
      };
    },
  };
}

export function gitBranchToolCallArgumentsLedgerProjection(
  toolName: string,
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    toolName,
    ...(toolName === "git_branch_create_preview" &&
    typeof value["branchName"] === "string"
      ? {
          branchRefSha256: sha256(`refs/heads/${value["branchName"]}`),
          branchNameBytes: Buffer.byteLength(value["branchName"], "utf8"),
        }
      : {}),
    ...(toolName === "git_branch_create_apply" &&
    typeof value["previewId"] === "string"
      ? { previewIdSha256: sha256(value["previewId"]) }
      : {}),
    timeoutMs:
      Number.isSafeInteger(value["timeoutMs"]) &&
      Number(value["timeoutMs"]) >= 1_000
        ? Number(value["timeoutMs"])
        : DEFAULT_GIT_BRANCH_TIMEOUT_MS,
    inputSha256: gitBranchCallSha256(toolName, args),
  };
}

export function gitBranchToolInputLedgerProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: gitBranchCallSha256(toolName, args),
    inputRedacted: true,
  };
}

export function gitBranchToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : undefined;
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(details ? safeDetails(details) : {}),
  };
}

function safeDetails(
  details: Record<string, unknown>,
): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};
  for (const key of DETAIL_KEYS) {
    const value = details[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      output[key] = value;
    }
  }
  return output;
}

function gitBranchCallSha256(toolName: string, args: unknown): string {
  return sha256(canonicalJson({ toolName, args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

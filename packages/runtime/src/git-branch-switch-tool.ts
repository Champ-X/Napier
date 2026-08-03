import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import {
  DEFAULT_GIT_BRANCH_TIMEOUT_MS,
  MAX_GIT_BRANCH_NAME_BYTES,
  MAX_GIT_BRANCH_TIMEOUT_MS,
} from "./git-branch-model.js";
import type { GitBranchSwitchMutationManager } from "./git-branch-switch.js";
import type { GitBranchSwitchDetails } from "./git-branch-switch-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";

const previewSchema = Type.Object(
  {
    targetBranchName: Type.String({
      minLength: 1,
      maxLength: MAX_GIT_BRANCH_NAME_BYTES,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
      description:
        "Existing local branch name at the exact current HEAD commit.",
    }),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 1_000,
        maximum: MAX_GIT_BRANCH_TIMEOUT_MS,
        description: "Total switch preflight wall-time budget.",
      }),
    ),
  },
  { additionalProperties: false },
);

const applySchema = Type.Object(
  {
    previewId: Type.String({
      pattern: "^gitswitchpreview_[a-z0-9]{8,80}$",
      description:
        "One-use execution-scoped ID returned by git_branch_switch_preview.",
    }),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 1_000,
        maximum: MAX_GIT_BRANCH_TIMEOUT_MS,
        description:
          "Switch transaction deadline. Post-transaction settlement uses only the remaining budget and is never abandoned on cancellation.",
      }),
    ),
  },
  { additionalProperties: false },
);

const DETAIL_KEYS = [
  "kind",
  "schemaVersion",
  "action",
  "status",
  "postcondition",
  "previewId",
  "expiresAt",
  "targetRefSha256",
  "targetBranchNameBytes",
  "commitSha1",
  "beforeRepositoryStateSha256",
  "beforeHeadReflogStateSha256",
  "afterRepositoryStateSha256",
  "afterHeadReflogStateSha256",
  "sourcePreviewResultSha256",
  "switchStatus",
  "errorSha256",
  "runtimeEvidenceSha256",
  "durationMs",
  "durable",
  "cancellationObserved",
  "resultSha256",
] as const;

export function createGitBranchSwitchPreviewTool(
  manager: GitBranchSwitchMutationManager,
  context: { threadId: string; scopeId: string },
): AgentTool<typeof previewSchema, GitBranchSwitchDetails> {
  return {
    name: "git_branch_switch_preview",
    label: "Preview Git branch switch",
    description:
      "Preview attachment of HEAD to one existing local branch at the exact current commit. It does not support divergent branches and never changes HEAD, reflog, index, worktree, or objects during preview.",
    parameters: previewSchema,
    async execute(_toolCallId, input, signal) {
      const preview = await manager.preview(
        context.threadId,
        context.scopeId,
        {
          targetBranchName: input.targetBranchName,
          timeoutMs: input.timeoutMs ?? DEFAULT_GIT_BRANCH_TIMEOUT_MS,
        },
        signal ?? undefined,
      );
      const text = [
        "GIT BRANCH SWITCH PREVIEW",
        `Target branch: ${preview.targetBranchName}`,
        `Shared commit: ${preview.details.commitSha1}`,
        `Preview ID: ${preview.id}`,
        `Expires at: ${preview.expiresAt}`,
        "",
        "No HEAD, reflog, index, worktree, or object change was made. Review the target, then pass only the one-use ID to git_branch_switch_apply.",
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: preview.details,
      };
    },
  };
}

export function createGitBranchSwitchApplyTool(
  manager: GitBranchSwitchMutationManager,
  context: { threadId: string; scopeId: string },
): AgentTool<typeof applySchema, GitBranchSwitchDetails> {
  return {
    name: "git_branch_switch_apply",
    label: "Switch Git branch",
    description:
      "Atomically attach HEAD to one previewed same-commit local branch through a target-OID and source-HEAD ref transaction. Hooks, checkout, index/worktree writes, remotes, and history rewriting are unavailable.",
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
        `GIT BRANCH SWITCH ${result.details.status.toUpperCase()}`,
        `Target branch: ${result.targetBranchName}`,
        `Commit: ${result.details.commitSha1}`,
        `Postcondition: ${result.details.postcondition}`,
        result.details.status === "applied"
          ? "HEAD is durably attached to the reviewed same-commit branch. Index and worktree were not changed."
          : "Branch switch is indeterminate. Inspect HEAD, status, and the target branch before any retry.",
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: result.details,
      };
    },
  };
}

export function gitBranchSwitchToolCallArgumentsLedgerProjection(
  toolName: string,
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    toolName,
    ...(toolName === "git_branch_switch_preview" &&
    typeof value["targetBranchName"] === "string"
      ? {
          targetRefSha256: sha256(`refs/heads/${value["targetBranchName"]}`),
          targetBranchNameBytes: Buffer.byteLength(
            value["targetBranchName"],
            "utf8",
          ),
        }
      : {}),
    ...(toolName === "git_branch_switch_apply" &&
    typeof value["previewId"] === "string"
      ? { previewIdSha256: sha256(value["previewId"]) }
      : {}),
    timeoutMs:
      Number.isSafeInteger(value["timeoutMs"]) &&
      Number(value["timeoutMs"]) >= 1_000
        ? Number(value["timeoutMs"])
        : DEFAULT_GIT_BRANCH_TIMEOUT_MS,
    inputSha256: callSha256(toolName, args),
  };
}

export function gitBranchSwitchToolInputLedgerProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: callSha256(toolName, args),
    inputRedacted: true,
  };
}

export function gitBranchSwitchToolOutputLedgerProjection(
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

function callSha256(toolName: string, args: unknown): string {
  return sha256(canonicalJson({ toolName, args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

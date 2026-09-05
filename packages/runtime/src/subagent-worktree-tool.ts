import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  JsonValue,
  SubagentWorktreeApplyDetails,
} from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { SubagentWorktreeApplyManager } from "./subagent-worktree-mutation-model.js";
import {
  defineToolProgress,
  progressSemantics,
  resultDetails,
  stableFields,
} from "./tool-progress-semantics.js";

const applySchema = Type.Object(
  {
    previewId: Type.String({
      minLength: 1,
      maxLength: 120,
      description:
        "Opaque one-use preview ID returned by a completed coder delegation.",
    }),
  },
  { additionalProperties: false },
);

export function createSubagentWorktreeApplyTool(
  manager: SubagentWorktreeApplyManager,
): AgentTool<typeof applySchema, SubagentWorktreeApplyDetails> {
  return defineToolProgress(
    {
      name: "subagent_worktree_apply",
      label: "Apply coder worktree",
      description:
        "Apply one reviewed coder Subagent worktree through its opaque one-use preview. The source workspace must still match the complete fork snapshot; multi-file commit, rollback, diagnostics, and enabled related tests are coordinated by Napier.",
      parameters: applySchema,
      async execute(_toolCallId, input, signal) {
        const applied = await manager.apply(input.previewId, signal);
        return {
          content: [{ type: "text", text: applied.summary }],
          details: applied.details,
        };
      },
    },
    {
      schemaVersion: 1,
      classificationVersion: "1.0.0",
      modes: [
        { modeId: "apply_workspace", operation: "mutate", scope: "workspace", contribution: "product" },
      ],
      resolve: (input) => ({
        semantics: progressSemantics("mutate", "workspace", "product"),
        resourceKey: { kind: "subagent-worktree-preview", input },
      }),
      state: (_input, result) =>
        stableFields(resultDetails(result), ["resultSha256"]),
    },
  );
}

export function subagentWorktreeToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    inputSha256: sha256(
      canonicalJson({ toolName: "subagent_worktree_apply", args }),
    ),
  };
}

export function subagentWorktreeToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: sha256(canonicalJson(args)),
    inputRedacted: true,
  };
}

export function subagentWorktreeToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const value = record(result);
  const details = record(value?.["details"]);
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(details && hash(details["resultSha256"])
      ? { resultSha256: details["resultSha256"] }
      : {}),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

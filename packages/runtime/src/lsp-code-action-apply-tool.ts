import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue, LspCodeActionApplyDetails } from "@napier/contracts";
import { Type } from "typebox";

import type { LspCodeActionMutationManager } from "./lsp-code-action-mutation-manager.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  defineToolProgress,
  progressSemantics,
  resultDetails,
  stableFields,
} from "./tool-progress-semantics.js";

const lspCodeActionApplySchema = Type.Object(
  {
    previewId: Type.String({
      pattern: "^actionpreview_[a-z0-9]{8,80}$",
      description:
        "One-use mutually exclusive apply preview ID returned for one lsp_code_actions alternative in this Run.",
    }),
  },
  { additionalProperties: false },
);

export function createLspCodeActionApplyTool(
  manager: LspCodeActionMutationManager,
): AgentTool<typeof lspCodeActionApplySchema, LspCodeActionApplyDetails> {
  return defineToolProgress(
    {
      name: "lsp_code_action_apply",
      label: "Apply LSP quick fix",
      description:
        "Apply exactly one fresh same-Run lsp_code_actions alternative as a coordinated write. Selecting an ID invalidates every sibling alternative from that response. Napier locks and rehashes every target, stages all outputs, attempts verified rollback on commit failure, links bounded before/after diagnostics and relevant tests, and never executes the Code Action command.",
      parameters: lspCodeActionApplySchema,
      async execute(_toolCallId, input, signal) {
        const result = await manager.apply(
          input.previewId,
          signal ?? undefined,
        );
        return {
          content: [{ type: "text", text: result.summary }],
          details: result.details,
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
        resourceKey: { kind: "lsp-code-action-preview", input },
      }),
      state: (_input, result) =>
        stableFields(resultDetails(result), ["resultSha256"]),
    },
  );
}

export function lspCodeActionApplyToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const previewId =
    record(args) && typeof args["previewId"] === "string"
      ? args["previewId"]
      : "";
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    previewIdSha256: sha256(previewId),
    inputSha256: lspCodeActionApplyCallSha256(args),
  };
}

export function lspCodeActionApplyToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: lspCodeActionApplyCallSha256(args),
    inputRedacted: true,
  };
}

export function lspCodeActionApplyToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : undefined;
  const resultSha256 =
    details && hash(details["resultSha256"])
      ? details["resultSha256"]
      : undefined;
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(resultSha256 ? { resultSha256 } : {}),
  };
}

function lspCodeActionApplyCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "lsp_code_action_apply", args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

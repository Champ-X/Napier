import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue, LspRenameApplyDetails } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LspRenameMutationManager } from "./lsp-rename-mutation-manager.js";

const lspRenameApplySchema = Type.Object(
  {
    previewId: Type.String({
      pattern: "^renamepreview_[a-z0-9]{8,80}$",
      description:
        "One-use apply preview ID returned by lsp_rename in this Run.",
    }),
  },
  { additionalProperties: false },
);

export function createLspRenameApplyTool(
  manager: LspRenameMutationManager,
): AgentTool<typeof lspRenameApplySchema, LspRenameApplyDetails> {
  return {
    name: "lsp_rename_apply",
    label: "Apply LSP rename",
    description:
      "Apply one fresh same-Run lsp_rename preview as a coordinated multi-file write. Napier locks and rehashes every target, stages all outputs, attempts verified rollback on commit failure, and links bounded before/after diagnostics. Never retry an indeterminate result without inspecting the workspace.",
    parameters: lspRenameApplySchema,
    async execute(_toolCallId, input, signal) {
      const result = await manager.apply(input.previewId, signal ?? undefined);
      return {
        content: [{ type: "text", text: result.summary }],
        details: result.details,
      };
    },
  };
}

export function lspRenameApplyToolCallArgumentsLedgerProjection(
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
    inputSha256: lspRenameApplyCallSha256(args),
  };
}

export function lspRenameApplyToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: lspRenameApplyCallSha256(args),
    inputRedacted: true,
  };
}

export function lspRenameApplyToolOutputLedgerProjection(
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

function lspRenameApplyCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "lsp_rename_apply", args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

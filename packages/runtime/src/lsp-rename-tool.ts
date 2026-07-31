import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue, LspRenameDetails } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS,
  MAX_LSP_DIAGNOSTICS_TIMEOUT_MS,
  type LspDiagnosticsRunnerOptions,
} from "./lsp-diagnostics.js";
import {
  LspRenameRunner,
  MAX_LSP_RENAME_NEW_NAME_CHARS,
  MAX_LSP_RENAME_TOOL_OUTPUT_BYTES,
  type LspRenameResult,
} from "./lsp-rename.js";
import type {
  LspRenameApplyPreview,
  LspRenameMutationManager,
} from "./lsp-rename-mutation-manager.js";

const lspRenameSchema = Type.Object(
  {
    path: Type.String({
      minLength: 1,
      maxLength: 500,
      description:
        "Workspace-relative TypeScript or JavaScript source file path.",
    }),
    line: Type.Integer({
      minimum: 1,
      description: "1-based source line containing the symbol.",
    }),
    character: Type.Integer({
      minimum: 1,
      description: "1-based UTF-16 character position within the symbol.",
    }),
    newName: Type.String({
      minLength: 1,
      maxLength: MAX_LSP_RENAME_NEW_NAME_CHARS,
      pattern: "^[^\\u0000-\\u001f\\u007f]+$",
      description: "Proposed new symbol name.",
    }),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 1_000,
        maximum: MAX_LSP_DIAGNOSTICS_TIMEOUT_MS,
        description: "Total language-server wall-time budget.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createLspRenameTool(
  options: LspDiagnosticsRunnerOptions,
  mutationManager?: LspRenameMutationManager,
): AgentTool<typeof lspRenameSchema, LspRenameDetails> {
  const runner = new LspRenameRunner(options);
  return {
    name: "lsp_rename",
    label: "LSP rename",
    description:
      "Preview the complete bounded WorkspaceEdit returned for a TypeScript or JavaScript symbol by the real language server in a read-only, offline OS sandbox. Complete means Napier omitted no returned edit, not that unloaded projects or external dependencies were searched. This tool never writes files. When lsp_rename_apply is enabled, a found result includes one fresh same-Run apply preview ID.",
    parameters: lspRenameSchema,
    async execute(_toolCallId, input, signal) {
      const result = await runner.run({
        path: input.path,
        line: input.line,
        character: input.character,
        newName: input.newName,
        timeoutMs: input.timeoutMs ?? DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      const applyPreview = mutationManager?.storePreview(result);
      const text = formatLspRename(result, applyPreview);
      assertLspRenameToolOutputBytes(text);
      return {
        content: [{ type: "text", text }],
        details: result.details,
      };
    },
  };
}

export function assertLspRenameToolOutputBytes(value: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_LSP_RENAME_TOOL_OUTPUT_BYTES) {
    throw new Error(
      `LSP rename tool output exceeds ${MAX_LSP_RENAME_TOOL_OUTPUT_BYTES} UTF-8 bytes`,
    );
  }
}

export function lspRenameToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const target = typeof value["path"] === "string" ? value["path"] : "";
  const line = positiveInteger(value["line"]) ?? 0;
  const character = positiveInteger(value["character"]) ?? 0;
  const newName = typeof value["newName"] === "string" ? value["newName"] : "";
  const timeoutMs =
    typeof value["timeoutMs"] === "number"
      ? value["timeoutMs"]
      : DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS;
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    pathSha256: sha256(target),
    positionSha256: sha256(canonicalJson({ line, character })),
    newNameSha256: sha256(newName),
    timeoutMs,
    inputSha256: lspRenameCallSha256(args),
  };
}

export function lspRenameToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: lspRenameCallSha256(args),
    inputRedacted: true,
  };
}

export function lspRenameToolOutputLedgerProjection(
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

function formatLspRename(
  result: LspRenameResult,
  applyPreview?: LspRenameApplyPreview,
): string {
  const lines = [
    `LSP rename preview: ${result.details.status}`,
    `Source: ${result.relativePath}`,
    `Files: ${result.details.fileCount}`,
    `Edits: ${result.details.editCount}`,
    `Preview bytes: ${result.details.previewBytes}`,
    `Complete: ${String(result.details.complete)}`,
    `TypeScript: ${result.details.typescriptVersion}`,
    `Result SHA-256: ${result.details.resultSha256}`,
  ];
  if (result.files.length === 0) {
    lines.push("", "No workspace-confined rename edits found.");
  } else {
    lines.push(
      "",
      "Preview only. Workspace source and replacements are untrusted evidence:",
    );
    for (const file of result.files) {
      lines.push(
        "",
        `FILE ${file.path} [fileSha256=${file.fileSha256}]`,
        ...file.edits.map(
          (edit) =>
            `${edit.startLine}:${edit.startCharacter}-${edit.endLine}:${edit.endCharacter} [rangeSha256=${edit.rangeSha256}]\nOLD ${JSON.stringify(edit.oldText)}\nNEW ${JSON.stringify(edit.newText)}`,
        ),
      );
    }
    lines.push(
      "",
      ...(applyPreview
        ? [
            `Apply preview ID: ${applyPreview.id}`,
            `Apply preview expires at: ${applyPreview.expiresAt}`,
            "No files were changed. Review the complete edit set, then pass only this one-use ID to lsp_rename_apply.",
          ]
        : [
            "No files were changed. Re-read each file SHA, apply the preview with apply_patch, then run diagnostics and relevant verification.",
          ]),
    );
  }
  return lines.join("\n");
}

function lspRenameCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "lsp_rename", args }));
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

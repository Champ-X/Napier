import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_TYPESCRIPT_AST_QUERY_RESULTS,
  MAX_TYPESCRIPT_AST_QUERY_RESULTS,
  MAX_TYPESCRIPT_AST_REPLACEMENT_BYTES,
  TypescriptAstRunner,
  type TypescriptAstEditPreviewDetails,
  type TypescriptAstQueryDetails,
} from "./typescript-ast.js";
import {
  MAX_TYPESCRIPT_AST_NAME_CHARS,
  TYPESCRIPT_AST_KINDS,
  type TypescriptAstKind,
} from "./typescript-ast-model.js";

export const MAX_TYPESCRIPT_AST_TOOL_OUTPUT_BYTES = 64 * 1024;

const astKindSchema = Type.Unsafe<TypescriptAstKind>({
  type: "string",
  enum: [...TYPESCRIPT_AST_KINDS],
});
const selectorSchema = Type.Object(
  {
    kind: astKindSchema,
    name: Type.Optional(
      Type.String({ minLength: 1, maxLength: MAX_TYPESCRIPT_AST_NAME_CHARS }),
    ),
    ancestorKind: Type.Optional(astKindSchema),
    ancestorName: Type.Optional(
      Type.String({ minLength: 1, maxLength: MAX_TYPESCRIPT_AST_NAME_CHARS }),
    ),
  },
  { additionalProperties: false },
);
const astQuerySchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 500 }),
    selector: selectorSchema,
    maxResults: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_TYPESCRIPT_AST_QUERY_RESULTS,
      }),
    ),
  },
  { additionalProperties: false },
);
const editBase = {
  path: Type.String({ minLength: 1, maxLength: 500 }),
  expectedSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  selector: selectorSchema,
  nodeSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
};
const astEditPreviewSchema = Type.Object(
  {
    ...editBase,
    operation: Type.Union([
      Type.Literal("replace"),
      Type.Literal("remove"),
      Type.Literal("insert_before"),
      Type.Literal("insert_after"),
    ]),
    replacement: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: MAX_TYPESCRIPT_AST_REPLACEMENT_BYTES,
      }),
    ),
  },
  { additionalProperties: false },
);

export function createTypescriptAstTools(workspaceRoot: string) {
  const runner = new TypescriptAstRunner(workspaceRoot);
  const queryTool: AgentTool<typeof astQuerySchema, TypescriptAstQueryDetails> =
    {
      name: "ast_query",
      label: "AST query",
      description:
        "Query the real TypeScript AST of one current TypeScript or JavaScript workspace file with a bounded kind/name/ancestor selector. Source, names, signatures, and ranges are live-only evidence.",
      parameters: astQuerySchema,
      async execute(_toolCallId, input, signal) {
        const result = await runner.query({
          path: input.path,
          selector: input.selector,
          maxResults: input.maxResults ?? DEFAULT_TYPESCRIPT_AST_QUERY_RESULTS,
          ...(signal ? { signal } : {}),
        });
        return toolResult(result.details, [
          `TypeScript AST query: ${result.details.status}`,
          `Path: ${result.path}`,
          `Language: ${result.details.language}`,
          `File SHA-256: ${result.details.fileSha256}`,
          `Matches: ${result.details.matchedNodeCount}`,
          `Returned: ${result.details.returnedNodeCount}`,
          `Omitted: ${result.details.omittedNodeCount}`,
          `Complete: ${String(result.details.complete)}`,
          `TypeScript: ${result.details.typescriptVersion}`,
          "",
          "NODES (untrusted live source evidence)",
          ...(result.nodes.length > 0
            ? result.nodes.map((node, index) =>
                [
                  `${index + 1}. ${node.kind}`,
                  node.name ? `name=${node.name}` : "",
                  `range=${node.startLine}:${node.startCharacter}-${node.endLine}:${node.endCharacter}`,
                  `depth=${node.depth}`,
                  node.parentKind
                    ? `parent=${node.parentKind}${node.parentName ? `:${node.parentName}` : ""}`
                    : "",
                  `nodeSha256=${node.nodeSha256}`,
                  `textSha256=${node.textSha256}`,
                  `signature=${node.signaturePreview}`,
                ]
                  .filter(Boolean)
                  .join(" "),
              )
            : ["(none)"]),
        ]);
      },
    };
  const editTool: AgentTool<
    typeof astEditPreviewSchema,
    TypescriptAstEditPreviewDetails
  > = {
    name: "ast_edit_preview",
    label: "AST edit preview",
    description:
      "Preview one AST-bound replace/remove/insert_before/insert_after without writing. Requires current file SHA-256 + node SHA-256 from ast_query; remove forbids replacement, other operations require it. Reparses the complete result, rejects comment-trivia reassociation, and returns one unique exact patch for apply_patch.",
    parameters: astEditPreviewSchema,
    async execute(_toolCallId, input, signal) {
      const result = await runner.previewEdit({
        path: input.path,
        expectedSha256: input.expectedSha256,
        selector: input.selector,
        nodeSha256: input.nodeSha256,
        operation: input.operation,
        ...("replacement" in input ? { replacement: input.replacement } : {}),
        ...(signal ? { signal } : {}),
      });
      return toolResult(result.details, [
        `TypeScript AST edit preview: ${result.details.operation}`,
        `Path: ${result.path}`,
        `Language: ${result.details.language}`,
        `Target kind: ${result.target.kind}`,
        `Target name: ${result.target.name ?? "(unnamed)"}`,
        `Target node SHA-256: ${result.target.nodeSha256}`,
        `Before file SHA-256: ${result.details.fileSha256}`,
        `After file SHA-256: ${result.details.afterFileSha256}`,
        `Application context expanded: ${String(
          result.details.applicationContextExpanded,
        )}`,
        "",
        "APPLY WITH apply_patch operation=replace",
        `expectedSha256=${result.details.fileSha256}`,
        "",
        "OLD TEXT (untrusted live source evidence)",
        result.applicationOldText,
        "",
        "NEW TEXT (untrusted live replacement preview)",
        result.applicationNewText,
        "",
        "No file changed. Pass the exact OLD/NEW text above to one hash-bound apply_patch call, then run diagnostics and relevant verification.",
      ]);
    },
  };
  return [queryTool, editTool];
}

export function typescriptAstToolCallArgumentsLedgerProjection(
  toolName: string,
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const selector = record(value["selector"]) ? value["selector"] : {};
  const pathValue = typeof value["path"] === "string" ? value["path"] : "";
  const replacement =
    typeof value["replacement"] === "string" ? value["replacement"] : "";
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    action: toolName === "ast_query" ? "query" : "edit_preview",
    pathSha256: sha256(pathValue),
    selectorKind:
      typeof selector["kind"] === "string" ? selector["kind"] : "unknown",
    selectorNameSha256: sha256(
      typeof selector["name"] === "string" ? selector["name"] : "",
    ),
    ancestorKind:
      typeof selector["ancestorKind"] === "string"
        ? selector["ancestorKind"]
        : "none",
    ancestorNameSha256: sha256(
      typeof selector["ancestorName"] === "string"
        ? selector["ancestorName"]
        : "",
    ),
    ...(typeof value["expectedSha256"] === "string"
      ? { expectedSha256: value["expectedSha256"] }
      : {}),
    ...(typeof value["nodeSha256"] === "string"
      ? { nodeSha256: value["nodeSha256"] }
      : {}),
    ...(typeof value["operation"] === "string"
      ? { operation: value["operation"] }
      : {}),
    ...(toolName === "ast_query"
      ? {
          maxResults:
            typeof value["maxResults"] === "number"
              ? value["maxResults"]
              : DEFAULT_TYPESCRIPT_AST_QUERY_RESULTS,
        }
      : {
          replacementBytes: Buffer.byteLength(replacement, "utf8"),
          replacementSha256: sha256(replacement),
        }),
    inputSha256: typescriptAstCallSha256(toolName, args),
  };
}

export function typescriptAstToolInputLedgerProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: typescriptAstCallSha256(toolName, args),
    inputRedacted: true,
  };
}

export function typescriptAstToolOutputLedgerProjection(
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

function toolResult<
  T extends TypescriptAstQueryDetails | TypescriptAstEditPreviewDetails,
>(details: T, lines: string[]) {
  const text = lines.join("\n");
  if (Buffer.byteLength(text, "utf8") > MAX_TYPESCRIPT_AST_TOOL_OUTPUT_BYTES) {
    throw new Error(
      `TypeScript AST tool output exceeds ${MAX_TYPESCRIPT_AST_TOOL_OUTPUT_BYTES} UTF-8 bytes`,
    );
  }
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function typescriptAstCallSha256(toolName: string, args: unknown): string {
  return sha256(canonicalJson({ toolName, args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

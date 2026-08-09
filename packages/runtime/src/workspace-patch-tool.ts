import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  JsonValue,
  WorkspacePatchDiagnosticsDetails,
  WriteLinkedTestVerificationDetails,
} from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  WorkspacePatchInput,
  WorkspacePatchResult,
} from "./workspace-patch-model.js";

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_PATCH_EDITS = 32;
const SHA256_PATTERN = "^[a-f0-9]{64}$";
const SHA256_PATTERN_RE = /^[a-f0-9]{64}$/u;

const applyPatchVariants = Type.Union([
  Type.Object(
    {
      operation: Type.Literal("create"),
      path: Type.String({
        minLength: 1,
      }),
      expectedSha256: Type.Null(),
      content: Type.String({
        maxLength: MAX_PATCH_BYTES,
      }),
      createParentDirectories: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("replace"),
      path: Type.String({
        minLength: 1,
      }),
      expectedSha256: Type.String({
        pattern: SHA256_PATTERN,
      }),
      edits: Type.Array(
        Type.Object(
          {
            oldText: Type.String({
              minLength: 1,
              maxLength: MAX_PATCH_BYTES,
            }),
            newText: Type.String({
              maxLength: MAX_PATCH_BYTES,
            }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: MAX_PATCH_EDITS },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("hashline_replace"),
      path: Type.String({
        minLength: 1,
      }),
      expectedSha256: Type.String({
        pattern: SHA256_PATTERN,
      }),
      edits: Type.Array(
        Type.Object(
          {
            line: Type.Optional(
              Type.Integer({
                minimum: 1,
              }),
            ),
            anchorSha256: Type.String({
              pattern: SHA256_PATTERN,
            }),
            newText: Type.String({
              maxLength: MAX_PATCH_BYTES,
            }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: MAX_PATCH_EDITS },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("hashrange_replace"),
      path: Type.String({
        minLength: 1,
      }),
      expectedSha256: Type.String({
        pattern: SHA256_PATTERN,
      }),
      edits: Type.Array(
        Type.Object(
          {
            startLine: Type.Integer({
              minimum: 1,
            }),
            endLine: Type.Integer({
              minimum: 1,
            }),
            rangeSha256: Type.String({
              pattern: SHA256_PATTERN,
            }),
            newText: Type.String({
              maxLength: MAX_PATCH_BYTES,
            }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: MAX_PATCH_EDITS },
      ),
    },
    { additionalProperties: false },
  ),
]);
const applyPatchSchema = Type.Unsafe<WorkspacePatchInput>({
  type: "object",
  anyOf: applyPatchVariants.anyOf,
});

export interface WorkspacePatchObservationState {
  fileSha256: string;
  opaque: unknown;
}

export interface WorkspacePatchObservation {
  summary: string;
  details?: WorkspacePatchDiagnosticsDetails;
  tests?: WriteLinkedTestVerificationDetails;
}

export interface WorkspacePatchObserver {
  supports(path: string): boolean;
  observeBefore(input: {
    path: string;
    expectedSha256: string;
    signal?: AbortSignal;
  }): Promise<WorkspacePatchObservationState>;
  observeAfter(input: {
    path: string;
    expectedSha256: string;
    before?: WorkspacePatchObservationState;
    signal?: AbortSignal;
  }): Promise<WorkspacePatchObservation>;
}

export interface WorkspacePatchToolDetails extends Omit<
  WorkspacePatchResult,
  "path"
> {
  kind: "napier.workspace-patch";
  schemaVersion: 1;
  diagnostics?: WorkspacePatchDiagnosticsDetails;
  tests?: WriteLinkedTestVerificationDetails;
  resultSha256: string;
}

export interface WorkspacePatchToolOptions {
  workspaceRoot: string;
  dataRoot: string;
  beforeWrite?: (() => Promise<void>) | undefined;
  applyPatch(
    workspaceRoot: string,
    dataRoot: string,
    input: WorkspacePatchInput,
  ): Promise<WorkspacePatchResult>;
  observer?: WorkspacePatchObserver;
}

export function createWorkspacePatchTool(
  options: WorkspacePatchToolOptions,
): AgentTool<typeof applyPatchSchema, WorkspacePatchToolDetails> {
  return {
    name: "apply_patch",
    label: "Apply patch",
    description:
      "Atomically create/edit one workspace-relative UTF-8 file. create requires expectedSha256=null, full content, and optional parent directories. Existing-file operations require complete expectedSha256 from read_file/read_symbol: replace uses oldText that occurs once; hashline_replace uses optional 1-based line + anchorSha256; hashrange_replace uses inclusive lines + rangeSha256. newText may expand content; empty newText deletes the match/range. Enabled LSP diagnostics run before/after supported writes; verification selects bounded reverse-dependent tests.",
    parameters: applyPatchSchema,
    async execute(_toolCallId, rawInput, signal) {
      const input = rawInput as WorkspacePatchInput;
      if (signal?.aborted) {
        throw new Error("Workspace patch was aborted before session cleanup");
      }
      await options.beforeWrite?.();
      const observed = options.observer?.supports(input.path) === true;
      let before: WorkspacePatchObservationState | undefined;
      if (observed && input.operation !== "create") {
        before = await options.observer!.observeBefore({
          path: input.path,
          expectedSha256: input.expectedSha256,
          ...(signal ? { signal } : {}),
        });
        if (before.fileSha256 !== input.expectedSha256) {
          throw new Error(
            "Pre-write diagnostics do not match the patch SHA-256 precondition",
          );
        }
      }
      if (signal?.aborted) {
        throw new Error("Workspace patch was aborted before commit");
      }

      const result = await options.applyPatch(
        options.workspaceRoot,
        options.dataRoot,
        input,
      );
      let observation: WorkspacePatchObservation | undefined;
      if (observed) {
        const observationStartedAt = Date.now();
        try {
          observation = await options.observer!.observeAfter({
            path: result.path,
            expectedSha256: result.afterSha256,
            ...(before ? { before } : {}),
            ...(signal ? { signal } : {}),
          });
        } catch (error) {
          observation = unavailableWorkspacePatchObservation(
            result.afterSha256,
            error,
            Math.max(0, Date.now() - observationStartedAt),
          );
        }
      }

      const details = workspacePatchToolDetails(
        result,
        observation?.details,
        observation?.tests,
      );
      return {
        content: [
          {
            type: "text",
            text: [
              `${result.operation === "create" ? "Created" : "Updated"} ${result.path} atomically.`,
              `Before SHA-256: ${result.beforeSha256 ?? "absent"}`,
              `After SHA-256: ${result.afterSha256}`,
              `Bytes: ${result.beforeBytes} -> ${result.afterBytes}`,
              `Edits: ${result.editCount}`,
              ...(result.createdParentDirectoryCount !== undefined &&
              result.createdParentDirectorySetSha256
                ? [
                    `Created parent directories: ${result.createdParentDirectoryCount}`,
                    `Created parent directory set SHA-256: ${result.createdParentDirectorySetSha256}`,
                  ]
                : []),
              ...(observation ? ["", observation.summary] : []),
            ].join("\n"),
          },
        ],
        details,
      };
    },
  };
}

export function workspacePatchToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const operation = patchOperation(value["operation"]) ?? "unknown";
  const target = typeof value["path"] === "string" ? value["path"] : "";
  const expectedSha256 =
    typeof value["expectedSha256"] === "string" &&
    SHA256_PATTERN_RE.test(value["expectedSha256"])
      ? value["expectedSha256"]
      : undefined;
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    operation,
    pathSha256: sha256(target),
    ...(expectedSha256 ? { expectedSha256 } : {}),
    editCount: Array.isArray(value["edits"]) ? value["edits"].length : 0,
    ...(value["createParentDirectories"] === true
      ? { createParentDirectories: true }
      : {}),
    inputSha256: workspacePatchCallSha256(args),
  };
}

export function workspacePatchToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: workspacePatchCallSha256(args),
    inputRedacted: true,
  };
}

export function workspacePatchToolOutputLedgerProjection(
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

function workspacePatchToolDetails(
  result: WorkspacePatchResult,
  diagnostics?: WorkspacePatchDiagnosticsDetails,
  tests?: WriteLinkedTestVerificationDetails,
): WorkspacePatchToolDetails {
  const base = {
    kind: "napier.workspace-patch" as const,
    schemaVersion: 1 as const,
    pathSha256: result.pathSha256,
    operation: result.operation,
    beforeSha256: result.beforeSha256,
    afterSha256: result.afterSha256,
    beforeBytes: result.beforeBytes,
    afterBytes: result.afterBytes,
    editCount: result.editCount,
    ...(result.createdParentDirectoryCount !== undefined
      ? {
          createdParentDirectoryCount: result.createdParentDirectoryCount,
        }
      : {}),
    ...(result.createdParentDirectorySetSha256
      ? {
          createdParentDirectorySetSha256:
            result.createdParentDirectorySetSha256,
        }
      : {}),
    ...(diagnostics ? { diagnostics } : {}),
    ...(tests ? { tests } : {}),
  };
  return {
    ...base,
    resultSha256: sha256(canonicalJson(base)),
  };
}

export function unavailableWorkspacePatchObservation(
  expectedFileSha256: string,
  error: unknown,
  durationMs: number,
): WorkspacePatchObservation {
  const message = safeErrorMessage(error);
  const base = {
    kind: "napier.workspace-patch-diagnostics" as const,
    schemaVersion: 1 as const,
    status: "unavailable" as const,
    expectedFileSha256,
    errorSha256: sha256(message),
    durationMs,
  };
  return {
    summary: [
      "Patch diagnostics: unavailable",
      "The patch committed, but post-write diagnostics failed.",
      `Diagnostic failure SHA-256: ${base.errorSha256}`,
      "Verify the current file before another write.",
    ].join("\n"),
    details: {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    },
  };
}

function workspacePatchCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "apply_patch", args }));
}

function patchOperation(
  value: unknown,
): WorkspacePatchInput["operation"] | undefined {
  return value === "create" ||
    value === "replace" ||
    value === "hashline_replace" ||
    value === "hashrange_replace"
    ? value
    : undefined;
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN_RE.test(value);
}

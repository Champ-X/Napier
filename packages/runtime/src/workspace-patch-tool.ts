import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { recordWorkspacePatchPreparation } from "./workspace-patch-preparation.js";
import type { PatchPreparationJournal } from "./workspace-patch-preparation.js";
import {
  applyPatchSchema,
  parseWorkspacePatchInput,
} from "./workspace-patch-input.js";

import { canonicalJson, sha256 } from "./ed25519.js";
import { WorkspacePatchRecoveryCapsules } from "./workspace-patch-recovery-capsule.js";
import { formatWorkspacePatchResult } from "./workspace-patch-result.js";
import { WorkspacePatchResultCapsules } from "./workspace-patch-result-capsule.js";
import type {
  WorkspacePatchInput,
  WorkspacePatchResult,
  WorkspacePatchObservationState,
  WorkspacePatchObservation,
  WorkspacePatchObserver,
  WorkspacePatchToolDetails,
  PrepareWorkspacePatch,
  RecordWorkspacePatchPreparation,
} from "./workspace-patch-model.js";
export type {
  WorkspacePatchObservationState,
  WorkspacePatchObservation,
  WorkspacePatchObserver,
  WorkspacePatchToolDetails,
} from "./workspace-patch-model.js";
import {
  defineToolProgress,
  progressSemantics,
  recordValue,
  resultDetails,
} from "./tool-progress-semantics.js";

const SHA256_PATTERN_RE = /^[a-f0-9]{64}$/u;

export interface WorkspacePatchToolOptions {
  workspaceRoot: string;
  dataRoot: string;
  beforeWrite?: (() => Promise<void>) | undefined;
  applyPatch(
    workspaceRoot: string,
    dataRoot: string,
    input: WorkspacePatchInput,
    prepare?: PrepareWorkspacePatch,
  ): Promise<WorkspacePatchResult>;
  recordPreparation?: RecordWorkspacePatchPreparation | undefined;
  patchJournal?:
    | {
        store: PatchPreparationJournal;
        threadId: string;
        runId: string;
      }
    | undefined;
  observer?: WorkspacePatchObserver;
}

export interface CreateWorkspaceToolsOptions {
  includeWriteTools?: boolean;
  dataRoot?: string;
  patchObserver?: WorkspacePatchObserver;
  beforeWorkspaceWrite?: (() => Promise<void>) | undefined;
  patchJournal?: WorkspacePatchToolOptions["patchJournal"];
  authorizePatch?:
    | ((path: string, beforeSha256: string | null) => Promise<void>)
    | undefined;
}

export function createWorkspacePatchTool(
  options: WorkspacePatchToolOptions,
): AgentTool<typeof applyPatchSchema, WorkspacePatchToolDetails> {
  const recoveryCapsules = new WorkspacePatchRecoveryCapsules(options.dataRoot);
  const resultCapsules = new WorkspacePatchResultCapsules(options.dataRoot);
  const recordPreparation =
    options.recordPreparation ??
    (options.patchJournal
      ? recordWorkspacePatchPreparation(
          options.patchJournal.store,
          options.patchJournal.threadId,
          options.patchJournal.runId,
        )
      : undefined);
  const tool: AgentTool<typeof applyPatchSchema, WorkspacePatchToolDetails> = {
    name: "apply_patch",
    label: "Apply patch",
    description:
      "Atomically create/edit one workspace-relative UTF-8 file. create requires expectedSha256=null, root content, and optional parent directories. Existing-file operations require expectedSha256 and edits[] entries: replace {oldText,newText}; hashline_replace {line?,anchorSha256,newText}; hashrange_replace {startLine,endLine,rangeSha256,newText}. Never put edit content or anchors at the root. An empty newText deletes the match/range. Enabled LSP diagnostics run before/after supported writes; verification selects bounded reverse-dependent tests.",
    parameters: applyPatchSchema,
    async execute(toolCallId, rawInput, signal) {
      const input = parseWorkspacePatchInput(rawInput);
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
        recordPreparation
          ? (result, identity) =>
              recordPreparation(toolCallId, rawInput, result, identity)
          : undefined,
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

      const response = formatWorkspacePatchResult(
        result,
        observation,
        await recoveryCapsules
          .put(options.workspaceRoot, toolCallId, rawInput, result)
          .catch(() => undefined),
      );
      await resultCapsules.put(toolCallId, response).catch(() => undefined);
      return response;
    },
  };
  return defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      {
        modeId: "patch_workspace",
        operation: "mutate",
        scope: "workspace",
        contribution: "product",
      },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("mutate", "workspace", "product"),
      resourceKey: {
        kind: "workspace-path",
        path: recordValue(input)["path"],
      },
    }),
    state: (_input, result) => resultDetails(result)["afterSha256"],
  });
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
  const afterSha256 =
    details && hash(details["afterSha256"])
      ? details["afterSha256"]
      : undefined;
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(resultSha256 ? { resultSha256 } : {}),
    ...(afterSha256 ? { afterSha256 } : {}),
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

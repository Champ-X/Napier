import type { Api, Model, Message } from "@earendil-works/pi-ai";
import type { EditFormatPreference } from "@napier/contracts/harness-experiments";
import type {
  EditDialect,
  EditDispatchPlan,
  EditIntent,
} from "@napier/contracts/tool-protocol";

import { canonicalJson, sha256 } from "./ed25519.js";
import { modelAdapterReceipt } from "./model-adapters.js";
import { matchedEditFormatPreference } from "./edit-format-preference.js";
import { inferModelHarnessTaskPhases } from "./model-harness-resolution.js";

const HASH = /^[a-f0-9]{64}$/u;

export function compileEditIntent(input: {
  model?: Pick<Model<Api>, "api" | "compat" | "maxTokens">;
  availableToolNames: readonly string[];
  intent: EditIntent;
}): EditDispatchPlan {
  const intent = normalizeEditIntent(input.intent);
  const available = new Set(input.availableToolNames);
  const dialect = selectEditDialect(intent, available);
  const dispatch = compileDispatch(intent, dialect);
  return Object.freeze({
    kind: "napier.edit-dispatch-plan" as const,
    schemaVersion: 1 as const,
    dialect,
    intent: structuredClone(intent),
    ...dispatch,
    intentSha256: sha256(canonicalJson(intent)),
  });
}

export function formatEditDialectGuidance(input: {
  model: Pick<Model<Api>, "api" | "compat" | "maxTokens"> &
    Partial<Pick<Model<Api>, "provider" | "id">>;
  availableToolNames: readonly string[];
  preferredContentDialect?: "unified_diff" | undefined;
  editPreference?: EditFormatPreference | undefined;
  messages?: readonly Message[];
}): string {
  const available = new Set(input.availableToolNames);
  const family = modelAdapterReceipt(input.model).family;
  const preferred = input.editPreference
    ? matchedEditFormatPreference(
        input.editPreference,
        input.model,
        inferModelHarnessTaskPhases(input.messages ?? []),
      )
    : input.preferredContentDialect;
  const content = available.has("apply_patch")
    ? (preferred ?? (family === "openai" ? "hashline" : "structured_patch"))
    : undefined;
  const filesystem =
    available.has("workspace_file_preview") &&
    available.has("workspace_file_apply")
      ? "preview_apply"
      : undefined;
  if (!content && !filesystem) return "";
  return [
    "<edit_dialect>",
    `Preferred content edit dialect: ${content ?? "unavailable"}.`,
    ...(input.editPreference && preferred && content
      ? [
          "Construct content edits in this preferred format when it represents the change. If unsupported for the operation or rejected, re-read and use another advertised format with fresh preconditions; do not repeat a stale edit.",
        ]
      : []),
    `Filesystem mutation dialect: ${filesystem ?? "unavailable"}.`,
    "All edits normalize to one EditIntent and still require the advertised Policy, Workspace Boundary, Receipt, and Ledger path.",
    "</edit_dialect>",
  ].join("\n");
}

function selectEditDialect(
  intent: EditIntent,
  available: ReadonlySet<string>,
): EditDialect {
  if (intent.kind === "filesystem") {
    if (
      available.has("workspace_file_preview") &&
      available.has("workspace_file_apply")
    ) {
      return "preview_apply";
    }
    throw new Error(
      "Edit Intent requires the preview/apply workspace boundary",
    );
  }
  if (!available.has("apply_patch")) {
    throw new Error("Edit Intent requires the governed apply_patch capability");
  }
  if (intent.hashlineReplacements) return "hashline";
  // A preferred model format is guidance, not a conversion. An exact edit
  // cannot acquire read-derived anchors merely by selecting another dialect.
  return "structured_patch";
}

function compileDispatch(
  intent: EditIntent,
  dialect: EditDialect,
): Pick<EditDispatchPlan, "toolId" | "input" | "continuationToolId"> {
  if (intent.kind === "filesystem") {
    return {
      toolId: "workspace_file_preview",
      input: { action: "preview", ...intent },
      continuationToolId: "workspace_file_apply",
    };
  }
  if (intent.create) {
    return {
      toolId: "apply_patch",
      input: {
        operation: "create",
        path: intent.target,
        expectedSha256: null,
        content: intent.create.content,
        ...(intent.create.createParentDirectories
          ? { createParentDirectories: true }
          : {}),
      },
    };
  }
  const hashline = intent.hashlineReplacements;
  if (dialect === "hashline" && !hashline) {
    throw new Error("Hashline edit dialect requires hashline replacements");
  }
  return {
    toolId: "apply_patch",
    input: {
      operation: hashline ? "hashline_replace" : "replace",
      path: intent.target,
      expectedSha256: intent.expectedSha256,
      edits: hashline ?? intent.replacements,
    },
  };
}

export function normalizeEditIntent(value: EditIntent): EditIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (value.kind === "content") return normalizeContentIntent(value);
  if (value.kind === "filesystem") return normalizeFilesystemIntent(value);
  return invalid();
}

function normalizeContentIntent(
  value: Extract<EditIntent, { kind: "content" }>,
): EditIntent {
  if (!validPath(value.target)) invalid();
  if (value.expectedSha256 !== null && !HASH.test(value.expectedSha256))
    invalid();
  const modes = [
    value.create,
    value.replacements,
    value.hashlineReplacements,
  ].filter((candidate) => candidate !== undefined);
  if (modes.length !== 1 || (value.create && value.expectedSha256 !== null))
    invalid();
  if (
    value.replacements &&
    (value.expectedSha256 === null || !value.replacements.length)
  )
    invalid();
  if (
    value.hashlineReplacements &&
    (value.expectedSha256 === null || !value.hashlineReplacements.length)
  )
    invalid();
  return structuredClone(value);
}

function normalizeFilesystemIntent(
  value: Extract<EditIntent, { kind: "filesystem" }>,
): EditIntent {
  const fields = [
    value.path,
    value.sourcePath,
    value.destinationPath,
    value.trashId,
  ].filter((candidate) => candidate !== undefined);
  if (
    (value.operation === "create_directory" &&
      (!value.path || fields.length !== 1)) ||
    (value.operation === "move" &&
      (!value.sourcePath || !value.destinationPath || fields.length !== 2)) ||
    (value.operation === "trash" && (!value.path || fields.length !== 1)) ||
    (value.operation === "restore" && (!value.trashId || fields.length !== 1))
  )
    invalid();
  if (fields.some((field) => !validPath(field!))) invalid();
  return structuredClone(value);
}

function validPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 500 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function invalid(): never {
  throw new Error("Edit Intent is invalid");
}

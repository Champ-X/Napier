import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { WorkspacePatchInputError } from "./workspace-patch-input-error.js";
import type { WorkspacePatchInput } from "./workspace-patch-model.js";

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_PATCH_EDITS = 32;
const SHA256_PATTERN = "^[a-f0-9]{64}$";

export const applyPatchSchema = Type.Object(
  {
    operation: Type.Union([
      Type.Literal("create"),
      Type.Literal("replace"),
      Type.Literal("hashline_replace"),
      Type.Literal("hashrange_replace"),
    ]),
    path: Type.String({ minLength: 1 }),
    expectedSha256: Type.Union([
      Type.Null(),
      Type.String({ pattern: SHA256_PATTERN }),
    ]),
    content: Type.Optional(Type.String({ maxLength: MAX_PATCH_BYTES })),
    createParentDirectories: Type.Optional(Type.Boolean()),
    edits: Type.Optional(
      Type.Array(
        Type.Object(
          {
            oldText: Type.Optional(
              Type.String({ minLength: 1, maxLength: MAX_PATCH_BYTES }),
            ),
            line: Type.Optional(Type.Integer({ minimum: 1 })),
            startLine: Type.Optional(Type.Integer({ minimum: 1 })),
            endLine: Type.Optional(Type.Integer({ minimum: 1 })),
            anchorSha256: Type.Optional(
              Type.String({ pattern: SHA256_PATTERN }),
            ),
            rangeSha256: Type.Optional(
              Type.String({ pattern: SHA256_PATTERN }),
            ),
            newText: Type.String({ maxLength: MAX_PATCH_BYTES }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: MAX_PATCH_EDITS },
      ),
    ),
  },
  { additionalProperties: false },
);

export function parseWorkspacePatchInput(
  value: Static<typeof applyPatchSchema>,
): WorkspacePatchInput {
  if (value.operation === "create") {
    if (
      value.expectedSha256 !== null ||
      value.content === undefined ||
      value.edits !== undefined
    ) {
      invalidPatchFields(value.operation);
    }
    return {
      operation: value.operation,
      path: value.path,
      expectedSha256: null,
      content: value.content,
      ...(value.createParentDirectories !== undefined
        ? { createParentDirectories: value.createParentDirectories }
        : {}),
    };
  }
  if (
    typeof value.expectedSha256 !== "string" ||
    value.content !== undefined ||
    value.createParentDirectories !== undefined ||
    value.edits === undefined
  ) {
    invalidPatchFields(value.operation);
  }
  if (value.operation === "replace") {
    return {
      operation: value.operation,
      path: value.path,
      expectedSha256: value.expectedSha256,
      edits: value.edits.map((edit) => {
        if (
          edit.oldText === undefined ||
          edit.line !== undefined ||
          edit.startLine !== undefined ||
          edit.endLine !== undefined ||
          edit.anchorSha256 !== undefined ||
          edit.rangeSha256 !== undefined
        ) {
          invalidPatchFields(value.operation);
        }
        return { oldText: edit.oldText, newText: edit.newText };
      }),
    };
  }
  if (value.operation === "hashline_replace") {
    return {
      operation: value.operation,
      path: value.path,
      expectedSha256: value.expectedSha256,
      edits: value.edits.map((edit) => {
        if (
          edit.oldText !== undefined ||
          edit.startLine !== undefined ||
          edit.endLine !== undefined ||
          edit.anchorSha256 === undefined ||
          edit.rangeSha256 !== undefined
        ) {
          invalidPatchFields(value.operation);
        }
        return {
          ...(edit.line !== undefined ? { line: edit.line } : {}),
          anchorSha256: edit.anchorSha256,
          newText: edit.newText,
        };
      }),
    };
  }
  return {
    operation: value.operation,
    path: value.path,
    expectedSha256: value.expectedSha256,
    edits: value.edits.map((edit) => {
      if (
        edit.oldText !== undefined ||
        edit.line !== undefined ||
        edit.startLine === undefined ||
        edit.endLine === undefined ||
        edit.anchorSha256 !== undefined ||
        edit.rangeSha256 === undefined
      ) {
        invalidPatchFields(value.operation);
      }
      return {
        startLine: edit.startLine,
        endLine: edit.endLine,
        rangeSha256: edit.rangeSha256,
        newText: edit.newText,
      };
    }),
  };
}

function invalidPatchFields(
  operation: WorkspacePatchInput["operation"],
): never {
  throw new WorkspacePatchInputError(operation);
}

export function validateWorkspacePatchInput(
  value: unknown,
): WorkspacePatchInput {
  if (!Value.Check(applyPatchSchema, value))
    throw new WorkspacePatchInputError(
      "unknown" as WorkspacePatchInput["operation"],
    );
  return parseWorkspacePatchInput(value as Static<typeof applyPatchSchema>);
}

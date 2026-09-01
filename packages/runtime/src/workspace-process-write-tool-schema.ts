import { Type } from "typebox";

import {
  MAX_COMMAND_TIMEOUT_MS,
  MIN_COMMAND_TIMEOUT_MS,
} from "./command-execution.js";
import { MAX_WORKSPACE_PROCESS_WRITE_SCOPES } from "./workspace-process-write-preview.js";
import {
  MAX_TERMINAL_COLUMNS,
  MAX_TERMINAL_ROWS,
  MIN_TERMINAL_COLUMNS,
  MIN_TERMINAL_ROWS,
} from "./sandbox-terminal.js";

const argument = Type.String({
  maxLength: 2_048,
  pattern: "^[^\\u0000-\\u001f\\u007f]*$",
});
const cwd = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: 500,
    pattern: "^[^\\u0000-\\u001f\\u007f]*$",
  }),
);
const timeoutMs = Type.Optional(
  Type.Integer({
    minimum: MIN_COMMAND_TIMEOUT_MS,
    maximum: MAX_COMMAND_TIMEOUT_MS,
  }),
);
const writePaths = Type.Array(
  Type.String({
    minLength: 1,
    maxLength: 500,
    pattern: "^[^\\u0000-\\u001f\\u007f]*$",
  }),
  { minItems: 1, maxItems: MAX_WORKSPACE_PROCESS_WRITE_SCOPES },
);
const failureRecovery = Type.Optional(Type.Literal("restore_scopes"));

export const workspaceProcessWriteActionSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("preview_write"),
      runtime: Type.Union([Type.Literal("node"), Type.Literal("shell")]),
      args: Type.Array(argument, { maxItems: 64 }),
      cwd,
      timeoutMs,
      writePaths,
      failureRecovery,
      interactive: Type.Optional(Type.Boolean()),
      terminal: Type.Optional(
        Type.Object(
          {
            columns: Type.Integer({
              minimum: MIN_TERMINAL_COLUMNS,
              maximum: MAX_TERMINAL_COLUMNS,
            }),
            rows: Type.Integer({
              minimum: MIN_TERMINAL_ROWS,
              maximum: MAX_TERMINAL_ROWS,
            }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("start_write"),
      previewId: Type.String({
        pattern: "^processpreview_[a-z0-9]{8,80}$",
      }),
    },
    { additionalProperties: false },
  ),
]);

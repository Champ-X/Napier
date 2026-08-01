import type {
  WorkspaceProcessResizeReceipt,
  WorkspaceProcessSession,
} from "@napier/contracts";

import type { PreparedCommandExecution } from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import { type SandboxedProcess, type SandboxLaunchRequest } from "./sandbox.js";
import {
  MAX_TERMINAL_COLUMNS,
  MAX_TERMINAL_ROWS,
  MIN_TERMINAL_COLUMNS,
  MIN_TERMINAL_ROWS,
} from "./sandbox-terminal.js";
import { createWorkspaceProcessSession } from "./workspace-process-events.js";
import { createWorkspaceProcessResizeReceipt } from "./workspace-process-resize-events.js";

export const MAX_WORKSPACE_PROCESS_RESIZES = 64;
export const WORKSPACE_PROCESS_TERMINAL_TYPE = "xterm-256color";

export interface WorkspaceProcessTerminalSize {
  columns: number;
  rows: number;
}

export interface BoundWorkspaceProcessIo {
  launch: SandboxLaunchRequest;
  commandSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  session: Pick<
    WorkspaceProcessSession,
    | "ioMode"
    | "stdinMode"
    | "stdinOpen"
    | "terminalType"
    | "terminalColumns"
    | "terminalRows"
    | "terminalResizeCount"
  >;
}

export function bindWorkspaceProcessIo(
  prepared: PreparedCommandExecution,
  terminal?: WorkspaceProcessTerminalSize,
): BoundWorkspaceProcessIo {
  validateWorkspaceProcessTerminalSize(terminal);
  const terminalBinding = terminal
    ? {
        terminalType: WORKSPACE_PROCESS_TERMINAL_TYPE,
        columns: terminal.columns,
        rows: terminal.rows,
      }
    : undefined;
  const environment = terminal
    ? {
        ...prepared.launch.env,
        TERM: WORKSPACE_PROCESS_TERMINAL_TYPE,
      }
    : prepared.launch.env;
  return {
    launch: terminal
      ? {
          ...prepared.launch,
          env: environment,
          terminal,
        }
      : prepared.launch,
    commandSha256: sha256(
      canonicalJson({
        command: prepared.receipt,
        terminal: terminalBinding ?? null,
      }),
    ),
    environmentSha256: terminal
      ? sha256(canonicalJson(environment))
      : prepared.receipt.environmentSha256,
    resourceLimitsSha256: terminal
      ? sha256(
          canonicalJson({
            commandResourceLimitsSha256: prepared.receipt.resourceLimitsSha256,
            terminal: terminalBinding,
          }),
        )
      : prepared.receipt.resourceLimitsSha256,
    session: terminal
      ? {
          ioMode: "pty",
          stdinMode: "interactive",
          stdinOpen: true,
          terminalType: WORKSPACE_PROCESS_TERMINAL_TYPE,
          terminalColumns: terminal.columns,
          terminalRows: terminal.rows,
          terminalResizeCount: 0,
        }
      : {
          ioMode: "pipe",
          stdinMode: "closed",
          stdinOpen: false,
        },
  };
}

export async function resizeWorkspaceProcessTerminal(input: {
  session: WorkspaceProcessSession;
  child: SandboxedProcess;
  columns: number;
  rows: number;
  initiatedBy: WorkspaceProcessResizeReceipt["initiatedBy"];
}): Promise<{
  session: WorkspaceProcessSession;
  receipt: WorkspaceProcessResizeReceipt;
}> {
  validateWorkspaceProcessTerminalSize({
    columns: input.columns,
    rows: input.rows,
  });
  if (
    input.session.status !== "running" ||
    input.session.schemaVersion < 4 ||
    input.session.ioMode !== "pty" ||
    !input.child.resize
  ) {
    throw new Error("Workspace Process Session is not a resizable PTY");
  }
  const sequence = (input.session.terminalResizeCount ?? 0) + 1;
  if (sequence > MAX_WORKSPACE_PROCESS_RESIZES) {
    throw new Error("Workspace Process exceeds its resize-count limit");
  }
  await input.child.resize(input.columns, input.rows);
  const {
    kind: _kind,
    schemaVersion: _schemaVersion,
    outputAvailable: _outputAvailable,
    workspaceDeltaAvailable: _workspaceDeltaAvailable,
    contentSha256: _contentSha256,
    ...sessionInput
  } = input.session;
  const session = createWorkspaceProcessSession({
    ...sessionInput,
    schemaVersion: input.session.schemaVersion,
    terminalColumns: input.columns,
    terminalRows: input.rows,
    terminalResizeCount: sequence,
  });
  return {
    session,
    receipt: createWorkspaceProcessResizeReceipt({
      id: createId("processresize"),
      threadId: session.threadId,
      runId: session.runId,
      processId: session.id,
      initiatedBy: input.initiatedBy,
      sequence,
      columns: input.columns,
      rows: input.rows,
      resizedAt: nowIso(),
      sessionSha256: session.contentSha256,
    }),
  };
}

export function validateWorkspaceProcessTerminalSize(
  terminal: WorkspaceProcessTerminalSize | undefined,
): void {
  if (!terminal) return;
  if (
    !Number.isSafeInteger(terminal.columns) ||
    terminal.columns < MIN_TERMINAL_COLUMNS ||
    terminal.columns > MAX_TERMINAL_COLUMNS ||
    !Number.isSafeInteger(terminal.rows) ||
    terminal.rows < MIN_TERMINAL_ROWS ||
    terminal.rows > MAX_TERMINAL_ROWS
  ) {
    throw new Error(
      `Workspace Process terminal size must be ${MIN_TERMINAL_COLUMNS}-${MAX_TERMINAL_COLUMNS} columns by ${MIN_TERMINAL_ROWS}-${MAX_TERMINAL_ROWS} rows`,
    );
  }
}

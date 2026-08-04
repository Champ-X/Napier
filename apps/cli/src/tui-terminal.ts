import type { Writable } from "node:stream";

import { writeText } from "./cli-output.js";
import { INTERACTIVE_COMMAND_HELP } from "./interactive-command-model.js";
import {
  terminalSafeSingleLine,
  terminalSafeText,
  terminalTextWidth,
  truncateTerminalText,
} from "./terminal-safe-text.js";
import type { TuiInputSnapshot } from "./tui-input.js";
import type { TuiStateSnapshot, TuiToolCard } from "./tui-state.js";

const ALT_SCREEN_ENTER = "\u001b[?1049h";
const ALT_SCREEN_EXIT = "\u001b[?1049l";
const CURSOR_HIDE = "\u001b[?25l";
const CURSOR_SHOW = "\u001b[?25h";
const PASTE_ENABLE = "\u001b[?2004h";
const PASTE_DISABLE = "\u001b[?2004l";
const CLEAR_FRAME = "\u001b[H\u001b[2J";
const STYLE_RESET = "\u001b[0m";
const STYLE_HEADER = "\u001b[1;38;5;81m";
const STYLE_DIM = "\u001b[38;5;244m";
const STYLE_USER = "\u001b[1;38;5;220m";
const STYLE_ASSISTANT = "\u001b[1;38;5;114m";
const STYLE_SYSTEM = "\u001b[1;38;5;117m";
const STYLE_RUNNING = "\u001b[38;5;214m";
const STYLE_SUCCESS = "\u001b[38;5;78m";
const STYLE_FAILED = "\u001b[38;5;203m";
const STYLE_INPUT = "\u001b[1;38;5;255m";
const STYLE_CURSOR = "\u001b[7m";
const MAX_RENDER_BYTES = 128 * 1024;
const MAX_WRAPPED_TRANSCRIPT_LINES = 2_000;
const MIN_COLUMNS = 20;
const MAX_COLUMNS = 400;
const MIN_ROWS = 5;
const MAX_ROWS = 200;

export class TuiOutputError extends Error {
  constructor(cause: unknown) {
    super("TUI output failed", { cause });
    this.name = "TuiOutputError";
  }
}

export interface TuiTerminalSize {
  columns: number;
  rows: number;
}

export class TuiTerminal {
  private entered = false;
  private restored = false;
  private rendering = false;
  private pendingFrame: string | undefined;
  private renderTail: Promise<void> = Promise.resolve();

  constructor(private readonly output: Writable) {}

  async enter(): Promise<void> {
    if (this.entered) return;
    this.entered = true;
    this.restored = false;
    try {
      await writeText(
        this.output,
        `${ALT_SCREEN_ENTER}${CURSOR_HIDE}${PASTE_ENABLE}${CLEAR_FRAME}`,
      );
    } catch (error) {
      throw new TuiOutputError(error);
    }
  }

  render(state: TuiStateSnapshot, input: TuiInputSnapshot): Promise<void> {
    this.pendingFrame = renderFrame(state, input, this.size());
    if (!this.rendering) {
      this.rendering = true;
      this.renderTail = this.flushFrames();
    }
    return this.renderTail;
  }

  private async flushFrames(): Promise<void> {
    try {
      while (this.pendingFrame !== undefined) {
        const frame = this.pendingFrame;
        this.pendingFrame = undefined;
        await writeText(this.output, frame);
      }
    } catch (error) {
      this.pendingFrame = undefined;
      throw new TuiOutputError(error);
    } finally {
      this.rendering = false;
    }
  }

  async restore(): Promise<void> {
    if (!this.entered || this.restored) return;
    this.restored = true;
    try {
      await this.renderTail.catch(() => undefined);
      await writeText(
        this.output,
        `${STYLE_RESET}${PASTE_DISABLE}${CURSOR_SHOW}${ALT_SCREEN_EXIT}`,
      );
    } catch (error) {
      throw new TuiOutputError(error);
    } finally {
      this.entered = false;
    }
  }

  size(): TuiTerminalSize {
    const terminal = this.output as Writable & {
      columns?: number;
      rows?: number;
    };
    return {
      columns: boundedDimension(terminal.columns, MIN_COLUMNS, MAX_COLUMNS, 80),
      rows: boundedDimension(terminal.rows, MIN_ROWS, MAX_ROWS, 24),
    };
  }
}

function renderFrame(
  state: TuiStateSnapshot,
  input: TuiInputSnapshot,
  size: TuiTerminalSize,
): string {
  const { columns, rows } = size;
  if (columns < 40 || rows < 10) {
    return boundedFrame(
      `${CLEAR_FRAME}${STYLE_HEADER}${truncateTerminalText("Napier TUI", columns)}${STYLE_RESET}\n${truncateTerminalText("Terminal too small; resize to at least 40x10 or Ctrl-C to exit.", columns)}`,
    );
  }
  const tools = state.tools.slice(-Math.min(4, Math.max(0, rows - 9)));
  const fixedRows = 6 + tools.length;
  const bodyRows = Math.max(1, rows - fixedRows);
  const lines = [
    headerLine(state, columns),
    statusLine(state, columns),
    divider(columns),
    ...transcriptLines(state, columns, bodyRows),
    ...toolLines(tools, columns),
    noticeLine(state, columns),
    inputLine(input, columns),
    footerLine(state, input, columns),
  ];
  return boundedFrame(
    `${CLEAR_FRAME}${lines.slice(0, rows).join("\n")}${STYLE_RESET}`,
  );
}

function headerLine(state: TuiStateSnapshot, columns: number): string {
  const title = state.threadId
    ? `Thread ${state.threadId}`
    : `New Thread${state.nextTitle ? ` · ${state.nextTitle}` : ""}`;
  const right = state.active
    ? (state.activeLabel ?? "running")
    : (state.lastRun?.status ?? "idle");
  return styledColumns("Napier TUI", title, right, columns, STYLE_HEADER);
}

function statusLine(state: TuiStateSnapshot, columns: number): string {
  const model = state.model
    ? `${state.model.provider}/${state.model.id}`
    : "agent default";
  const run = state.lastRun ? state.lastRun.id : "none";
  const capability = state.capabilities?.label ?? "custom";
  return `${STYLE_DIM}${truncateTerminalText(
    `model ${model} · preset ${capability} · last run ${run} · ${state.waiting ? "operator waiting" : state.active ? "active" : "ready"}`,
    columns,
  )}${STYLE_RESET}`;
}

function transcriptLines(
  state: TuiStateSnapshot,
  columns: number,
  bodyRows: number,
): string[] {
  if (state.helpVisible) {
    return fitBody(
      wrapText(INTERACTIVE_COMMAND_HELP, columns).map(
        (line) => `${STYLE_SYSTEM}${line}${STYLE_RESET}`,
      ),
      bodyRows,
      state.scrollOffset,
    );
  }
  const wrapped: string[] = [];
  for (const entry of state.transcript) {
    const label =
      entry.role === "user"
        ? "you"
        : entry.role === "assistant"
          ? "napier"
          : "system";
    const style =
      entry.role === "user"
        ? STYLE_USER
        : entry.role === "assistant"
          ? STYLE_ASSISTANT
          : STYLE_SYSTEM;
    const content = wrapText(entry.text, Math.max(1, columns - 10));
    for (const [index, line] of content.entries()) {
      const prefix =
        index === 0 ? `${label}${entry.streaming ? "…" : ""}: ` : " ".repeat(8);
      wrapped.push(
        `${style}${truncateTerminalText(`${prefix}${line}`, columns)}${STYLE_RESET}`,
      );
      if (wrapped.length >= MAX_WRAPPED_TRANSCRIPT_LINES) break;
    }
    if (wrapped.length >= MAX_WRAPPED_TRANSCRIPT_LINES) break;
  }
  if (wrapped.length === 0) {
    wrapped.push(
      `${STYLE_DIM}${truncateTerminalText(
        "Type a prompt or /help. All durable work remains in the Ledger.",
        columns,
      )}${STYLE_RESET}`,
    );
  }
  return fitBody(wrapped, bodyRows, state.scrollOffset);
}

function fitBody(
  lines: string[],
  bodyRows: number,
  scrollOffset: number,
): string[] {
  const end = Math.max(0, lines.length - scrollOffset);
  const start = Math.max(0, end - bodyRows);
  const visible = lines.slice(start, end);
  while (visible.length < bodyRows) visible.unshift("");
  return visible;
}

function toolLines(tools: TuiToolCard[], columns: number): string[] {
  return tools.map((tool) => {
    const style =
      tool.status === "completed"
        ? STYLE_SUCCESS
        : tool.status === "failed"
          ? STYLE_FAILED
          : STYLE_RUNNING;
    return `${style}${truncateTerminalText(
      `tool ${tool.toolName} · ${tool.status}${tool.effect ? ` · ${tool.effect}` : ""}`,
      columns,
    )}${STYLE_RESET}`;
  });
}

function noticeLine(state: TuiStateSnapshot, columns: number): string {
  const notice =
    state.notice ??
    (state.active
      ? "Run active; Ctrl-C cancels without closing the TUI"
      : "Ready");
  return `${STYLE_DIM}${truncateTerminalText(notice, columns)}${STYLE_RESET}`;
}

function inputLine(input: TuiInputSnapshot, columns: number): string {
  const characters = [...input.text];
  const before = terminalSafeSingleLine(
    characters.slice(0, input.cursor).join(""),
  );
  const after = terminalSafeSingleLine(characters.slice(input.cursor).join(""));
  const available = Math.max(1, columns - 4);
  const visible = cursorWindow(before, after, available);
  return `${STYLE_INPUT}> ${visible.before}${STYLE_CURSOR} ${STYLE_RESET}${STYLE_INPUT}${visible.after}${STYLE_RESET}`;
}

function footerLine(
  state: TuiStateSnapshot,
  input: TuiInputSnapshot,
  columns: number,
): string {
  return `${STYLE_DIM}${truncateTerminalText(
    [
      "Enter send",
      "Ctrl-C cancel/exit",
      "Ctrl-D exit",
      "PgUp/PgDn scroll",
      `${String(input.byteLength)}/${String(64 * 1024)}B`,
      ...(input.pasting ? ["pasting"] : []),
      ...(state.scrollOffset > 0
        ? [`scroll +${String(state.scrollOffset)}`]
        : []),
    ].join(" · "),
    columns,
  )}${STYLE_RESET}`;
}

function wrapText(value: string, columns: number): string[] {
  const result: string[] = [];
  for (const sourceLine of terminalSafeText(value).split("\n")) {
    if (!sourceLine) {
      result.push("");
      continue;
    }
    let current = "";
    let width = 0;
    for (const character of sourceLine) {
      const characterWidth = terminalTextWidth(character);
      if (width + characterWidth > columns && current) {
        result.push(current);
        current = "";
        width = 0;
      }
      current += character;
      width += characterWidth;
    }
    result.push(current);
  }
  return result;
}

function cursorWindow(
  before: string,
  after: string,
  columns: number,
): { before: string; after: string } {
  if (terminalTextWidth(before) + terminalTextWidth(after) <= columns) {
    return { before, after };
  }
  const beforeColumns = Math.floor(columns * 0.6);
  const visibleBefore = takeEnd(before, beforeColumns);
  const visibleAfter = takeStart(
    after,
    columns - terminalTextWidth(visibleBefore),
  );
  return {
    before: `${visibleBefore === before ? "" : "…"}${visibleBefore}`,
    after: `${visibleAfter}${visibleAfter === after ? "" : "…"}`,
  };
}

function takeStart(value: string, columns: number): string {
  let result = "";
  let width = 0;
  for (const character of value) {
    const next = terminalTextWidth(character);
    if (width + next > columns) break;
    result += character;
    width += next;
  }
  return result;
}

function takeEnd(value: string, columns: number): string {
  let result = "";
  let width = 0;
  for (const character of [...value].reverse()) {
    const next = terminalTextWidth(character);
    if (width + next > columns) break;
    result = `${character}${result}`;
    width += next;
  }
  return result;
}

function styledColumns(
  left: string,
  center: string,
  right: string,
  columns: number,
  style: string,
): string {
  const safeLeft = truncateTerminalText(left, Math.floor(columns / 4));
  const safeRight = truncateTerminalText(right, Math.floor(columns / 4));
  const centerWidth = Math.max(
    1,
    columns - terminalTextWidth(safeLeft) - terminalTextWidth(safeRight) - 2,
  );
  const safeCenter = truncateTerminalText(center, centerWidth);
  const padding = Math.max(
    1,
    columns -
      terminalTextWidth(safeLeft) -
      terminalTextWidth(safeCenter) -
      terminalTextWidth(safeRight),
  );
  return `${style}${safeLeft} ${safeCenter}${" ".repeat(Math.max(1, padding - 1))}${safeRight}${STYLE_RESET}`;
}

function divider(columns: number): string {
  return `${STYLE_DIM}${"─".repeat(columns)}${STYLE_RESET}`;
}

function boundedFrame(frame: string): string {
  if (Buffer.byteLength(frame, "utf8") > MAX_RENDER_BYTES) {
    throw new Error("TUI frame exceeds its output limit");
  }
  return frame;
}

function boundedDimension(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(minimum, Number(value)))
    : fallback;
}

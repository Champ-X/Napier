import type { Writable } from "node:stream";

import type { RunEvent } from "@napier/contracts";
import type { EmbeddedAgentExecution } from "@napier/runtime";

import { writeLine, writeText } from "./cli-output.js";

const TERMINAL_CONTROL =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

export class InteractiveOutputError extends Error {
  constructor(cause: unknown) {
    super("Interactive output failed", { cause });
    this.name = "InteractiveOutputError";
  }
}

export class InteractiveEventRenderer {
  private sawTextDelta = false;
  private outputEndsWithNewline = true;

  constructor(
    private readonly stdout: Writable,
    private readonly stderr: Writable,
  ) {}

  async render(event: RunEvent): Promise<void> {
    try {
      if (event.type === "model.text.delta") {
        const delta = stringField(event.payload, "delta");
        if (delta !== undefined) {
          const display = terminalSafeText(delta);
          await writeText(this.stdout, display);
          this.sawTextDelta = true;
          this.outputEndsWithNewline = display.endsWith("\n");
        }
        return;
      }
      if (event.type === "tool.started") {
        const toolName = displayId(stringField(event.payload, "toolName"));
        const effect = stringField(event.payload, "effect");
        await writeLine(
          this.stderr,
          `[tool] ${toolName} started${effect ? ` (${displayId(effect)})` : ""}`,
        );
        return;
      }
      if (event.type === "tool.completed" || event.type === "tool.failed") {
        const toolName = displayId(stringField(event.payload, "toolName"));
        await writeLine(
          this.stderr,
          `[tool] ${toolName} ${event.type === "tool.completed" ? "completed" : "failed"}`,
        );
        return;
      }
      if (event.type === "operator.decision.requested") {
        await writeLine(
          this.stderr,
          "[waiting] operator decision required in the Workbench",
        );
      }
    } catch (error) {
      throw new InteractiveOutputError(error);
    }
  }

  async finish(execution: EmbeddedAgentExecution): Promise<void> {
    try {
      if (this.sawTextDelta) {
        if (!this.outputEndsWithNewline) await writeText(this.stdout, "\n");
      } else if (execution.assistantText) {
        await writeLine(this.stdout, terminalSafeText(execution.assistantText));
      }
      await writeLine(
        this.stderr,
        `Napier run ${execution.run.id} ${execution.run.status} (thread ${execution.threadId})`,
      );
      this.sawTextDelta = false;
      this.outputEndsWithNewline = true;
    } catch (error) {
      throw new InteractiveOutputError(error);
    }
  }

  async fail(): Promise<void> {
    try {
      if (this.sawTextDelta && !this.outputEndsWithNewline) {
        await writeText(this.stdout, "\n");
      }
      this.sawTextDelta = false;
      this.outputEndsWithNewline = true;
    } catch (error) {
      throw new InteractiveOutputError(error);
    }
  }
}

function stringField(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function displayId(value: string | undefined): string {
  if (!value) return "unknown";
  return value.replace(/[^\w./:-]/gu, "_").slice(0, 96);
}

function terminalSafeText(value: string): string {
  return value.replace(TERMINAL_CONTROL, (character) => {
    const codePoint = character.codePointAt(0);
    return `\\u${codePoint?.toString(16).padStart(4, "0") ?? "fffd"}`;
  });
}

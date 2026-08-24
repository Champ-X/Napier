import type { Writable } from "node:stream";

import type { RunEvent } from "@napier/contracts";
import type { EmbeddedAgentExecution } from "@napier/runtime";

import { writeLine, writeText } from "./cli-output.js";
import { terminalSafeText } from "./terminal-safe-text.js";

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
      if (event.type === "route_attempt_started") {
        const model = routeModel(event);
        const attempt = numberField(event.payload, "attempt");
        const fallbackReason = stringField(event.payload, "fallbackReason");
        await writeLine(
          this.stderr,
          `[route] ${model} attempt ${attempt ?? "?"}${
            fallbackReason ? ` (fallback: ${displayId(fallbackReason)})` : ""
          }`,
        );
        return;
      }
      if (event.type === "route_attempt_ended") {
        const outcome = displayId(stringField(event.payload, "outcome"));
        const failure = stringField(event.payload, "failureClass");
        await writeLine(
          this.stderr,
          `[route] ${routeModel(event)} ${outcome}${
            failure ? ` (${displayId(failure)})` : ""
          }`,
        );
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

function numberField(input: unknown, field: string): number | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function routeModel(event: RunEvent): string {
  return `${displayId(stringField(event.payload, "providerId"))}/${displayId(
    stringField(event.payload, "modelId"),
  )}`;
}

function displayId(value: string | undefined): string {
  if (!value) return "unknown";
  return value.replace(/[^\w./:-]/gu, "_").slice(0, 96);
}

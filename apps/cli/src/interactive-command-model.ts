import type { ModelRef, RunRecord } from "@napier/contracts";
import type { AgentCapabilityStatus } from "@napier/contracts/agent-capabilities";

import { parseCliModelRef } from "./cli-option-values.js";

export const MAX_INTERACTIVE_INPUT_BYTES = 64 * 1024;

const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;

export const INTERACTIVE_COMMAND_HELP = [
  "Interactive commands:",
  "  /status                Show current Thread, model, and last Run",
  "  /model                 Show the current model",
  "  /model <provider/id>   Switch model for later turns",
  "  /model default         Use the Agent's configured default model",
  "  /thread <thread-id>    Continue another existing Thread",
  "  /new [title]           Start a new Thread on the next prompt",
  "  /resume [run-id]       Resume an interrupted Run on the current Thread",
  "  /clear                 Clear only the local TUI transcript (TUI only)",
  "  /help                  Show these commands",
  "  /exit                  Close the interactive session",
  "  //text                 Send a prompt beginning with '/'",
].join("\n");

export type InteractiveCommand =
  | { kind: "exit" }
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "model_show" }
  | { kind: "model_default" }
  | { kind: "model_set"; model: ModelRef }
  | { kind: "thread"; threadId: string }
  | { kind: "new"; title?: string }
  | { kind: "resume"; runId?: string }
  | { kind: "clear" };

export function parseInteractiveCommand(
  line: string,
  threadId: string | undefined,
): InteractiveCommand {
  const parsed = commandParts(line);
  if (parsed.name === "exit") {
    requireNoArgument(parsed, "/exit");
    return { kind: "exit" };
  }
  if (parsed.name === "help") {
    requireNoArgument(parsed, "/help");
    return { kind: "help" };
  }
  if (parsed.name === "status") {
    requireNoArgument(parsed, "/status");
    return { kind: "status" };
  }
  if (parsed.name === "clear") {
    requireNoArgument(parsed, "/clear");
    return { kind: "clear" };
  }
  if (parsed.name === "model") {
    if (!parsed.argument) return { kind: "model_show" };
    if (parsed.argument === "default") return { kind: "model_default" };
    try {
      return {
        kind: "model_set",
        model: parseCliModelRef(parsed.argument),
      };
    } catch {
      throw new Error("/model requires provider/model-id or default");
    }
  }
  if (parsed.name === "thread") {
    if (!parsed.argument || !RESOURCE_ID.test(parsed.argument)) {
      throw new Error("/thread requires a valid Thread ID");
    }
    return { kind: "thread", threadId: parsed.argument };
  }
  if (parsed.name === "new") {
    return {
      kind: "new",
      ...(parsed.argument
        ? { title: normalizeInteractiveTitle(parsed.argument) }
        : {}),
    };
  }
  if (parsed.name === "resume") {
    if (!threadId) throw new Error("/resume requires a current Thread");
    if (parsed.argument && !RUN_ID.test(parsed.argument)) {
      throw new Error("/resume Run ID is invalid");
    }
    return {
      kind: "resume",
      ...(parsed.argument ? { runId: parsed.argument } : {}),
    };
  }
  throw new Error(`Unknown interactive command: /${parsed.name}`);
}

export function interactiveStatusLine(
  threadId: string | undefined,
  model: ModelRef | undefined,
  run: RunRecord | undefined,
  capabilities?: AgentCapabilityStatus,
): string {
  return [
    `Thread: ${threadId ?? "new"}`,
    `Model: ${interactiveModelLabel(model)}`,
    `Last Run: ${run ? `${run.id} ${run.status}` : "none"}`,
    ...(capabilities
      ? [
          `Capabilities: ${capabilities.label} / ${capabilities.policyLabel} / browser ${capabilities.browserRead ? "read" : "off"} / interact ${capabilities.browserInteract ? "yes" : "no"}`,
        ]
      : []),
  ].join(" | ");
}

export function interactiveModelLabel(model: ModelRef | undefined): string {
  return model ? `${model.provider}/${model.id}` : "agent default";
}

function commandParts(line: string): { name: string; argument?: string } {
  const separator = line.search(/\s/u);
  const name = line
    .slice(1, separator < 0 ? undefined : separator)
    .toLowerCase();
  const argument =
    separator < 0 ? undefined : line.slice(separator + 1).trim() || undefined;
  return { name, ...(argument ? { argument } : {}) };
}

function requireNoArgument(
  command: { argument?: string },
  label: string,
): void {
  if (command.argument) throw new Error(`${label} accepts no arguments`);
}

function normalizeInteractiveTitle(input: string): string {
  const title = input.replace(/\s+/gu, " ").trim();
  if (!title || title.length > 160 || /[\u0000-\u001f\u007f<>]/u.test(title)) {
    throw new Error("/new title must be 1-160 safe characters");
  }
  return title;
}

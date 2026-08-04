import type { ModelRef, RunEvent, RunRecord } from "@napier/contracts";
import type { AgentCapabilityStatus } from "@napier/contracts/agent-capabilities";
import type { EmbeddedAgentExecution } from "@napier/runtime";

import {
  interactiveModelLabel,
  interactiveStatusLine,
} from "./interactive-command-model.js";
import { terminalSafeText } from "./terminal-safe-text.js";

const MAX_TRANSCRIPT_ENTRIES = 160;
const MAX_TRANSCRIPT_ENTRY_CHARS = 16 * 1024;
const MAX_TRANSCRIPT_CHARS = 256 * 1024;
const MAX_TOOL_CARDS = 12;
const MAX_NOTICE_CHARS = 2_000;

export interface TuiTranscriptEntry {
  id: number;
  role: "user" | "assistant" | "system";
  text: string;
  streaming: boolean;
}

export interface TuiToolCard {
  callId: string;
  toolName: string;
  effect?: string;
  status: "running" | "completed" | "failed";
}

export interface TuiStateSnapshot {
  threadId?: string;
  nextTitle?: string;
  model?: ModelRef;
  capabilities?: AgentCapabilityStatus;
  lastRun?: RunRecord;
  active: boolean;
  activeLabel?: string;
  waiting: boolean;
  notice?: string;
  helpVisible: boolean;
  scrollOffset: number;
  transcript: TuiTranscriptEntry[];
  tools: TuiToolCard[];
}

export class TuiSessionState {
  private threadId: string | undefined;
  private nextTitle: string | undefined;
  private model: ModelRef | undefined;
  private capabilities: AgentCapabilityStatus | undefined;
  private lastRun: RunRecord | undefined;
  private active = false;
  private activeLabel: string | undefined;
  private waiting = false;
  private notice: string | undefined;
  private helpVisible = false;
  private scrollOffset = 0;
  private nextEntryId = 1;
  private transcript: TuiTranscriptEntry[] = [];
  private tools: TuiToolCard[] = [];
  private currentAssistantId: number | undefined;

  constructor(input: {
    threadId?: string;
    title?: string;
    model?: ModelRef;
    capabilities?: AgentCapabilityStatus;
  }) {
    this.threadId = input.threadId;
    this.nextTitle = input.title;
    this.model = input.model;
    this.capabilities = input.capabilities;
  }

  snapshot(): TuiStateSnapshot {
    return {
      ...(this.threadId ? { threadId: this.threadId } : {}),
      ...(this.nextTitle ? { nextTitle: this.nextTitle } : {}),
      ...(this.model ? { model: structuredClone(this.model) } : {}),
      ...(this.capabilities
        ? { capabilities: structuredClone(this.capabilities) }
        : {}),
      ...(this.lastRun ? { lastRun: structuredClone(this.lastRun) } : {}),
      active: this.active,
      ...(this.activeLabel ? { activeLabel: this.activeLabel } : {}),
      waiting: this.waiting,
      ...(this.notice ? { notice: this.notice } : {}),
      helpVisible: this.helpVisible,
      scrollOffset: this.scrollOffset,
      transcript: this.transcript.map((entry) => ({ ...entry })),
      tools: this.tools.map((tool) => ({ ...tool })),
    };
  }

  currentThreadId(): string | undefined {
    return this.threadId;
  }

  currentModel(): ModelRef | undefined {
    return this.model ? structuredClone(this.model) : undefined;
  }

  pendingTitle(): string | undefined {
    return this.nextTitle;
  }

  beginPrompt(prompt: string): void {
    this.active = true;
    this.activeLabel = "running";
    this.waiting = false;
    this.notice = undefined;
    this.helpVisible = false;
    this.scrollOffset = 0;
    this.currentAssistantId = undefined;
    this.tools = [];
    this.appendEntry("user", prompt, false);
  }

  beginResume(): void {
    this.active = true;
    this.activeLabel = "resuming";
    this.waiting = false;
    this.notice = undefined;
    this.helpVisible = false;
    this.scrollOffset = 0;
    this.currentAssistantId = undefined;
    this.tools = [];
    this.appendEntry("system", "Resuming interrupted Run", false);
  }

  applyEvent(event: RunEvent): boolean {
    if (event.type === "model.text.delta") {
      const delta = field(event.payload, "delta");
      if (delta === undefined) return false;
      this.appendAssistantDelta(delta);
      return true;
    }
    if (event.type === "tool.started") {
      this.upsertTool(event, "running");
      return true;
    }
    if (event.type === "tool.completed" || event.type === "tool.failed") {
      this.upsertTool(
        event,
        event.type === "tool.completed" ? "completed" : "failed",
      );
      return true;
    }
    if (event.type === "operator.decision.requested") {
      this.waiting = true;
      this.activeLabel = "waiting for operator";
      this.notice = "Operator decision required in the Workbench";
      return true;
    }
    return false;
  }

  finish(execution: EmbeddedAgentExecution): void {
    if (
      this.currentAssistantId === undefined &&
      execution.assistantText !== undefined
    ) {
      this.appendEntry("assistant", execution.assistantText, false);
    }
    this.finishStreamingEntry();
    this.threadId = execution.threadId;
    this.nextTitle = undefined;
    this.lastRun = structuredClone(execution.run);
    this.active = false;
    this.activeLabel = execution.run.status;
    this.notice = `Run ${execution.run.id} ${execution.run.status}`;
  }

  fail(message: string): void {
    this.finishStreamingEntry();
    this.active = false;
    this.activeLabel = "failed";
    this.notice = bounded(message, MAX_NOTICE_CHARS);
  }

  cancelRequested(): void {
    this.activeLabel = "cancelling";
    this.notice = "Cancelling active Run";
  }

  setNotice(message: string): void {
    this.notice = bounded(terminalSafeText(message), MAX_NOTICE_CHARS);
  }

  setModel(model: ModelRef | undefined): void {
    this.model = model ? structuredClone(model) : undefined;
    this.notice = `Model: ${interactiveModelLabel(this.model)}`;
  }

  setModelSilently(model: ModelRef | undefined): void {
    this.model = model ? structuredClone(model) : undefined;
  }

  setThread(threadId: string): void {
    this.threadId = threadId;
    this.nextTitle = undefined;
    this.lastRun = undefined;
    this.waiting = false;
    this.tools = [];
    this.notice = `Thread: ${threadId}`;
    this.scrollOffset = 0;
  }

  setNewThread(title: string | undefined): void {
    this.threadId = undefined;
    this.nextTitle = title;
    this.lastRun = undefined;
    this.waiting = false;
    this.tools = [];
    this.notice = `Thread: new${title ? ` (${title})` : ""}`;
    this.scrollOffset = 0;
  }

  showStatus(): void {
    this.notice = interactiveStatusLine(
      this.threadId,
      this.model,
      this.lastRun,
      this.capabilities,
    );
  }

  setCapabilities(capabilities: AgentCapabilityStatus): void {
    this.capabilities = structuredClone(capabilities);
  }

  showHelp(): void {
    this.helpVisible = !this.helpVisible;
    this.notice = this.helpVisible
      ? "Help open; submit /help again to close"
      : "Help closed";
  }

  clearTranscript(): void {
    this.transcript = [];
    this.tools = [];
    this.currentAssistantId = undefined;
    this.scrollOffset = 0;
    this.notice = "Local TUI transcript cleared; Ledger evidence is unchanged";
  }

  scroll(direction: "up" | "down", pageSize: number): void {
    this.scrollOffset =
      direction === "up"
        ? Math.min(MAX_TRANSCRIPT_ENTRIES, this.scrollOffset + pageSize)
        : Math.max(0, this.scrollOffset - pageSize);
  }

  private appendAssistantDelta(delta: string): void {
    let entry = this.transcript.find(
      (candidate) => candidate.id === this.currentAssistantId,
    );
    if (!entry) {
      entry = this.appendEntry("assistant", "", true);
      this.currentAssistantId = entry.id;
    }
    entry.text = bounded(
      `${entry.text}${terminalSafeText(delta)}`,
      MAX_TRANSCRIPT_ENTRY_CHARS,
    );
    this.enforceTranscriptBounds();
    this.scrollOffset = 0;
  }

  private finishStreamingEntry(): void {
    const entry = this.transcript.find(
      (candidate) => candidate.id === this.currentAssistantId,
    );
    if (entry) entry.streaming = false;
    this.currentAssistantId = undefined;
  }

  private appendEntry(
    role: TuiTranscriptEntry["role"],
    text: string,
    streaming: boolean,
  ): TuiTranscriptEntry {
    const entry = {
      id: this.nextEntryId++,
      role,
      text: bounded(terminalSafeText(text), MAX_TRANSCRIPT_ENTRY_CHARS),
      streaming,
    };
    this.transcript.push(entry);
    this.enforceTranscriptBounds();
    return entry;
  }

  private enforceTranscriptBounds(): void {
    while (
      this.transcript.length > MAX_TRANSCRIPT_ENTRIES ||
      this.transcript.reduce((total, entry) => total + entry.text.length, 0) >
        MAX_TRANSCRIPT_CHARS
    ) {
      const removed = this.transcript.shift();
      if (removed?.id === this.currentAssistantId) {
        this.currentAssistantId = undefined;
      }
    }
  }

  private upsertTool(event: RunEvent, status: TuiToolCard["status"]): void {
    const callId = displayId(field(event.payload, "callId") ?? event.id);
    const existing = this.tools.find((tool) => tool.callId === callId);
    const toolName = displayId(field(event.payload, "toolName") ?? "unknown");
    const effect = field(event.payload, "effect");
    const next = {
      callId,
      toolName,
      ...(effect ? { effect: displayId(effect) } : {}),
      status,
    };
    if (existing) Object.assign(existing, next);
    else this.tools.push(next);
    if (this.tools.length > MAX_TOOL_CARDS) this.tools.shift();
  }
}

function field(input: unknown, name: string): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function displayId(value: string): string {
  return value.replace(/[^\w./:-]/gu, "_").slice(0, 96) || "unknown";
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

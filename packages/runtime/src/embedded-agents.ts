import type { ModelRef, RunEvent, RunRecord } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

import type { AgentRuntime } from "./agent-runtime.js";
import type { EventSink } from "./event-sink.js";
import type { LocalStore } from "./store.js";

export const MAX_EMBEDDED_AGENT_PROMPT_BYTES = 64 * 1_024;

const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;

export interface RunEmbeddedAgentOptions {
  prompt: string;
  threadId?: string;
  agentId?: string;
  title?: string;
  model?: ModelRef;
  capabilityPreset?: AgentCapabilityPresetId;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export interface ResumeEmbeddedAgentOptions {
  threadId: string;
  runId?: string;
  model?: ModelRef;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export interface EmbeddedAgentExecution {
  threadId: string;
  run: RunRecord;
  assistantText?: string;
}

export class EmbeddedAgentService {
  constructor(
    private readonly store: LocalStore,
    private readonly runtime: AgentRuntime,
  ) {}

  async run(options: RunEmbeddedAgentOptions): Promise<EmbeddedAgentExecution> {
    options.signal?.throwIfAborted();
    const prompt = normalizePrompt(options.prompt);
    const model = validateOptionalModel(options.model);
    const threadId =
      options.threadId !== undefined
        ? this.existingThread(options.threadId, options.agentId, options.title)
            .id
        : (
            await this.store.createThread({
              title: normalizeTitle(options.title, "SDK Agent run"),
              agentId: this.resolveAgent(options.agentId).id,
            })
          ).id;
    return this.execute(threadId, options.onEvent, (onEvent) =>
      this.runtime.runPrompt({
        threadId,
        text: prompt,
        ...(model !== undefined ? { model } : {}),
        ...(options.capabilityPreset
          ? { capabilityPreset: options.capabilityPreset }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        onEvent,
      }),
    );
  }

  async resume(
    options: ResumeEmbeddedAgentOptions,
  ): Promise<EmbeddedAgentExecution> {
    options.signal?.throwIfAborted();
    if (options.runId !== undefined && !RUN_ID.test(options.runId)) {
      throw new Error("Embedded Agent Run ID is invalid");
    }
    const model = validateOptionalModel(options.model);
    return this.execute(options.threadId, options.onEvent, (onEvent) =>
      this.runtime.resumeInterruptedRun({
        threadId: options.threadId,
        ...(options.runId !== undefined ? { runId: options.runId } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        onEvent,
      }),
    );
  }

  private async execute(
    threadId: string,
    eventSink: EventSink | undefined,
    invoke: (onEvent: EventSink) => Promise<RunRecord>,
  ): Promise<EmbeddedAgentExecution> {
    const assistantTextByRun = new Map<string, string>();
    const run = await invoke(async (event) => {
      const assistantText = assistantTextFromEvent(event);
      if (assistantText !== undefined) {
        assistantTextByRun.set(event.runId, assistantText);
      }
      await eventSink?.(event);
    });
    const assistantText = assistantTextByRun.get(run.id);
    return execution(threadId, run, assistantText);
  }

  private existingThread(
    threadId: string,
    agentId: string | undefined,
    title: string | undefined,
  ) {
    if (title !== undefined) {
      throw new Error(
        "Embedded Agent title cannot be used with an existing Thread",
      );
    }
    const thread = this.store.getThread(threadId);
    if (agentId !== undefined && thread.agentId !== agentId) {
      throw new Error("Embedded Agent Thread Agent does not match");
    }
    return thread;
  }

  private resolveAgent(agentId: string | undefined) {
    const agent =
      agentId !== undefined
        ? this.store.getAgent(agentId)
        : this.store.listAgents()[0];
    if (!agent) throw new Error("No Agent profile is available");
    return agent;
  }
}

function normalizePrompt(input: string): string {
  if (typeof input !== "string") {
    throw new Error("Embedded Agent prompt is invalid");
  }
  const prompt = input.trim();
  if (!prompt) throw new Error("Embedded Agent prompt is required");
  if (Buffer.byteLength(prompt, "utf8") > MAX_EMBEDDED_AGENT_PROMPT_BYTES) {
    throw new Error(
      `Embedded Agent prompt exceeds ${MAX_EMBEDDED_AGENT_PROMPT_BYTES} UTF-8 bytes`,
    );
  }
  return prompt;
}

function normalizeTitle(input: string | undefined, fallback: string): string {
  const title = (input ?? fallback).replace(/\s+/gu, " ").trim();
  if (
    title.length < 1 ||
    title.length > 160 ||
    /[\u0000-\u001f\u007f<>]/u.test(title)
  ) {
    throw new Error("Embedded Agent title is invalid");
  }
  return title;
}

function validateOptionalModel(
  input: ModelRef | undefined,
): ModelRef | undefined {
  if (input === undefined) return undefined;
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, "provider") ||
    !Object.hasOwn(input, "id") ||
    typeof input.provider !== "string" ||
    !PROVIDER_ID.test(input.provider) ||
    typeof input.id !== "string" ||
    !MODEL_ID.test(input.id)
  ) {
    throw new Error("Embedded Agent model is invalid");
  }
  return { provider: input.provider, id: input.id };
}

function assistantTextFromEvent(event: RunEvent): string | undefined {
  if (
    event.type === "message.assistant" &&
    event.payload &&
    !Array.isArray(event.payload) &&
    typeof event.payload === "object" &&
    typeof event.payload["text"] === "string"
  ) {
    return event.payload["text"];
  }
  return undefined;
}

function execution(
  threadId: string,
  run: RunRecord,
  assistantText: string | undefined,
): EmbeddedAgentExecution {
  return {
    threadId,
    run: structuredClone(run),
    ...(assistantText !== undefined ? { assistantText } : {}),
  };
}

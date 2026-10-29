import { contentText, type Tool } from "@earendil-works/pi-ai";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { RunRecord } from "@napier/contracts";
import { canonicalJson } from "./ed25519.js";
import { createModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import { resolveSubagentChildRestore, revalidateSubagentChildRestoreWorkspace } from "./subagent-continuation-source.js";
import type { StartedSubagentChildContinuation, SubagentChildRestoreData } from "./subagent-continuation-types.js";
import type { SubagentExecutionControl } from "./subagent-execution-control.js";
import type { SubagentTaskObserver } from "./subagent-task-observer.js";
import type { SubagentWorkingSet } from "./subagent-working-set.js";
export type { StartedSubagentChildContinuation } from "./subagent-continuation-types.js";

/** The fresh/continued SDK boundary stays separate from Task lifecycle settlement. */
export class SubagentRunnerRestore {
  private readonly data: SubagentChildRestoreData | undefined;
  constructor(private readonly continuation: StartedSubagentChildContinuation | undefined, parent: RunRecord) {
    this.data = continuation ? restoreSubagentRunnerSource(continuation, parent) : undefined;
  }
  get deadlineMs() { return this.data ? Date.parse(this.data.budget.deadlineAt) : undefined; }
  get messages() { return this.data?.messages ?? []; }
  get requiresDurableCheckpoint() { return this.data !== undefined; }
  get budget() { return this.data?.budget; }
  get toolBindings() { return this.data ? { inheritedProviderCallIds: inheritedSubagentToolCallIds(this.data) } : {}; }

  async prepare(workspaceRoot: string, control: SubagentExecutionControl | undefined): Promise<void> {
    if (!this.data) return;
    if (this.data.mailbox.pending.length && !control)
      throw new Error("Child continuation pending mailbox requires an execution control");
    await revalidateSubagentChildRestoreWorkspace(this.continuation!.restore, workspaceRoot);
  }
  assertTools(tools: readonly Tool[]): void { if (this.data) assertSubagentRestoreTools(this.data, tools); }
  async hydrate(agent: Agent, observer: SubagentTaskObserver, workingSet: SubagentWorkingSet,
    control: SubagentExecutionControl | undefined): Promise<void> {
    if (!this.data) return;
    observer.finalText = restoredSubagentFinalText(this.data);
    control?.restore(this.continuation!.restore, agent.state.messages);
    await workingSet.persist(agent.state.messages, "before_model");
  }
  async invoke(agent: Agent, prompt: string): Promise<void> {
    if (!this.data) await agent.prompt(prompt);
    else if (this.data.mode === "continue" || agent.hasQueuedMessages()) await agent.continue();
  }
}

/** Resolve the private capability, then bind it to this exact claimed execution. */
export function restoreSubagentRunnerSource(started: StartedSubagentChildContinuation, parent: RunRecord): SubagentChildRestoreData {
  const data = resolveSubagentChildRestore(started.restore);
  const { run, task, profile } = started.execution;
  if (data.runId !== run.id || data.taskId !== task.id || data.executionId !== task.executionId ||
      run.parentRunId !== parent.id || task.runId !== parent.id || run.threadId !== parent.threadId ||
      run.subagent?.executionId !== data.executionId || run.subagent.taskId !== task.id ||
      run.subagent.continuation?.contentSha256 !== data.continuation.contentSha256 ||
      canonicalJson(data.budget) !== canonicalJson(started.budget) ||
      canonicalJson(data.budget) !== canonicalJson(run.subagent.continuation.budget) ||
      profile.systemPrompt !== data.systemPrompt)
    throw new Error("Child restore capability does not match its claimed execution");
  const envelope = createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: data.systemPrompt,
    tools: data.tools, messages: data.messages });
  if (envelope.messageSetSha256 !== data.continuation.sourceMessageSetSha256 ||
      data.messages.length !== data.continuation.sourceMessageCount ||
      envelope.systemPromptSha256 !== data.continuation.grant.systemPromptSha256 ||
      envelope.toolDefinitionSetSha256 !== data.continuation.grant.toolDefinitionSetSha256)
    throw new Error("Child restore source differs from its continuation binding");
  assertRestoreFrontier(data);
  return data;
}

function assertRestoreFrontier(data: SubagentChildRestoreData): void {
  const tail = data.messages.at(-1);
  if (data.mode === "finalize") {
    if (tail?.role !== "assistant" || tail.stopReason !== "stop" ||
        tail.content.some((block) => block.type === "toolCall") || data.mailbox.pending.length)
      throw new Error("Child restore finalization requires a settled final assistant");
  } else if (tail?.role !== "user" && tail?.role !== "toolResult" &&
      !(tail?.role === "assistant" && tail.stopReason === "stop" && data.mailbox.pending.length)) {
    throw new Error("Child restore continuation has no safe SDK input tail");
  }
}

export function assertSubagentRestoreTools(data: SubagentChildRestoreData, tools: readonly Tool[]): void {
  const actual = createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: data.systemPrompt, tools, messages: [] });
  if (actual.toolDefinitionSetSha256 !== data.continuation.grant.toolDefinitionSetSha256)
    throw new Error("Child restore tool definitions changed before execution");
}

export function restoredSubagentFinalText(data: SubagentChildRestoreData): string {
  const tail = data.messages.at(-1);
  return data.mode === "finalize" && tail?.role === "assistant" ? contentText(tail.content) : "";
}

export function inheritedSubagentToolCallIds(data: SubagentChildRestoreData): string[] {
  return [...new Set(data.messages.flatMap((message) => message.role === "assistant"
    ? message.content.flatMap((block) => block.type === "toolCall" ? [block.id] : []) : []))];
}

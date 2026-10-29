import type { Tool } from "@earendil-works/pi-ai";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { RunEvent } from "@napier/contracts";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import { LocalPrivateCapsuleDurabilityUnavailableError } from "./local-private-capsule-store.js";
import type { AppendEventInput } from "./store-event-service.js";
import type { SubagentChildExecution } from "./subagent-child-execution.js";
import type { SubagentExecutionControl } from "./subagent-execution-control.js";
import { prepareSubagentWorkingSet, type SubagentWorkingSetCapsule } from "./subagent-working-set-capsule.js";
import type { SubagentMailboxConsumedBinding } from "./subagent-working-set-types.js";

/** The full private source transcript is append-only; compaction projects requests. */
export class SubagentWorkingSet {
  private failed = false;
  private checkpointDisabled = false;
  private failure: unknown;
  constructor(private readonly options: {
    store: { dataRoot: string; appendEvent(input: AppendEventInput): Promise<RunEvent> };
    child: SubagentChildExecution;
    systemPrompt: string;
    tools: readonly Tool[];
    control?: SubagentExecutionControl;
    onEvent: EventSink | undefined;
  }) {}

  get healthy(): boolean { return !this.failed; }
  assertHealthy(): void { if (this.failed) throw this.failure; }

  async observe(event: AgentEvent, messages: readonly unknown[]): Promise<void> {
    if (!this.healthy || event.type !== "turn_end" || event.message.role !== "assistant" ||
        event.message.stopReason === "error" || event.message.stopReason === "aborted") return;
    await this.persist(messages, "turn_complete");
  }

  async persist(messages: readonly unknown[], boundary: SubagentWorkingSetCapsule["boundary"]): Promise<void> {
    this.assertHealthy();
    if (this.checkpointDisabled) return;
    try {
      try { await this.persistActive(messages, boundary); }
      catch (error) {
        if (!(error instanceof LocalPrivateCapsuleDurabilityUnavailableError)) throw error;
        await this.disableUnsupportedCheckpoint();
      }
    } catch (error) { this.failed = true; this.failure = error; throw error; }
  }

  private async disableUnsupportedCheckpoint(): Promise<void> {
    this.options.child.assertActive();
    const event = await this.options.store.appendEvent({ threadId: this.options.child.run.threadId,
      runId: this.options.child.run.id, type: "subagent.child.checkpoint_unavailable", category: "subagent", visibility: "debug",
      payload: { taskId: this.options.child.task.id, executionId: this.options.child.task.executionId!,
        reason: "durable_directory_unsupported", continuationAvailable: false } });
    this.checkpointDisabled = true;
    await emitBestEffort(this.options.onEvent, event);
  }

  private async persistActive(messages: readonly unknown[], boundary: SubagentWorkingSetCapsule["boundary"]): Promise<void> {
    const observed = this.options.control?.consumedBindings(messages) ?? [];
    // Snapshot the raw SDK source at its awaited boundary, before asynchronous IO.
    const source = structuredClone(messages);
    await this.options.child.checkpoint(async (snapshot) => {
      const consumed = new Map<string, SubagentMailboxConsumedBinding>(snapshot.mailbox.consumed.map((entry) => [entry.id, entry]));
      for (const entry of observed) {
        const accepted = snapshot.mailbox.accepted.find((candidate) => candidate.id === entry.id && candidate.contentSha256 === entry.contentSha256);
        if (!accepted) throw new Error("Consumed child message has no accepted mailbox binding");
        consumed.set(entry.id, { ...entry, acceptedSeq: accepted.acceptedSeq });
      }
      const entries = [...consumed.values()].sort((a, b) => a.acceptedSeq - b.acceptedSeq);
      let consumedThroughSeq = 0;
      for (const accepted of snapshot.mailbox.accepted) {
        if (!consumed.has(accepted.id)) break;
        consumedThroughSeq = accepted.acceptedSeq;
      }
      return prepareSubagentWorkingSet(this.options.store.dataRoot, { frontier: snapshot.frontier, boundary,
        systemPrompt: this.options.systemPrompt, tools: this.options.tools, messages: source,
        mailbox: { consumedThroughSeq, entries },
        ...(snapshot.previousCheckpoint ? { previousCheckpoint: snapshot.previousCheckpoint } : {}),
      });
    });
  }
}

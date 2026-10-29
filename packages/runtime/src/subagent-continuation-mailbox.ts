import type { RunRecord, SubagentTask } from "@napier/contracts";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
import { acceptedSubagentMailbox, validateSubagentMailboxMessage } from "./subagent-mailbox-state.js";
import { listAcceptedSubagentMailboxEvents } from "./subagent-mailbox-events.js";
import type { SubagentMailboxAcceptedBinding, SubagentMailboxConsumedBinding } from "./subagent-working-set-types.js";

export function continuationMailbox(host: SubagentChildRunHost, run: RunRecord, task: SubagentTask) {
  const sources: SubagentTask[] = [];
  const seen = new Set<string>();
  let current: SubagentTask | undefined = task;
  let currentRun: RunRecord | undefined = run;
  while (current && currentRun) {
    if (seen.has(current.id) || seen.size >= 32) throw new Error("Child mailbox lineage is invalid");
    seen.add(current.id); sources.unshift(current);
    const predecessor = currentRun.subagent?.continuation?.predecessorTaskId;
    if (!predecessor) break;
    current = host.state.subagents.find((candidate) => candidate.id === predecessor);
    currentRun = host.state.runs.find((candidate) => candidate.id === current?.childRunId);
    if (!current || !currentRun) throw new Error("Child mailbox predecessor is unavailable");
  }
  const accepted: SubagentMailboxAcceptedBinding[] = [];
  const messages = new Map<string, SubagentMessage>();
  for (const source of sources) {
    const events = listAcceptedSubagentMailboxEvents(host.requireLedger(), source.runId);
    const bySeq = new Map<number, (typeof events)[number]>();
    for (const event of events) {
      if (event.type === "subagent.message.accepted" && !bySeq.has(event.seq)) bySeq.set(event.seq, event);
    }
    for (const entry of acceptedSubagentMailbox(events, source)) {
      if (messages.has(entry.id)) throw new Error("Child mailbox inherited identity is ambiguous");
      const event = bySeq.get(entry.acceptedSeq)!;
      messages.set(entry.id, validateSubagentMailboxMessage(event.payload, source.id));
      accepted.push(source.id === task.id ? entry : { ...entry, originTaskId: source.id, originParentRunId: source.runId });
    }
  }
  return { accepted: accepted.sort((left, right) => left.acceptedSeq - right.acceptedSeq), messages };
}

export function inheritConsumedMailbox(entries: readonly SubagentMailboxConsumedBinding[],
  origin: { taskId: string; parentRunId: string }): SubagentMailboxConsumedBinding[] {
  return entries.map((entry) => ({ ...entry, originTaskId: entry.originTaskId ?? origin.taskId,
    originParentRunId: entry.originParentRunId ?? origin.parentRunId }));
}

export function assertContinuationMailboxCompleted(host: SubagentChildRunHost, run: RunRecord, task: SubagentTask): void {
  if (run.subagent?.continuation && continuationMailbox(host, run, task).accepted.length !== (task.mailboxConsumedCount ?? 0))
    throw new Error("Child continuation has unconsumed durable mailbox input");
}

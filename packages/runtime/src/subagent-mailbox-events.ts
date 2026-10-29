import type { RunEvent } from "@napier/contracts";
import { RUN_TERMINAL_EVENT_TYPES } from "./run-event-admission.js";
import type { RunEventQueryPort } from "./run-event-query-port.js";

export interface SubagentMailboxRunEventReader {
  listRunEvents(runId: string, afterSeq?: number, types?: readonly string[]): RunEvent[];
}

const ACCEPTED_EVENT_TYPES = ["subagent.message.accepted"] as const;
const ADMISSION_EVENT_TYPES = [...ACCEPTED_EVENT_TYPES, ...RUN_TERMINAL_EVENT_TYPES];
const MAILBOX_EVENT_TYPES = [...ACCEPTED_EVENT_TYPES, "subagent.message.delivered"];

/** Identity conflicts are scoped to the whole parent Run, including sibling Tasks. */
export function listAcceptedSubagentMailboxEvents(reader: SubagentMailboxRunEventReader, runId: string): RunEvent[] {
  return reader.listRunEvents(runId, 0, ACCEPTED_EVENT_TYPES);
}

export function listSubagentMailboxAdmissionEvents(reader: SubagentMailboxRunEventReader, runId: string): RunEvent[] {
  return reader.listRunEvents(runId, 0, ADMISSION_EVENT_TYPES);
}

/** Display replay follows Task lineage across the thread, without imposing a Run identity filter. */
export function listThreadSubagentMailboxEvents(reader: Pick<RunEventQueryPort, "listEventsRange">,
  threadId: string): Promise<RunEvent[]> {
  // Avoid a separately read head: another Store can append before this asynchronous query executes.
  return reader.listEventsRange(threadId, 1, Number.MAX_SAFE_INTEGER, MAILBOX_EVENT_TYPES);
}

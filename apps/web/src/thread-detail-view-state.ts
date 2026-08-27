import type { RunControlMessage, ThreadSummary } from "@napier/contracts";

import type { WebThreadDetail } from "./api";

export function preserveThreadDetailImportReceipt(
  next: WebThreadDetail | undefined,
  current: WebThreadDetail | undefined,
): WebThreadDetail | undefined {
  if (!next || next.importReceipt || next.thread.id !== current?.thread.id) {
    return next;
  }
  return current.importReceipt
    ? { ...next, importReceipt: current.importReceipt }
    : next;
}

export function upsertThread(
  threads: ThreadSummary[],
  thread: ThreadSummary,
): ThreadSummary[] {
  return [thread, ...threads.filter((item) => item.id !== thread.id)].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function upsertThreadControlMessage(
  detail: WebThreadDetail | undefined,
  message: RunControlMessage,
): WebThreadDetail | undefined {
  return detail
    ? {
        ...detail,
        runControlMessages: [
          ...detail.runControlMessages.filter(
            (candidate) => candidate.id !== message.id,
          ),
          message,
        ],
      }
    : detail;
}

export { useMemoryProvenanceDraft } from "./use-memory-provenance-draft";

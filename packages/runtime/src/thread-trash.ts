import type {
  RunEvent,
  RunRecord,
  ThreadRecord,
  ThreadSummary,
} from "@napier/contracts";

export type ThreadTrashState =
  | { status: "visible" }
  | { status: "trashed"; trashedAt: string };

export function projectThreadTrashState(
  events: readonly RunEvent[],
): ThreadTrashState {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "thread.restored") return { status: "visible" };
    if (event.type === "thread.trashed") {
      return { status: "trashed", trashedAt: event.createdAt };
    }
  }
  return { status: "visible" };
}

export function threadIsTrashed(events: readonly RunEvent[]): boolean {
  return projectThreadTrashState(events).status === "trashed";
}

export function visibleThreads(
  threads: readonly ThreadRecord[],
  events: (threadId: string) => readonly RunEvent[],
): ThreadSummary[] {
  return threads
    .filter((thread) => !threadIsTrashed(events(thread.id)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function threadTrashEvent(input: {
  action: "trash" | "restore";
  thread: ThreadRecord;
  runs: readonly RunRecord[];
  events: readonly RunEvent[];
}):
  | {
      threadId: string;
      runId: string;
      type: string;
      category: "lifecycle";
      visibility: "user";
      payload: {};
    }
  | undefined {
  const trashed = threadIsTrashed(input.events);
  if ((input.action === "trash") === trashed) return undefined;
  if (
    input.action === "trash" &&
    input.runs.some(
      (run) =>
        run.threadId === input.thread.id &&
        (run.status === "queued" || run.status === "running"),
    )
  ) {
    throw new Error("Thread with active work cannot be moved to trash");
  }
  return {
    threadId: input.thread.id,
    runId: "runctl_thread_trash",
    type: input.action === "trash" ? "thread.trashed" : "thread.restored",
    category: "lifecycle",
    visibility: "user",
    payload: {},
  };
}

export async function mutateThreadTrash(input: {
  action: "trash" | "restore";
  thread: ThreadRecord;
  runs: readonly RunRecord[];
  events: readonly RunEvent[];
  append(event: NonNullable<ReturnType<typeof threadTrashEvent>>): RunEvent;
  persist(event: RunEvent): Promise<void>;
}): Promise<ThreadRecord> {
  const eventInput = threadTrashEvent(input);
  if (!eventInput) return structuredClone(input.thread);
  const event = input.append(eventInput);
  await input.persist(event);
  return structuredClone(input.thread);
}

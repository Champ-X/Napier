import type { WorkspaceProcessStatus } from "@napier/contracts";

export function reserveWorkspaceProcessStart(input: {
  sessions: Iterable<{
    threadId: string;
    status: WorkspaceProcessStatus;
  }>;
  startingByThread: Map<string, number>;
  threadId: string;
  maximumGlobal: number;
  maximumPerThread: number;
}): () => void {
  const sessions = [...input.sessions];
  const startingCount = input.startingByThread.get(input.threadId) ?? 0;
  const activeGlobalCount = sessions.filter(
    (session) => session.status === "running",
  ).length;
  const activeThreadCount = sessions.filter(
    (session) =>
      session.threadId === input.threadId && session.status === "running",
  ).length;
  const startingGlobalCount = [...input.startingByThread.values()].reduce(
    (total, count) => total + count,
    0,
  );
  if (activeGlobalCount + startingGlobalCount >= input.maximumGlobal) {
    throw new Error(
      `Runtime already has ${input.maximumGlobal} active Process Sessions`,
    );
  }
  if (activeThreadCount + startingCount >= input.maximumPerThread) {
    throw new Error(
      `Thread already has ${input.maximumPerThread} active Process Sessions`,
    );
  }
  input.startingByThread.set(input.threadId, startingCount + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (input.startingByThread.get(input.threadId) ?? 1) - 1;
    if (remaining > 0) {
      input.startingByThread.set(input.threadId, remaining);
    } else {
      input.startingByThread.delete(input.threadId);
    }
  };
}

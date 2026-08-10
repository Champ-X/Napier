import type { WorkspaceProcessSession } from "@napier/contracts";

import type { NodeDebuggerProcessManager } from "./node-debugger-process.js";
import type { NodeDebuggerRuntimeIdentity } from "./node-debugger-runtime.js";
import { NODE_DEBUGGER_WORKER_ARGUMENTS } from "./node-debugger-worker.js";

export async function startBoundNodeDebuggerProcess(input: {
  processes: NodeDebuggerProcessManager;
  threadId: string;
  runId: string;
  sessionTimeoutMs: number;
  signal?: AbortSignal;
}): Promise<{
  session: WorkspaceProcessSession;
  runtime: NodeDebuggerRuntimeIdentity;
}> {
  const runtime = await input.processes.resolveNodeDebuggerRuntime({
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const session = await input.processes.startPrivateProtocol({
    threadId: input.threadId,
    runId: input.runId,
    command: {
      runtime: "node",
      args: [...NODE_DEBUGGER_WORKER_ARGUMENTS],
      cwd: ".",
      timeoutMs: input.sessionTimeoutMs,
    },
    interactive: true,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (session.executableSha256 !== runtime.nodeExecutableSha256) {
    await input.processes
      .cancel(input.threadId, session.id)
      .catch(() => undefined);
    throw new Error("Node debugger runtime identity changed before launch");
  }
  return { session, runtime };
}

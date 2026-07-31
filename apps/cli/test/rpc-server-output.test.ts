import { PassThrough, Writable } from "node:stream";

import type { RunEvent, RunRecord } from "@napier/contracts";
import type {
  EmbeddedAgentExecution,
  EmbeddedAgentService,
} from "@napier/runtime";
import { describe, expect, it } from "vitest";

import { runNapierRpcServer } from "../src/rpc-server.js";

describe("Napier JSON-RPC output failure", () => {
  it("aborts active work and exits non-zero when stdout fails", async () => {
    const input = new PassThrough();
    const output = new FailingWritable(2);
    let aborted = false;
    const agents: Pick<EmbeddedAgentService, "run" | "resume"> = {
      async run(options) {
        void options
          .onEvent?.(runEvent("run_rpc_output", "run.started"))
          .catch(() => undefined);
        await waitForAbort(options.signal!);
        aborted = true;
        return execution("thread_rpc_output", "run_rpc_output", "cancelled");
      },
      async resume(options) {
        return execution(options.threadId, "run_rpc_resume", "completed");
      },
    };
    const server = runNapierRpcServer({
      agents,
      workflows: {
        async run() {
          throw new Error("Unexpected Workflow RPC call");
        },
        async resume() {
          throw new Error("Unexpected Workflow RPC call");
        },
        async answerAndResume() {
          throw new Error("Unexpected Workflow RPC call");
        },
      },
      input,
      output,
      serverVersion: "test",
    });
    input.write('{"jsonrpc":"2.0","id":"init","method":"initialize"}\n');
    input.write(
      '{"jsonrpc":"2.0","id":"run","method":"napier/agent/run","params":{"prompt":"Trigger output failure."}}\n',
    );

    expect(await server).toBe(1);
    expect(aborted).toBe(true);
    expect(output.text()).not.toContain("PRIVATE_OUTPUT_FAILURE");
  });
});

function execution(
  threadId: string,
  runId: string,
  status: RunRecord["status"],
): EmbeddedAgentExecution {
  return {
    threadId,
    run: {
      id: runId,
      threadId,
      status,
    } as RunRecord,
  };
}

function runEvent(runId: string, type: string): RunEvent {
  return {
    id: `event_${runId}`,
    threadId: "thread_rpc_output",
    runId,
    seq: 1,
    type,
    category: "lifecycle",
    visibility: "debug",
    createdAt: "2026-07-31T00:00:00.000Z",
    payload: { status: "running" },
  };
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

class FailingWritable extends Writable {
  private readonly chunks: string[] = [];
  private writes = 0;

  constructor(private readonly failAtWrite: number) {
    super();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writes += 1;
    if (this.writes === this.failAtWrite) {
      callback(new Error("PRIVATE_OUTPUT_FAILURE"));
      return;
    }
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

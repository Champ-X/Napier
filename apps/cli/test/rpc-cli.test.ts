import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  exportThreadReplayBundle,
  LocalStore,
  sha256,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli-options.js";

const temporaryRoots: string[] = [];
const openChildren = new Set<ChildProcessWithoutNullStreams>();

afterEach(async () => {
  await Promise.all(
    [...openChildren].map(async (child) => {
      child.kill("SIGTERM");
      if (child.exitCode === null && child.signalCode === null) {
        await once(child, "exit");
      }
    }),
  );
  openChildren.clear();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier RPC CLI", () => {
  it("parses the dedicated long-lived RPC command", () => {
    expect(
      parseCliArgs(["rpc", "--workspace", ".", "--data-root", ".napier-rpc"]),
    ).toEqual({
      kind: "rpc",
      options: {
        workspace: ".",
        dataRoot: ".napier-rpc",
      },
    });
    expect(() => parseCliArgs(["rpc", "--workspace", ".", "--jsonl"])).toThrow(
      "--jsonl cannot",
    );
    expect(() => parseCliArgs(["rpc"])).toThrow("--workspace is required");
  });

  it("runs and continues a real Agent through the built stdio process", async () => {
    const fixture = await createFixture();
    const child = spawn(
      process.execPath,
      [
        path.resolve(import.meta.dirname, "../dist/index.js"),
        "rpc",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
      ],
      {
        cwd: fixture.root,
        env: minimalEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    openChildren.add(child);
    child.once("exit", () => openChildren.delete(child));
    const rpc = new RpcChild(child);

    child.stdin.write("{\n");
    expect(await rpc.waitForId(null)).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32700 }),
      }),
    );
    rpc.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "napier-rpc-subprocess-test", version: "1" },
      },
    });
    expect(await rpc.waitForId(1)).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          serverInfo: { name: "napier", version: "0.1.0" },
          capabilities: expect.objectContaining({
            eventNotifications: true,
            requestCancellation: true,
          }),
        }),
      }),
    );

    rpc.send({
      jsonrpc: "2.0",
      id: 2,
      method: "napier/agent/run",
      params: {
        prompt: "Record the first real RPC task.",
        title: "RPC subprocess",
        model: { provider: "napier", id: "demo" },
      },
    });
    const first = await rpc.waitForId(2);
    const firstResult = record(first["result"]);
    expect(firstResult).toEqual(
      expect.objectContaining({
        threadId: expect.stringMatching(/^thread_/u),
        runId: expect.stringMatching(/^run_/u),
        status: "completed",
        assistantText: expect.stringContaining("I recorded"),
      }),
    );
    const threadId = String(firstResult!["threadId"]);
    expect(
      rpc
        .messages()
        .filter(
          (message) =>
            message["method"] === "napier/event" &&
            record(message["params"])?.["requestId"] === 2,
        )
        .map(
          (message) => record(record(message["params"])?.["event"])?.["type"],
        ),
    ).toEqual(
      expect.arrayContaining([
        "run.started",
        "message.user",
        "message.assistant",
        "run.completed",
      ]),
    );
    for (const message of rpc
      .messages()
      .filter(
        (candidate) =>
          candidate["method"] === "napier/event" &&
          record(candidate["params"])?.["requestId"] === 2,
      )) {
      const params = record(message["params"])!;
      expect(params["eventSha256"]).toBe(
        sha256(JSON.stringify(params["event"])),
      );
    }

    rpc.send({
      jsonrpc: "2.0",
      id: 3,
      method: "napier/agent/run",
      params: {
        threadId,
        prompt: "Continue the same real RPC Thread.",
        model: { provider: "napier", id: "demo" },
      },
    });
    expect(await rpc.waitForId(3)).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          threadId,
          status: "completed",
          assistantText: expect.stringContaining("I recorded"),
        }),
      }),
    );

    rpc.send({ jsonrpc: "2.0", id: 4, method: "shutdown" });
    expect(await rpc.waitForId(4)).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: null,
    });
    rpc.send({ jsonrpc: "2.0", method: "exit" });
    child.stdin.end();
    const [code, signal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(rpc.stderr()).toBe("");

    const store = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    await store.initialize();
    expect(store.listRuns(threadId)).toHaveLength(2);
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, threadId))
        .status,
    ).toBe("valid");
    store.close();
  }, 20_000);
});

class RpcChild {
  private readonly received: Array<Record<string, unknown>> = [];
  private readonly stderrChunks: string[] = [];

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      this.received.push(JSON.parse(line) as Record<string, unknown>);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString("utf8"));
    });
  }

  send(value: unknown): void {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  messages(): Array<Record<string, unknown>> {
    return [...this.received];
  }

  stderr(): string {
    return this.stderrChunks.join("");
  }

  async waitForId(
    id: string | number | null,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const message = this.received.find((candidate) => candidate["id"] === id);
      if (message) return message;
      if (this.child.exitCode !== null) {
        throw new Error(`RPC child exited early: ${this.stderr()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for RPC response ${String(id)}`);
  }
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rpc-cli-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot };
}

function minimalEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

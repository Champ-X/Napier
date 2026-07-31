import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runNapierRpcServer } from "../src/rpc-server.js";
import { defineRpcWorkflowManifest } from "./rpc-workflow-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier Workflow JSON-RPC cancellation", () => {
  it("cancels and settles a real Workflow while event output is backpressured", async () => {
    const fixture = await createFixture();
    const manifest = await defineRpcWorkflowManifest(fixture);
    const services = await createLocalAgentRuntime({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("rpc-workflow-cancellation"),
    });
    const input = new PassThrough();
    const output = new GatedWritable("workflow.node.started");
    const server = runNapierRpcServer({
      agents: services.embeddedAgents,
      workflows: services.embeddedWorkflows,
      input,
      output,
      serverVersion: "test",
    });
    try {
      send(input, {
        jsonrpc: "2.0",
        id: "initialize",
        method: "initialize",
      });
      await output.waitForId("initialize");
      send(input, {
        jsonrpc: "2.0",
        id: "workflow-cancel",
        method: "napier/workflow/run",
        params: {
          manifest,
          input: { text: "Cancel the real RPC Workflow" },
        },
      });
      const started = await output.waitForGate();
      const threadId = String(
        record(record(started["params"])?.["event"])?.["threadId"],
      );
      expect(threadId).toMatch(/^thread_/u);

      send(input, {
        jsonrpc: "2.0",
        method: "$/cancelRequest",
        params: { id: "workflow-cancel" },
      });
      output.release();
      expect(await output.waitForId("workflow-cancel")).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({ code: -32800 }),
        }),
      );

      send(input, {
        jsonrpc: "2.0",
        id: "shutdown",
        method: "shutdown",
      });
      await output.waitForId("shutdown");
      send(input, { jsonrpc: "2.0", method: "exit" });
      input.end();
      expect(await server).toBe(0);
      expect(services.store.listRuns(threadId)).toEqual([
        expect.objectContaining({ status: "cancelled" }),
      ]);
      expect(
        (await services.store.listEvents(threadId)).some(
          (event) => event.type === "workflow.cancelled",
        ),
      ).toBe(true);
    } finally {
      output.release();
      input.end();
      await server.catch(() => undefined);
      await services.shutdown();
    }
  }, 15_000);
});

class GatedWritable extends Writable {
  private readonly chunks: string[] = [];
  private readonly gate: string;
  private gateResolve!: (message: Record<string, unknown>) => void;
  private readonly gateReached: Promise<Record<string, unknown>>;
  private heldCallback: ((error?: Error | null) => void) | undefined;

  constructor(eventType: string) {
    super();
    this.gate = eventType;
    this.gateReached = new Promise((resolve) => {
      this.gateResolve = resolve;
    });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = chunk.toString("utf8");
    this.chunks.push(text);
    const message = JSON.parse(text.trim()) as Record<string, unknown>;
    if (
      this.heldCallback === undefined &&
      record(record(message["params"])?.["event"])?.["type"] === this.gate
    ) {
      this.heldCallback = callback;
      this.gateResolve(message);
      return;
    }
    callback();
  }

  waitForGate(): Promise<Record<string, unknown>> {
    return this.gateReached;
  }

  release(): void {
    const callback = this.heldCallback;
    this.heldCallback = undefined;
    callback?.();
  }

  async waitForId(id: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const match = this.messages().find((message) => message["id"] === id);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for RPC response ${id}`);
  }

  private messages(): Array<Record<string, unknown>> {
    return this.chunks
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

function send(input: PassThrough, message: unknown): void {
  input.write(`${JSON.stringify(message)}\n`);
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rpc-cancel-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

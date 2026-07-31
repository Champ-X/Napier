import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  exportThreadReplayBundle,
  LocalStore,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { defineRpcApprovalWorkflowManifest } from "./rpc-workflow-fixture.js";

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

describe("Napier Workflow Approval RPC CLI", () => {
  it("rejects stale answers and completes approve/reject through the built process", async () => {
    const fixture = await createFixture();
    const manifest = await defineRpcApprovalWorkflowManifest(fixture);
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

    rpc.send({
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
    });
    expect(await rpc.waitForId("initialize")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          capabilities: expect.objectContaining({
            workflowApprovalAnswer: true,
          }),
        }),
      }),
    );

    const approvedWaiting = await runWaitingApproval(
      rpc,
      manifest,
      "approval-wait",
      "Approve through built RPC",
    );
    rpc.send({
      jsonrpc: "2.0",
      id: "approval-stale",
      method: "napier/workflow/answer",
      params: {
        manifest,
        threadId: approvedWaiting.threadId,
        planId: approvedWaiting.planId,
        decisionId: approvedWaiting.decision.id,
        expectedDecisionSha256: "0".repeat(64),
        answer: { selectedOptionIds: ["option_1"] },
      },
    });
    expect(await rpc.waitForId("approval-stale")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32003,
          message: "Workflow approval conflict",
        }),
      }),
    );

    rpc.send({
      jsonrpc: "2.0",
      id: "approval-approve",
      method: "napier/workflow/answer",
      params: {
        manifest,
        threadId: approvedWaiting.threadId,
        planId: approvedWaiting.planId,
        decisionId: approvedWaiting.decision.id,
        expectedDecisionSha256: approvedWaiting.decision.contentSha256,
        answer: {
          selectedOptionIds: ["option_1"],
          customText: "Approved through built RPC.",
        },
      },
    });
    expect(await rpc.waitForId("approval-approve")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          threadId: approvedWaiting.threadId,
          planId: approvedWaiting.planId,
          status: "completed",
          output: expect.objectContaining({
            approved: true,
            selectedOptionId: "option_1",
            customText: "Approved through built RPC.",
          }),
          decision: expect.objectContaining({
            id: approvedWaiting.decision.id,
            status: "continued",
          }),
        }),
      }),
    );
    expect(
      rpc
        .eventsFor("approval-approve")
        .some((event) => event["type"] === "operator.decision.answered"),
    ).toBe(true);

    rpc.send({
      jsonrpc: "2.0",
      id: "approval-repeat",
      method: "napier/workflow/answer",
      params: {
        manifest,
        threadId: approvedWaiting.threadId,
        planId: approvedWaiting.planId,
        decisionId: approvedWaiting.decision.id,
        expectedDecisionSha256: approvedWaiting.decision.contentSha256,
        answer: { selectedOptionIds: ["option_1"] },
      },
    });
    expect(await rpc.waitForId("approval-repeat")).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32003 }),
      }),
    );

    const rejectedWaiting = await runWaitingApproval(
      rpc,
      manifest,
      "rejection-wait",
      "Reject through built RPC",
    );
    rpc.send({
      jsonrpc: "2.0",
      id: "approval-reject",
      method: "napier/workflow/answer",
      params: {
        manifest,
        threadId: rejectedWaiting.threadId,
        planId: rejectedWaiting.planId,
        decisionId: rejectedWaiting.decision.id,
        expectedDecisionSha256: rejectedWaiting.decision.contentSha256,
        answer: {
          selectedOptionIds: ["option_2"],
          customText: "Evidence remains incomplete.",
        },
      },
    });
    expect(await rpc.waitForId("approval-reject")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          status: "blocked",
          result: expect.objectContaining({
            nodeResults: [
              expect.objectContaining({
                errorCode: "approval_rejected",
              }),
            ],
          }),
        }),
      }),
    );

    rpc.send({ jsonrpc: "2.0", id: "shutdown", method: "shutdown" });
    await rpc.waitForId("shutdown");
    rpc.send({ jsonrpc: "2.0", method: "exit" });
    child.stdin.end();
    const [code, signal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(rpc.stderr()).toBe("");

    const store = new LocalStore(fixture);
    await store.initialize();
    expect(
      (await store.listEvents(approvedWaiting.threadId)).filter(
        (event) => event.type === "operator.decision.answered",
      ),
    ).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, approvedWaiting.threadId),
      ).status,
    ).toBe("valid");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, rejectedWaiting.threadId),
      ).status,
    ).toBe("valid");
    store.close();
  }, 20_000);
});

async function runWaitingApproval(
  rpc: RpcChild,
  manifest: unknown,
  requestId: string,
  text: string,
): Promise<{
  threadId: string;
  planId: string;
  decision: { id: string; contentSha256: string };
}> {
  rpc.send({
    jsonrpc: "2.0",
    id: requestId,
    method: "napier/workflow/run",
    params: { manifest, input: { text } },
  });
  const result = record((await rpc.waitForId(requestId))["result"]);
  const decision = record(result?.["pendingDecision"]);
  expect(result).toEqual(
    expect.objectContaining({
      status: "waiting",
      pendingDecision: expect.objectContaining({
        status: "pending",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    }),
  );
  return {
    threadId: String(result!["threadId"]),
    planId: String(result!["planId"]),
    decision: {
      id: String(decision!["id"]),
      contentSha256: String(decision!["contentSha256"]),
    },
  };
}

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

  eventsFor(requestId: string): Array<Record<string, unknown>> {
    return this.received.flatMap((message) => {
      if (
        message["method"] !== "napier/event" ||
        record(message["params"])?.["requestId"] !== requestId
      ) {
        return [];
      }
      const event = record(record(message["params"])?.["event"]);
      return event ? [event] : [];
    });
  }

  stderr(): string {
    return this.stderrChunks.join("");
  }

  async waitForId(id: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const message = this.received.find((candidate) => candidate["id"] === id);
      if (message) return message;
      if (this.child.exitCode !== null) {
        throw new Error(`RPC child exited early: ${this.stderr()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for RPC response ${id}`);
  }
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rpc-approval-"));
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

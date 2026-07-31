import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { ModelRef } from "@napier/contracts";
import {
  exportThreadReplayBundle,
  LocalStore,
  UnsupportedSandboxAdapter,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createNapierClient } from "../src/index.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier TypeScript SDK Agents", () => {
  it("runs and continues one Agent Thread through the shared Ledger", async () => {
    const fixture = await createFixture("run");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-agent-run-test"),
    });
    const eventTypes: string[] = [];
    const first = await client.runAgent({
      prompt: "Record one SDK Agent task.",
      title: "SDK Agent run",
      model: { provider: "napier", id: "demo" },
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });
    const continued = await client.runAgent({
      threadId: first.threadId,
      prompt: "Continue the same SDK Agent Thread.",
      model: { provider: "napier", id: "demo" },
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });

    expect(first.status).toBe("completed");
    expect(continued.status).toBe("completed");
    expect(first.threadId).toBe(continued.threadId);
    expect(first.runId).not.toBe(continued.runId);
    expect(first.assistantText).toContain("I recorded");
    expect(continued.assistantText).toContain("I recorded");
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "run.started",
        "message.user",
        "message.assistant",
        "run.completed",
      ]),
    );
    await client.close();

    const store = await openStore(fixture);
    expect(store.listRuns(first.threadId)).toHaveLength(2);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, first.threadId),
      ).status,
    ).toBe("valid");
    store.close();
  });

  it("rejects malformed Agent requests before creating execution state", async () => {
    const fixture = await createFixture("preflight");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-agent-preflight-test"),
    });
    await expect(client.runAgent({ prompt: "   " })).rejects.toThrow(
      "prompt is required",
    );
    await expect(
      client.runAgent({ prompt: "x".repeat(64 * 1_024 + 1) }),
    ).rejects.toThrow("prompt exceeds");
    await expect(
      client.runAgent({
        prompt: "Reject malformed model.",
        model: {
          provider: "INVALID",
          id: "bad",
        } as unknown as ModelRef,
      }),
    ).rejects.toThrow("model is invalid");
    await expect(
      client.runAgent({
        prompt: "Reject an explicit empty Thread ID.",
        threadId: "",
      }),
    ).rejects.toThrow("Thread not found");
    await expect(
      client.runAgent({
        prompt: "Reject an explicit empty Agent ID.",
        agentId: "",
      }),
    ).rejects.toThrow("Agent not found");
    await expect(
      client.runAgent({
        prompt: "Reject an explicit empty title.",
        title: "",
      }),
    ).rejects.toThrow("title is invalid");
    await expect(
      client.runAgent({
        prompt: "Reject a null model from JavaScript.",
        model: null as unknown as ModelRef,
      }),
    ).rejects.toThrow("model is invalid");
    await expect(
      client.resumeAgent({
        threadId: "thread_missing",
        runId: "",
      }),
    ).rejects.toThrow("Run ID is invalid");
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.runAgent({
        prompt: "Do not create a Thread.",
        signal: controller.signal,
      }),
    ).rejects.toThrow();

    const valid = await client.runAgent({
      prompt: "Create exactly one SDK Agent Thread.",
      model: { provider: "napier", id: "demo" },
    });
    await expect(
      client.runAgent({
        threadId: valid.threadId,
        title: "Ignored title",
        prompt: "Reject a title for an existing Thread.",
      }),
    ).rejects.toThrow("title cannot be used");
    await client.close();

    const store = await openStore(fixture);
    expect(store.listThreads()).toHaveLength(2);
    expect(store.listRuns(valid.threadId)).toHaveLength(1);
    store.close();
  });

  it("isolates concurrent Agent runs and settles active close cancellation", async () => {
    const fixture = await createFixture("concurrency");
    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-agent-concurrency-test"),
    });
    const [left, right] = await Promise.all([
      client.runAgent({
        prompt: "Run the left SDK Agent task.",
        model: { provider: "napier", id: "demo" },
      }),
      client.runAgent({
        prompt: "Run the right SDK Agent task.",
        model: { provider: "napier", id: "demo" },
      }),
    ]);
    expect(left.threadId).not.toBe(right.threadId);
    expect(left.status).toBe("completed");
    expect(right.status).toBe("completed");

    let releaseStarted!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    const active = client.runAgent({
      prompt: "Cancel this SDK Agent task during shutdown.",
      model: { provider: "napier", id: "demo" },
      onEvent: async (event) => {
        if (event.type === "run.started") {
          releaseStarted();
          await callbackGate;
        }
      },
    });
    await startedGate;
    const closing = client.close();
    releaseCallback();
    const cancelled = await active;
    await closing;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.assistantText).toBeUndefined();

    const store = await openStore(fixture);
    expect(store.listRuns(cancelled.threadId)).toEqual([
      expect.objectContaining({ status: "cancelled" }),
    ]);
    expect(
      (await store.listEvents(cancelled.threadId)).some(
        (event) => event.type === "run.cancelled",
      ),
    ).toBe(true);
    store.close();
  });

  it("resumes a reconciled interrupted Run as a recovery child", async () => {
    const fixture = await createFixture("resume");
    const seeded = await openStore(fixture);
    const agent = seeded.listAgents()[0]!;
    const thread = await seeded.createThread({
      title: "Interrupted SDK Agent",
      agentId: agent.id,
    });
    const interrupted = await seeded.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "napier", id: "demo" },
      source: "user",
    });
    await seeded.appendEvent({
      threadId: thread.id,
      runId: interrupted.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: {
        role: "user",
        text: "Inspect the interrupted SDK task.",
      },
    });
    seeded.close();

    const client = await createNapierClient({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sdk-agent-resume-test"),
    });
    const events: string[] = [];
    const resumed = await client.resumeAgent({
      threadId: thread.id,
      runId: interrupted.id,
      model: { provider: "napier", id: "demo" },
      onEvent: (event) => {
        events.push(event.type);
      },
    });
    expect(resumed).toEqual(
      expect.objectContaining({
        status: "completed",
        assistantText: expect.stringContaining("reopened the interrupted run"),
        run: expect.objectContaining({
          parentRunId: interrupted.id,
          source: "recovery",
        }),
      }),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        "run.recovery.started",
        "run.recovery.prompt",
        "message.assistant",
        "run.recovery.completed",
      ]),
    );
    await client.close();

    const recovered = await openStore(fixture);
    expect(
      recovered
        .listRuns(thread.id)
        .find((candidate) => candidate.id === interrupted.id)?.status,
    ).toBe("interrupted");
    recovered.close();
  });

  it("runs the built Agent SDK example as an external Node application", async () => {
    const fixture = await createFixture("example");
    const examplePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../examples/agent-run.mjs",
    );
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      examplePath,
      fixture.workspaceRoot,
      fixture.dataRoot,
    ]);
    expect(stderr).toBe("");
    const output = JSON.parse(stdout) as Record<string, unknown>;
    expect(output).toEqual(
      expect.objectContaining({
        statuses: ["completed", "completed"],
        firstAssistantText: expect.stringContaining("I recorded"),
        continuedAssistantText: expect.stringContaining("I recorded"),
        eventTypes: expect.arrayContaining([
          "run.started",
          "message.assistant",
          "run.completed",
        ]),
      }),
    );
    expect(new Set(output["runIds"] as string[]).size).toBe(2);
  });
});

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-sdk-agent-${label}-`));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot };
}

async function openStore(fixture: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(fixture);
  await store.initialize();
  return store;
}

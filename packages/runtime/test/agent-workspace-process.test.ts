import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  LocalStore,
  ModelRegistry,
  WorkspaceProcessManager,
  type OsSandboxAdapter,
  type SandboxedProcess,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Workspace Process integration", () => {
  it("starts, polls, and settles a background process through the Agent loop", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-process-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const sandbox = autoSettlingSandbox("BACKGROUND_SECRET_OUTPUT\n");
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["workspace_process"],
    });
    const thread = await store.createThread({
      title: "Agent background process",
      agentId: agent.id,
    });
    const source = "process.stdout.write('BACKGROUND_SECRET_OUTPUT')";
    const provider = fauxProvider({ provider: "faux-process" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("workspace_process", {
          action: "start",
          runtime: "node",
          args: ["-e", source],
          timeoutMs: 10_000,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const text = JSON.stringify(context.messages);
        const processId = text.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "poll",
            processId,
            afterCursor: 0,
            waitMs: 1_000,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "BACKGROUND_SECRET_OUTPUT",
        );
        return fauxAssistantMessage(
          "The bounded background process produced the expected output.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      registry,
      undefined,
      sandbox,
      processes,
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Run the longer diagnostic in the background and inspect it.",
      model: { provider: "faux-process", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const [session] = await processes.list(thread.id);
    expect(session).toBeDefined();
    await processes.waitForSettlement(thread.id, session!.id);
    expect((await processes.list(thread.id))[0]?.status).toBe("succeeded");
    const events = await store.listEvents(thread.id);
    expect(
      events
        .filter(
          (event) =>
            event.type === "tool.started" &&
            event.payload &&
            !Array.isArray(event.payload) &&
            typeof event.payload === "object" &&
            event.payload["toolName"] === "workspace_process",
        )
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ effect: "read" }),
      expect.objectContaining({ effect: "read" }),
    ]);
    expect(
      events
        .filter((event) => event.type.startsWith("workspace.process."))
        .map((event) => event.type),
    ).toEqual(["workspace.process.started", "workspace.process.settled"]);
    expect(JSON.stringify(events)).not.toContain(source);
    expect(JSON.stringify(events)).not.toContain("BACKGROUND_SECRET_OUTPUT");
    await processes.shutdown();
    store.close();
  });
});

function autoSettlingSandbox(output: string): OsSandboxAdapter {
  return {
    id: "agent-process-sandbox",
    async launch() {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let settled = false;
      let resolveExit:
        | ((value: {
            code: number | null;
            signal: NodeJS.Signals | null;
          }) => void)
        | undefined;
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        resolveExit = resolve;
      });
      const settle = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        if (settled) return;
        settled = true;
        stdout.end();
        stderr.end();
        resolveExit?.({ code, signal });
      };
      setTimeout(() => stdout.write(output), 5);
      setTimeout(() => settle(0, null), 20);
      return {
        stdin,
        stdout,
        stderr,
        exit,
        terminate: async () => settle(null, "SIGTERM"),
      } satisfies SandboxedProcess;
    },
  };
}

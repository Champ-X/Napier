import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { assessToolCall } from "../src/policy.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";
import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness,
} from "./browser-session-harness.js";

const roots: string[] = [];

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent local preview lease", () => {
  it("previews one exact service and revokes it when the Run completes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-preview-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspaceRoot);
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const sandbox = controlledServiceSandbox();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      dataRoot,
      sandbox,
    });
    await processes.initialize();
    const browser = await createBrowserSessionHarness({
      localServiceLeases: processes.localServiceLeases,
    });
    const originalAgent = store.listAgents()[0]!;
    const agent = await store.updateAgent(originalAgent.id, {
      enabledTools: ["workspace_process", "browser"],
      toolPolicy: "workspace",
    });
    const thread = await store.createThread({
      title: "Agent exact local preview",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "local-preview-provider" });
    let processId = "";
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("workspace_process", {
          action: "start",
          runtime: "node",
          args: ["-e", "setInterval(() => {}, 1000)"],
          service: { containerPort: 31_879, healthPath: "/ready" },
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const serialized = JSON.stringify(context.messages);
        processId =
          /"processId":"(process_[a-z0-9]+)"/u.exec(serialized)?.[1] ?? "";
        expect(processId).toMatch(/^process_/u);
        expect(serialized).toContain("http://127.0.0.1:45678/");
        return fauxAssistantMessage(
          fauxToolCall("browser", {
            action: "start",
            url: "http://127.0.0.1:45678/",
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("LOCAL_PREVIEW_OK"),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      models,
      undefined,
      sandbox,
      processes,
      undefined,
      browser.manager,
    );

    expect(
      assessToolCall(
        "workspace",
        "browser",
        { action: "start", url: "http://127.0.0.1:45678/" },
        workspaceRoot,
      ).allowed,
    ).toBe(false);
    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Start and preview the local service.",
      model: { provider: "local-preview-provider", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(provider.state.callCount).toBe(4);
    expect(processId).toMatch(/^process_/u);
    expect(
      processes.localServiceLeases.authorize(
        { threadId: thread.id, runId: run.id },
        "http://127.0.0.1:45678/",
      ),
    ).toBeUndefined();
    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "workspace.process.local_service_lease.granted",
        "workspace.process.local_service_lease.revoked",
        "tool.completed",
        "run.completed",
      ]),
    );
    expect(
      events.filter(
        (event) =>
          event.type === "tool.failed" &&
          event.payload["toolName"] === "browser",
      ),
    ).toEqual([]);
    await processes.shutdown();
    store.close();
  });
});

function controlledServiceSandbox(): OsSandboxAdapter {
  let settle:
    | ((value: { code: number | null; signal: NodeJS.Signals | null }) => void)
    | undefined;
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    settle = resolve;
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return {
    id: "controlled-local-preview",
    async launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
      if (JSON.stringify(request.args).includes("napier_shell_probe_v1")) {
        const probeStdout = new PassThrough();
        const probeStderr = new PassThrough();
        probeStdout.end("napier_shell_probe_v1");
        probeStderr.end();
        return {
          stdin: new PassThrough(),
          stdout: probeStdout,
          stderr: probeStderr,
          exit: Promise.resolve({ code: 0, signal: null }),
          terminate: async () => undefined,
        };
      }
      return {
        stdin: new PassThrough(),
        stdout,
        stderr,
        exit,
        localService: {
          protocol: "http",
          containerPort: 31_879,
          host: "127.0.0.1",
          hostPort: 45_678,
          url: "http://127.0.0.1:45678/",
          healthPathSha256: "7".repeat(64),
          identitySha256: "8".repeat(64),
          readyAt: new Date().toISOString(),
        },
        terminate: vi.fn(async () => {
          stdout.end();
          stderr.end();
          settle?.({ code: null, signal: "SIGTERM" });
        }),
      };
    },
  };
}

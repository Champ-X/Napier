import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  createPlatformSandboxAdapter,
  LocalStore,
  ModelRegistry,
  WorkspaceProcessManager,
} from "../src/index.js";

const LIVE_PROCESS_ENABLED =
  process.env.NAPIER_LIVE_WORKSPACE_PROCESS_SMOKE === "1";
const describeLive = LIVE_PROCESS_ENABLED ? describe : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live Workspace Process smoke", () => {
  it("starts and polls a background Node session through the real Agent sandbox", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const dataRoot = await mkdtemp(path.join(tmpdir(), "napier-live-process-"));
    temporaryRoots.push(dataRoot);
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const sandbox = createPlatformSandboxAdapter();
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
      title: "Live Workspace Process smoke",
      agentId: agent.id,
    });
    const commandSource = [
      "const fs = require('node:fs');",
      "setTimeout(() => {",
      "  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
      "  process.stdout.write(`${pkg.name}@${pkg.version}\\n`);",
      "}, 25);",
    ].join(" ");
    const provider = fauxProvider({ provider: "live-process-smoke" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("workspace_process", {
          action: "start",
          runtime: "node",
          args: ["-e", commandSource],
          timeoutMs: 10_000,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const processId = JSON.stringify(context.messages).match(
          /process_[a-z0-9]{20}/u,
        )?.[0];
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "poll",
            processId,
            afterCursor: 0,
            waitMs: 2_000,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("napier@0.1.0");
        return fauxAssistantMessage(
          "The background package check completed in the sandbox.",
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
      text: "Read the package identity in a background Process Session.",
      model: { provider: "live-process-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const [session] = await processes.list(thread.id);
    expect(session).toBeDefined();
    const settled = await processes.waitForSettlement(thread.id, session!.id);
    expect(settled.status).toBe("succeeded");
    const events = await store.listEvents(thread.id);
    expect(JSON.stringify(events)).not.toContain(commandSource);
    expect(JSON.stringify(events)).not.toContain("napier@0.1.0");
    await processes.shutdown();
    store.close();
  }, 30_000);
});
